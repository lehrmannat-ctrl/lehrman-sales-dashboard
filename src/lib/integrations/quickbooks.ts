import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * QuickBooks Online — source of truth for the owner's simple P&L section
 * (Revenue / Supplies / Labor / Marketing / Rent / Other / Total Expenses /
 * Profit / Profit Margin). Deliberately does NOT attempt full accounting —
 * see docs/kpi-dictionary.md and the P&L section on the Owner Dashboard.
 *
 * This talks to QuickBooks Online's own REST API (OAuth2, refresh-token
 * flow) — it is a DIFFERENT thing from the "Intuit QuickBooks" connector
 * available inside Claude chat. That chat connector is useful for ad-hoc
 * questions asked directly in a Claude conversation, but it cannot be used
 * by this always-on Vercel-hosted app's own sync cron, which needs its own
 * OAuth app credentials (see docs/integration-setup-guide.md for the exact
 * steps to create one at developer.intuit.com).
 *
 * CONFIDENCE: written from Intuit's public API docs, NOT executed against a
 * live QuickBooks company. TODO(verify) marks the two riskiest assumptions:
 * the exact ProfitAndLoss report row shape, and the keyword rules used to
 * bucket the owner's actual chart-of-accounts line items into the 6 simple
 * categories. Run docs/testing-checklist.md's QuickBooks section (once
 * credentials exist) before trusting the numbers on the dashboard.
 */

const OAUTH_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function apiBase(): string {
  // QUICKBOOKS_ENVIRONMENT=sandbox during development, "production" (or
  // unset) once the owner connects their real company.
  return process.env.QUICKBOOKS_ENVIRONMENT === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

async function getAccessToken(): Promise<string> {
  const basic = Buffer.from(
    `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.QUICKBOOKS_REFRESH_TOKEN ?? "",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QuickBooks OAuth token refresh failed (${res.status}): ${body}`);
  }
  const json = await res.json();
  // NOTE: QuickBooks refresh tokens rotate and expire after ~100 days of
  // non-use. This adapter does not persist the new refresh_token it gets
  // back (`json.refresh_token`) anywhere — for now the owner must generate
  // a fresh one in the Intuit developer dashboard if syncing ever stops
  // with an auth error. TODO(verify): consider writing json.refresh_token
  // back into an `integrations.credentials` column so rotation is handled
  // automatically, if QuickBooks syncing turns out to be used long-term.
  return json.access_token as string;
}

async function qboGet(path: string, accessToken: string) {
  const realmId = process.env.QUICKBOOKS_REALM_ID;
  const res = await fetch(`${apiBase()}/v3/company/${realmId}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QuickBooks API error ${res.status}: ${body}`);
  }
  return res.json();
}

/** yyyy-mm-dd, used for report start_date/end_date query params. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface PeriodDef {
  periodType: "month" | "ytd";
  periodLabel: string;
  start: Date;
  end: Date;
}

function buildPeriods(now: Date): PeriodDef[] {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const currentMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  return [
    {
      periodType: "month",
      periodLabel: `${currentMonthStart.getUTCFullYear()}-${String(currentMonthStart.getUTCMonth() + 1).padStart(2, "0")}`,
      start: currentMonthStart,
      end: currentMonthEnd,
    },
    {
      periodType: "month",
      periodLabel: `${prevMonthStart.getUTCFullYear()}-${String(prevMonthStart.getUTCMonth() + 1).padStart(2, "0")}`,
      start: prevMonthStart,
      end: prevMonthEnd,
    },
    {
      periodType: "ytd",
      periodLabel: `${yearStart.getUTCFullYear()}`,
      start: yearStart,
      end: now,
    },
  ];
}

/** One flattened P&L line: the account/row name plus its reported amount, in dollars. */
interface FlatLine {
  name: string;
  amount: number;
  isIncomeSection: boolean;
  isExpenseSection: boolean;
}

/**
 * QBO's ProfitAndLoss report is a tree: top-level Rows are sections
 * ("Income", "Expenses", "Net Income", ...), each with its own nested Rows
 * down to individual account lines, plus a Summary row per section.
 * TODO(verify): this walk assumes the standard QBO summary-report shape
 * (Row.Header.ColData[0].value = name, Row.ColData[last].value = amount,
 * section grouping via Row.group === "Income" | "Expenses"). Sandbox
 * reports have matched this shape historically, but Intuit does not
 * formally guarantee it — confirm against a real report payload before
 * trusting the totals.
 */
