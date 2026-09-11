import { useActivityFeed, type FeedConnection } from '../../hooks/useActivityFeed';
import { timeAgo } from '../../lib/timeAgo';
import type { ActivityEvent } from './types';

const CONNECTION: Record<FeedConnection, { label: string; dot: string }> = {
  live: { label: 'Live', dot: 'bg-emerald-500' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400' },
  offline: { label: 'Offline', dot: 'bg-slate-400' },
};

export function ActivityFeed() {
  const { events, connection } = useActivityFeed();
  const status = CONNECTION[connection];

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden />
          {status.label}
        </span>
      </header>
      {events.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-live="polite">
          {events.map((event) => (
            <FeedItem key={event.id} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedItem({ event }: { event: ActivityEvent }) {
  return (
    <li className="px-5 py-3">
      <p className="text-sm text-slate-700">
        <span className="font-medium text-slate-900">{event.actor?.name ?? 'System'}</span> {event.message}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        {event.project && <>{event.project.name} · </>}
        <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()}>
          {timeAgo(event.createdAt)}
        </time>
      </p>
    </li>
  );
}
