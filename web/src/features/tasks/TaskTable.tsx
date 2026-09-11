import { PriorityBadge, StatusBadge } from '../../components/Badges';
import type { Task } from './types';

const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

export function DueDate({ task }: { task: Pick<Task, 'dueDate' | 'status'> }) {
  if (!task.dueDate) return <span className="text-slate-400">No due date</span>;
  return (
    <time
      dateTime={task.dueDate}
      className={task.status === 'OVERDUE' ? 'font-medium text-red-600' : 'text-slate-600'}
    >
      {dateFormat.format(new Date(task.dueDate))}
    </time>
  );
}

export function TaskTable({ tasks, showAssignee = true }: { tasks: Task[]; showAssignee?: boolean }) {
  if (tasks.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-slate-500">No tasks match these filters.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-2.5">Task</th>
            <th scope="col" className="px-3 py-2.5">Status</th>
            <th scope="col" className="px-3 py-2.5">Priority</th>
            {showAssignee && <th scope="col" className="px-3 py-2.5">Assignee</th>}
            <th scope="col" className="px-3 py-2.5">Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tasks.map((task) => (
            <tr key={task.id} className="hover:bg-slate-50/60">
              <td className="px-5 py-3">
                <p className="font-medium text-slate-900">{task.title}</p>
                <p className="text-xs text-slate-500">{task.project.name}</p>
              </td>
              <td className="px-3 py-3"><StatusBadge status={task.status} /></td>
              <td className="px-3 py-3"><PriorityBadge priority={task.priority} /></td>
              {showAssignee && (
                <td className="px-3 py-3 text-slate-600">
                  {task.assignee?.name ?? <span className="text-slate-400">Unassigned</span>}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-3"><DueDate task={task} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
