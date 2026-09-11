import { DashboardPage } from '../components/DashboardPage';
import { AdminSummaryCards } from '../features/dashboard/AdminSummaryCards';
import { TaskListPanel } from '../features/tasks/TaskListPanel';

export function AdminDashboard() {
  return (
    <DashboardPage title="Admin dashboard" description="Everything happening across all projects.">
      <AdminSummaryCards />
      <TaskListPanel title="All tasks" endpoint="/dashboard/admin/tasks" />
    </DashboardPage>
  );
}
