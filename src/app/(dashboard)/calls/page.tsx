import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveDateRange, type DateRangePreset } from "@/lib/date-ranges";
import { getCallActivity } from "@/lib/queries";
import { DateRangeFilter } from "@/components/DateRangeFilter";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function CallsPage({ searchParams }: { searchParams: { range?: string } }) {
  const preset = (searchParams.range as DateRangePreset) ?? "this_week";
  const range = resolveDateRange(preset);
  const supabase = createSupabaseServerClient();
  const calls = await getCallActivity(supabase, range);

  const totalDials = calls.filter((c) => c.direction === "outbound").length;
  const connected = calls.filter((c) => c.outcome === "answered" || c.durationSeconds).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Call Activity</h1>
          <p className="text-sm text-slate-400">{totalDials} dials · {connected} connected this period. Recordings play inline once Quo is connected.</p>
        </div>
        <DateRangeFilter current={preset} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-charcoal-700">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-charcoal-900 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Direction</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Quality Score</th>
              <th className="px-4 py-3">Recording</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-800">
            {calls.map((c) => (
              <tr key={c.id} className="text-slate-200">
                <td className="px-4 py-3 text-xs text-slate-400">{new Date(c.occurredAt).toLocaleString()}</td>
                <td className="px-4 py-3">{c.leadName}</td>
                <td className="px-4 py-3 capitalize">{c.direction}</td>
                <td className="px-4 py-3 capitalize">{c.outcome ?? "—"}</td>
                <td className="px-4 py-3">{formatDuration(c.durationSeconds)}</td>
                <td className="px-4 py-3">{c.cqOverallScore ?? "—"}</td>
                <td className="px-4 py-3">
                  {c.recordingUrl ? (
                    <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">Play</a>
                  ) : (
                    <span className="text-slate-600">No recording</span>
                  )}
                </td>
              </tr>
            ))}
            {calls.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">No calls logged for this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
