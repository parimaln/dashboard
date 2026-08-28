import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  /** Right-hand side of the header: a count, a place name, a line summary. */
  meta?: ReactNode;
  children: ReactNode;
  /** Takes only the height it needs (grow 0) or shares the column (grow 1+). */
  grow?: number;
  /** Shows the staleness dot and dims the body. */
  stale?: boolean;
  /** Tooltip for the staleness dot. */
  staleReason?: string;
  /** Drop the chrome entirely — used by the clock, which is just type on the background. */
  bare?: boolean;
}

export function Panel({ title, meta, children, grow = 1, stale, staleReason, bare }: PanelProps) {
  const className = [
    'panel',
    grow > 0 ? 'panel--grow' : 'panel--fixed',
    stale ? 'panel--stale' : '',
    bare ? 'panel--bare' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={className} style={grow > 0 ? { flexGrow: grow } : undefined}>
      {(title || meta || stale) && (
        <header className="panel__head">
          {title && <h2 className="panel__title">{title}</h2>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            {meta && <span style={{ fontSize: 'var(--text-meta)', color: 'var(--ink-faint)' }}>{meta}</span>}
            {stale && <span className="stale-dot" title={staleReason ?? 'Showing the last known data'} />}
          </div>
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}

/** Shown in place of a panel's content before its first data arrives. */
export function PanelPlaceholder({ label }: { label: string }) {
  return (
    <div style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-meta)', letterSpacing: '0.08em' }}>{label}</div>
  );
}
