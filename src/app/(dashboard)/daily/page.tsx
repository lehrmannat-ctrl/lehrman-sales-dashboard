import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDailyCommandCenter } from "@/lib/queries";
import { ActionItemList } from "@/components/ActionItemList";

export const dynamic = "force-dynamic";

export default async function DailyCommandCenterPage() {
  const supabase = createSupabaseServerClient();
  const data = await getDailyCommandCenter(supabase);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Daily Command Center</h1>
        <p className="text-sm text-slate-400">What needs to happen today. Call/Text buttons dial or text directly — nothing here is a placeholder.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ActionItemList title="New leads not yet contacted" items={data.uncontactedNewLeads} emptyLabel="Every new lead has been contacted. Nice." />
        <ActionItemList title="Leads waiting over 5 minutes" items={data.leadsWaitingOver5Min} emptyLabel="Nothing is sitting past the 5-minute speed-to-lead target." />
        <ActionItemList title="Leads with no next task" items={data.leadsWithNoNextTask} emptyLabel="Every active lead has a follow-up scheduled." />
        <ActionItemList title="Appointments today" items={data.appointmentsToday} emptyLabel="No appointments scheduled today." />
        <ActionItemList title="Unconfirmed appointments" items={data.unconfirmedAppointments} emptyLabel="All upcoming appointments are confirmed." />
        <ActionItemList title="Sold but deposit not collected" items={data.depositsNotCollected} emptyLabel="No outstanding deposits." />
      </div>
    </div>
  );
}
