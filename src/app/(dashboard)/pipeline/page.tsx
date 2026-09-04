import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPipelineOpportunities } from "@/lib/queries";
import { PipelineView, type PipelineCardData } from "@/components/PipelineView";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const supabase = createSupabaseServerClient();
  const opportunities = await getPipelineOpportunities(supabase);

  const oppIds = opportunities.map((o) => o.id);
  const leadIds = opportunities.map((o) => o.lead_id);

  const [{ data: services }, { data: cashRows }, { data: leads }] = await Promise.all([
    supabase.from("services").select("id, name"),
    oppIds.length > 0
      ? supabase.from("v_opportunity_cash").select("opportunity_id, cash_collected_cents").in("opportunity_id", oppIds)
      : Promise.resolve({ data: [] as any[] }),
    leadIds.length > 0
      ? supabase.from("leads").select("id, first_name, last_name, lead_source_id, lead_sources(name)").in("id", leadIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const serviceById = new Map((services ?? []).map((s: any) => [s.id, s.name]));
  const cashByOpp = new Map((cashRows ?? []).map((r: any) => [r.opportunity_id, r.cash_collected_cents]));
  const leadById = new Map((leads ?? []).map((l: any) => [l.id, l]));

  const cards: PipelineCardData[] = opportunities.map((o) => {
    const lead = leadById.get(o.lead_id);
    return {
      id: o.id,
      customerName: lead ? `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead" : "Unknown lead",
      serviceName: (o.service_id && serviceById.get(o.service_id)) || "Unspecified",
      estimatedValueCents: o.estimated_value_cents,
      cashCollectedCents: cashByOpp.get(o.id) ?? 0,
      stage: o.stage,
      sourceName: lead?.lead_sources?.name ?? null,
      lostReason: o.lost_reason,
      appointmentDate: o.appointment_date,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Pipeline</h1>
        <p className="text-sm text-slate-400">Change a deal&apos;s stage right from the card — it&apos;s written straight to the database, not a mockup.</p>
      </div>
      <PipelineView opportunities={cards} />
    </div>
  );
}
