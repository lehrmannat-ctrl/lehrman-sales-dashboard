import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFollowUpTasks, getLeadsForTaskPicker } from "@/lib/queries";
import { resolveTaskDueRange, isTaskDueFilter, TASK_DUE_FILTER_LABELS, type TaskDueFilter } from "@/lib/task-due-filters";
import { isTaskStatusFilter, TASK_STATUS_FILTER_LABELS } from "@/lib/task-status-filters";
import type { FollowUpTaskFilter } from "@/lib/queries";
import { TaskRow } from "./TaskRow";
import { TaskDueFilterBar } from "./TaskDueFilterBar";
import { StatusFilterBar } from "./StatusFilterBar";
import { AddTaskForm } from "./AddTaskForm";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { due?: string; status?: string };
}) {
  const dueFilter: TaskDueFilter = isTaskDueFilter(searchParams.due) ? searchParams.due : "all";
  const statusFilter: FollowUpTaskFilter = isTaskStatusFilter(searchParams.status) ? searchParams.status : "pending";
  const dueRange = resolveTaskDueRange(dueFilter);

  const supabase = createSupabaseServerClient();
  const [tasks, pickerLeads] = await Promise.all([
    getFollowUpTasks(supabase, { statusFilter, dueRange }),
    getLeadsForTaskPicker(supabase),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Tasks</h1>
        <p className="text-sm text-slate-400">
          Every call-back this app has scheduled for you. Most of these are created automatically — a new lead gets a
          first-contact task, moving someone to Initial Contact schedules morning &amp; afternoon call-backs for 5
          days, and marking a lead Hot, Warm, or Cold schedules its recall check-ins — but you can add your own below
          too. Moving a lead out of a stage cancels whatever was still pending for it, so the Pending view should
          never have stale busywork on it. Click a name to see that customer's profile.
        </p>
      </div>

      <AddTaskForm leads={pickerLeads} />

      <div className="space-y-2">
        <StatusFilterBar current={statusFilter} />
        <TaskDueFilterBar current={dueFilter} />
      </div>

      <div className="space-y-2">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-6 text-center text-sm text-slate-500">
            {statusFilter === "pending" && dueFilter === "all"
              ? "Nothing scheduled right now — you're caught up."
              : `Nothing ${TASK_STATUS_FILTER_LABELS[statusFilter].toLowerCase()}${
                  dueFilter === "all" ? "" : ` due "${TASK_DUE_FILTER_LABELS[dueFilter]}"`
                } — try a different filter.`}
          </div>
        )}
      </div>
    </div>
  );
}