function flattenReport(report: any): FlatLine[] {
  const lines: FlatLine[] = [];

  function walk(rows: any[], section: string | null) {
    for (const row of rows ?? []) {
      const group: string | undefined = row.group;
      const currentSection = group === "Income" || group === "Expenses" ? group : section;

      if (row.Rows?.Row) {
        walk(row.Rows.Row, currentSection);
      }

      const colData = row.ColData;
      if (colData && colData.length >= 2 && colData[0]?.value) {
        const name: string = colData[0].value;
        const rawAmount = colData[colData.length - 1]?.value;
        const amount = parseFloat(rawAmount);
        if (!Number.isNaN(amount) && name && !/^total /i.test(name)) {
          lines.push({
            name,
            amount,
            isIncomeSection: currentSection === "Income",
            isExpenseSection: currentSection === "Expenses",
          });
        }
      }
    }
  }

  walk(report?.Rows?.Row ?? [], null);
  return lines;
}

/**
 * Buckets each expense line into the owner's 6 simple categories by keyword
 * match on the account name. TODO(verify): these keywords are a reasonable
 * guess (supplies/materials, wages/payroll/labor/contractor, marketing/
 * advertising, rent/lease) but must be checked against this business's
 * actual chart of accounts — rename accounts in QuickBooks to make the
 * matching more reliable, or extend the keyword lists below, rather than
 * assuming the bucket is right.
 */
function bucketExpenseLine(name: string): "supplies" | "labor" | "marketing" | "rent" | "other" {
  const n = name.toLowerCase();
  if (/suppl|material|chemical|inventory|equipment/.test(n)) return "supplies";
  if (/wage|payroll|labor|contractor|subcontract|commission/.test(n)) return "labor";
  if (/marketing|advertis|meta|facebook|google ads|promo/.test(n)) return "marketing";
  if (/\brent\b|lease/.test(n)) return "rent";
  return "other";
}

interface PnlTotals {
  revenueCents: number;
  suppliesCents: number;
  laborCents: number;
  marketingCents: number;
  rentCents: number;
  otherCents: number;
}

function summarize(lines: FlatLine[]): PnlTotals {
  const totals: PnlTotals = {
    revenueCents: 0,
    suppliesCents: 0,
    laborCents: 0,
    marketingCents: 0,
    rentCents: 0,
    otherCents: 0,
  };

  for (const line of lines) {
    const cents = Math.round(line.amount * 100);
    if (line.isIncomeSection) {
      totals.revenueCents += cents;
    } else if (line.isExpenseSection) {
      const bucket = bucketExpenseLine(line.name);
      if (bucket === "supplies") totals.suppliesCents += cents;
      else if (bucket === "labor") totals.laborCents += cents;
      else if (bucket === "marketing") totals.marketingCents += cents;
      else if (bucket === "rent") totals.rentCents += cents;
      else totals.otherCents += cents;
    }
  }

  return totals;
}

export const quickbooksAdapter: IntegrationAdapter = {
  platform: "quickbooks",

  isConfigured() {
    return envPresent(
      "QUICKBOOKS_CLIENT_ID",
      "QUICKBOOKS_CLIENT_SECRET",
      "QUICKBOOKS_REFRESH_TOKEN",
      "QUICKBOOKS_REALM_ID"
    );
  },

  async testConnection() {
    try {
      const token = await getAccessToken();
      // Cheap, read-only call that proves the credentials + realm resolve.
      await qboGet("/companyinfo/" + process.env.QUICKBOOKS_REALM_ID, token);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  async sync(): Promise<SyncResult> {
    const supabase = createSupabaseServiceRoleClient();
    const accessToken = await getAccessToken();
    const periods = buildPeriods(new Date());

    let synced = 0;
    let hadError = false;
    const errors: string[] = [];

    for (const period of periods) {
      try {
        const report = await qboGet(
          `/reports/ProfitAndLoss?start_date=${isoDate(period.start)}&end_date=${isoDate(period.end)}`,
          accessToken
        );
        const lines = flattenReport(report);
        const totals = summarize(lines);

        const { error } = await supabase.from("financial_snapshots").upsert(
          {
            source_platform: "quickbooks",
            period_type: period.periodType,
            period_label: period.periodLabel,
            period_start: isoDate(period.start),
            period_end: isoDate(period.end),
            revenue_cents: totals.revenueCents,
            supplies_cents: totals.suppliesCents,
            labor_cents: totals.laborCents,
            marketing_cents: totals.marketingCents,
            rent_cents: totals.rentCents,
            other_cents: totals.otherCents,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "source_platform,period_type,period_label" }
        );

        if (error) {
          hadError = true;
          errors.push(`${period.periodLabel}: ${error.message}`);
        } else {
          synced++;
        }
      } catch (err: any) {
        hadError = true;
        errors.push(`${period.periodLabel}: ${err?.message ?? String(err)}`);
      }
    }

    return {
      status: hadError ? (synced > 0 ? "partial" : "failed") : "success",
      recordsSynced: synced,
      errorMessage: errors.length > 0 ? errors.join("; ") : undefined,
    };
  },
};
