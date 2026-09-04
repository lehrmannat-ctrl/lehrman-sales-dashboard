import clsx from "clsx";

const COLORS: Record<string, string> = {
  connected: "bg-status-good/15 text-status-good border-status-good/40",
  not_connected: "bg-charcoal-700 text-slate-400 border-charcoal-600",
  error: "bg-status-bad/15 text-status-bad border-status-bad/40",
  open: "bg-status-bad/15 text-status-bad border-status-bad/40",
  acknowledged: "bg-status-warn/15 text-status-warn border-status-warn/40",
  resolved: "bg-status-good/15 text-status-good border-status-good/40",
  critical: "bg-status-bad/20 text-status-bad border-status-bad/50",
  high: "bg-status-bad/15 text-status-bad border-status-bad/40",
  medium: "bg-status-warn/15 text-status-warn border-status-warn/40",
  low: "bg-charcoal-700 text-slate-300 border-charcoal-600",
  hot: "bg-status-bad/15 text-status-bad border-status-bad/40",
  warm: "bg-status-warn/15 text-status-warn border-status-warn/40",
  cold: "bg-brand-600/15 text-brand-400 border-brand-600/40",
  unset: "bg-charcoal-700 text-slate-400 border-charcoal-600",
};

export function StatusPill({ value, label }: { value: string; label?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", COLORS[value] ?? COLORS.not_connected)}>
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}
