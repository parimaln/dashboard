import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface AutoFitProps<T> {
  items: T[];
  /** Rendered for each item that fits. */
  children: (item: T, index: number) => ReactNode;
  /** Stable key per item. */
  itemKey: (item: T, index: number) => string;
  /**
   * Rendered when items had to be dropped. Receives how many.
   * Defaults to a quiet "+N more" line.
   */
  overflowLabel?: (hidden: number) => ReactNode;
  className?: string;
}

/**
 * Renders as many items as physically fit, and says how many it dropped.
 *
 * The dashboard never scrolls: it is a wall display with no keyboard, no mouse and
 * nobody standing close enough to reach it. That constraint would normally mean
 * silently clipping a list, which is worse than useless — you cannot tell whether
 * you are seeing everything.
 *
 * So this measures instead. It renders the full list once, hidden, measures each
 * child against the available height, then renders only the prefix that fits plus
 * a counter. It re-measures whenever the container resizes or the items change.
 */
export function AutoFit<T>({ items, children, itemKey, overflowLabel, className }: AutoFitProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recompute = () => {
      const available = container.clientHeight;
      if (available <= 0) return;

      const rows = Array.from(measure.children) as HTMLElement[];
      // The overflow counter is itself a row; reserve its height whenever the list
      // might not fit, so adding the counter cannot push the list over the edge.
      const counterHeight = rows.length > 0 ? (rows[0]!.offsetHeight ?? 0) * 0.8 : 0;

      let used = 0;
      let fits = 0;
      for (const row of rows) {
        const style = window.getComputedStyle(row);
        const height = row.offsetHeight + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0');
        const needsCounter = fits + 1 < rows.length;
        if (used + height + (needsCounter ? counterHeight : 0) > available) break;
        used += height;
        fits += 1;
      }

      setVisibleCount(fits);
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [items]);

  const hidden = items.length - visibleCount;

  return (
    <div ref={containerRef} className={className} style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/*
        Off-screen measurement copy. aria-hidden and inert so it is invisible to
        assistive technology and cannot be interacted with.
      */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          width: containerRef.current?.clientWidth ?? '100%',
          left: '-99999px',
          top: 0,
        }}
      >
        {items.map((item, index) => (
          <div key={itemKey(item, index)}>{children(item, index)}</div>
        ))}
      </div>

      {items.slice(0, visibleCount).map((item, index) => (
        <div key={itemKey(item, index)}>{children(item, index)}</div>
      ))}

      {hidden > 0 &&
        (overflowLabel ? (
          overflowLabel(hidden)
        ) : (
          <div
            className="tabular"
            style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-meta)', paddingTop: '0.3rem' }}
          >
            +{hidden} more
          </div>
        ))}
    </div>
  );
}
