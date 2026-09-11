import { DashboardPage } from '../components/DashboardPage';
import { PmSummaryPanel } from '../features/dashboard/PmSummaryPanel';
import { TaskListPanel } from '../features/tasks/TaskListPanel';

export function PmDashboard() {
  return (
    <DashboardPage title="Your projects" description="Progress, priorities and deadlines across the projects you own.">
      <PmSummaryPanel />
      <TaskListPanel title="Tasks in your projects" endpoint="/dashboard/pm/tasks" />
    </DashboardPage>
  );
}
