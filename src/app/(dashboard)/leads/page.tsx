import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLeadsList } from "@/lib/queries";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  attempting_contact: "Attempting Contact",
  contacted: "Contacted",
  qualified: "Qualified",
  appointment_booked: "Appt. Booked",
  appointment_confirmed: "Appt. Confirmed",
  showed: "Showed",
  sold: "Sold",
  deposit_collected: "Deposit Collected",
  paid_in_full: "Paid in Full",
  job_completed: "Job Completed",
  review_requested: "Review Requested",
  follow_up_or_next_service_due: "Follow-Up Due",
  lost: "Lost",
};

export default async function LeadsPage() {
  const supabase = createSupabaseServerClient();
  const leads = await getLeadsList(supabase);

  // "Qualified" here means the owner's own definition: a lead that has been
  // given a temperature at all (cold/warm/hot), not just brand new or still
  // being worked. GoHighLevel sync maps those three stages straight to this
  // app's `qualified` pipeline_stage - see src/lib/integrations/gohighlevel.ts.
  const qualifiedCount = leads.filter((l) => l.stage === "qualified").length;
  const hotCount = leads.filter((l) => l.temperature === "hot").length;
  const warmCount = leads.filter((l) => l.temperature === "warm").length;
  const coldCount = leads.filter((l) => l.temperature === "cold").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Leads</h1>
        <p className="text-sm text-slate-400">
          Every lead synced in, in one list — name, where they came from, what stage they&apos;re at, and how hot they
          are. Stage and temperature come straight from GoHighLevel once that sync is connected (see Settings →
          Integrations); nothing here is invented. Contacts with no name at all (spam) are skipped during sync, not
          counted here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
          <p className="text-xs text-slate-400">Total leads</p>
          <p className="mt-1 text-2xl font-semibold text-white">{leads.length}</p>
        </div>
        <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
          <p className="text-xs text-slate-400">Qualified (hot/warm/cold)</p>
          <p className="mt-1 text-2xl font-semibold text-white">{qualifiedCount}</p>
        </div>
        <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
          <p className="text-xs text-slate-400">Hot / Warm / Cold</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {hotCount} / {warmCount} / {coldCount}
          </p>
        </div>
        <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
          <p className="text-xs text-slate-400">Won</p>
          <p className="mt-1 text-2xl font-semibold text-white">{leads.filter((l) => l.stage === "sold").length}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-charcoal-700">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-charcoal-900 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone / Email</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Temperature</th>
              <th className="px-4 py-3">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-800">
            {leads.map((lead) => (
              <tr key={lead.id} className="text-slate-200">
                <td className="px-4 py-3">
                  {`${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead"}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {lead.phone ?? "—"}
                  {lead.phone && lead.email ? " · " : ""}
                  {lead.email ?? ""}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{lead.source_name ?? (lead.attribution_missing ? "Missing" : "—")}</td>
                <td className="px-4 py-3">
                  <StatusPill value={lead.stage} label={STAGE_LABELS[lead.stage] ?? lead.stage} />
                </td>
                <td className="px-4 py-3">
                  <StatusPill value={lead.temperature} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{new Date(lead.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  No leads yet — connect GoHighLevel on Settings → Integrations, then click Resync now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
