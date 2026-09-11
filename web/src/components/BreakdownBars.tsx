/** Counts per category as labelled horizontal bars, e.g. tasks by status or open tasks by priority. */
export function BreakdownBars<K extends string>({
  title,
  order,
  counts,
  labels,
  barClass,
}: {
  title: string;
  order: readonly K[];
  counts: Record<K, number>;
  labels: Record<K, string>;
  barClass: Record<K, string>;
}) {
  const max = Math.max(1, ...order.map((key) => counts[key]));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="mt-4 space-y-2.5">
        {order.map((key) => (
          <div key={key} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 text-sm">
            <dt className="text-slate-600">{labels[key]}</dt>
            <div className="h-2 rounded-full bg-slate-100">
              <div className={`h-2 rounded-full ${barClass[key]}`} style={{ width: `${(counts[key] / max) * 100}%` }} />
            </div>
            <dd className="text-right font-medium tabular-nums">{counts[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
