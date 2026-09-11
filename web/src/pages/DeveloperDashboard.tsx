import { DashboardPage } from '../components/DashboardPage';
import { TaskListPanel } from '../features/tasks/TaskListPanel';

export function DeveloperDashboard() {
  return (
    <DashboardPage title="Your tasks" description="Everything assigned to you, most urgent first.">
      {/* Priority first (urgent → low), then soonest due date; the URL's `sort` overrides it. */}
      <TaskListPanel title="Assigned to you" endpoint="/dashboard/developer/tasks" defaultSort="-priority" showAssignee={false} />
    </DashboardPage>
  );
}
