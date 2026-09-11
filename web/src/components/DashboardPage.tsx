import type { ReactNode } from 'react';
import { ActivityFeed } from '../features/activity/ActivityFeed';

/** Dashboard shell: heading, the page's own content, and the live activity feed alongside. */
export function DashboardPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">{children}</div>
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <ActivityFeed />
        </aside>
      </div>
    </div>
  );
}
