import { NextResponse, type NextRequest } from "next/server";
import { runAllSyncs } from "@/lib/integrations/registry";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Scheduled entry point: pulls every integration's backfill sync, then
 * regenerates alerts from whatever the syncs just wrote. Wire this to a
 * scheduler that can call an HTTPS URL on an interval (Vercel Cron, a
 * simple external cron hitting this URL, etc. — see
 * docs/deployment-guide.md). Protected by CRON_SECRET so it can't be
 * triggered by an outside request.
 *
 * Two auth shapes are accepted so this works both with Vercel Cron (which
 * only ever issues a GET, and — when the project has a CRON_SECRET env var
 * set — automatically attaches it as `Authorization: Bearer <CRON_SECRET>`,
 * with no way to send a custom header) and with a manual/external scheduler
 * hitting this as a POST with `x-cron-secret` per the deployment guide.
 */
async function authorized(request: NextRequest) {
  if (!process.env.CRON_SECRET) return false;
  const bearer = request.headers.get("authorization");
  if (bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const legacyHeader = request.headers.get("x-cron-secret");
  return legacyHeader === process.env.CRON_SECRET;
}

async function runSyncAndRefreshAlerts() {
  const syncResults = await runAllSyncs();

  const supabase = createSupabaseServiceRoleClient();
  const { error: alertError } = await supabase.rpc("generate_alerts");

  return NextResponse.json({ syncResults, alertsRefreshed: !alertError, alertError: alertError?.message ?? null });
}

// Vercel Cron (see vercel.json) calls this.
export async function GET(request: NextRequest) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSyncAndRefreshAlerts();
}

// Kept for a manual/external scheduler per docs/deployment-guide.md.
export async function POST(request: NextRequest) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSyncAndRefreshAlerts();
}
