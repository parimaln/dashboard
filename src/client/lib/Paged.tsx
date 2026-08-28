import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface PagedProps<T> {
  items: T[];
  children: (item: T, index: number) => ReactNode;
  itemKey: (item: T, index: number) => string;
  /** Seconds each page is shown before crossfading to the next. */
  intervalSeconds?: number;
  className?: string;
}

/**
 * Shows a long list one screenful at a time, crossfading between pages.
 *
 * This is the alternative to scrolling for lists that genuinely need to show
 * everything — the chore list, where an item you cannot see is an item that will
 * not get done. Motion the room can ignore, rather than a scrollbar nobody can
 * reach.
 *
 * Page size is measured rather than configured, so it adapts to the panel's actual
 * height on whatever screen this is running on.
 */
export function Paged<T>({ items, children, itemKey, intervalSeconds = 20, className }: PagedProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(items.length || 1);
  const [page, setPage] = useState(0);
  const [fading, setFading] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recompute = () => {
      const available = container.clientHeight;
      if (available <= 0) return;
      const rows = Array.from(measure.children) as HTMLElement[];

      let used = 0;
      let fits = 0;
      for (const row of rows) {
        const style = window.getComputedStyle(row);
        const height = row.offsetHeight + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0');
        if (used + height > available) break;
        used += height;
        fits += 1;
      }
      setPageSize(Math.max(1, fits));
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [items]);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  // Rotating past the end after items are removed would show an empty page.
  useLayoutEffect(() => {
    if (page >= pageCount) setPage(0);
  }, [page, pageCount]);

  useLayoutEffect(() => {
    if (pageCount <= 1) return;
    const timer = setInterval(() => {
      setFading(true);
      // Let the fade-out finish before swapping content, then fade back in.
      setTimeout(() => {
        setPage((p) => (p + 1) % pageCount);
        setFading(false);
      }, 400);
    }, intervalSeconds * 1_000);
    return () => clearInterval(timer);
  }, [pageCount, intervalSeconds]);

  const start = page * pageSize;
  const visible = items.slice(start, start + pageSize);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: '100%', minHeight: 0, overflow: 'hidden', position: 'relative' }}
    >
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

      <div style={{ opacity: fading ? 0 : 1, transition: 'opacity 400ms ease-in-out' }}>
        {visible.map((item, index) => (
          <div key={itemKey(item, start + index)}>{children(item, start + index)}</div>
        ))}
      </div>

      {pageCount > 1 && (
        <div
          className="tabular"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            fontSize: 'var(--text-meta)',
            color: 'var(--ink-faint)',
          }}
        >
          {page + 1}/{pageCount}
        </div>
      )}
    </div>
  );
}
