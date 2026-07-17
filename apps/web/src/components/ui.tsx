import type { ReactNode } from "react";

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-card ${className}`}>
      <header className="flex items-baseline justify-between gap-4 border-b border-line/70 px-6 py-4">
        <div>
          <h2 className="font-display text-lg text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-card px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">{label}</p>
      <p className="mt-1.5 font-display text-3xl leading-none text-ink">{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/** Single-hue magnitude bar with its value labeled beside it (never color alone). */
export function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand">
        <div
          className="h-full rounded-full bg-mark-emerald"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs font-medium text-ink-soft">
        {label ?? `${Math.round(clamped)}%`}
      </span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-dashed border-line bg-ivory px-4 py-6 text-center text-sm text-ink-faint">
      {message}
    </p>
  );
}
