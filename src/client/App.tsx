import { useEffect, useMemo } from 'react';
import { GRID_AREAS, type GridArea, type PublicConfig } from '../shared/config.ts';
import { useDashboard } from './lib/store.ts';
import { getPanel, type PanelProps } from './lib/panels.ts';
import { Panel, PanelPlaceholder } from './lib/Panel.tsx';
import { SetupScreen } from './SetupScreen.tsx';
import type { FormatContext } from './lib/format.ts';

/**
 * Applies display settings as CSS custom properties, so a change in
 * config/public.json takes effect without touching a stylesheet.
 */
function useDisplaySettings(config: PublicConfig | undefined) {
  useEffect(() => {
    if (!config) return;
    const root = document.documentElement;
    root.style.setProperty('--root-font-size', config.display.rootFontSize);
    root.style.setProperty('--safe-x', config.display.safeAreaX);
    root.style.setProperty('--safe-y', config.display.safeAreaY);
    document.body.classList.toggle('kiosk-cursor-hidden', config.display.hideCursor);
  }, [config]);
}

/**
 * Nudges the whole board by a pixel or two periodically.
 *
 * A dashboard is a near-static image left on a television for hours at a time,
 * which is exactly the condition that wears a panel unevenly. Drifting the layout
 * imperceptibly spreads that load.
 */
function usePixelShift(minutes: number | undefined) {
  useEffect(() => {
    if (!minutes) return;
    const offsets = [
      [0, 0],
      [2, 1],
      [0, 2],
      [-2, 1],
      [-2, -1],
      [0, -2],
      [2, -1],
    ] as const;
    let index = 0;

    const apply = () => {
      const stage = document.querySelector<HTMLElement>('.stage');
      if (!stage) return;
      const [x, y] = offsets[index % offsets.length]!;
      stage.style.transform = `translate(${x}px, ${y}px)`;
      index += 1;
    };

    const timer = setInterval(apply, minutes * 60_000);
    return () => clearInterval(timer);
  }, [minutes]);
}

export function App() {
  const { bootstrap, states, status, fatal } = useDashboard();
  useDisplaySettings(bootstrap?.config);
  usePixelShift(bootstrap?.config.display.pixelShiftMinutes);

  const format = useMemo<FormatContext>(
    () => ({
      locale: bootstrap?.config.locale ?? 'en-GB',
      timeZone: bootstrap?.config.timeZone ?? 'UTC',
    }),
    [bootstrap?.config.locale, bootstrap?.config.timeZone],
  );

  if (fatal) {
    return (
      <div style={{ padding: '3rem', fontSize: 'var(--text-lg)' }}>
        <p style={{ color: 'var(--accent-bad)' }}>Cannot reach the dashboard server.</p>
        <p style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-body)' }}>{fatal}</p>
      </div>
    );
  }

  if (!bootstrap) return <div style={{ padding: '3rem', color: 'var(--ink-faint)' }}>Starting…</div>;

  const placed = Object.entries(bootstrap.config.layout);
  const enabledIds = new Set(bootstrap.components.filter((c) => c.enabled).map((c) => c.id));
  const anyEnabled = placed.some(([id]) => enabledIds.has(id));

  // A fresh clone with nothing configured gets instructions rather than a black screen.
  if (!anyEnabled) return <SetupScreen components={bootstrap.components} />;

  const byArea = new Map<GridArea, { id: string; order: number; grow: number }[]>(
    GRID_AREAS.map((area) => [area, []]),
  );
  for (const [id, entry] of placed) {
    if (!enabledIds.has(id)) continue;
    byArea.get(entry.area)?.push({ id, order: entry.order, grow: entry.grow });
  }
  for (const list of byArea.values()) list.sort((a, b) => a.order - b.order);

  const renderArea = (area: GridArea) =>
    (byArea.get(area) ?? []).map(({ id, grow }) => {
      const PanelComponent = getPanel(id);
      const descriptor = bootstrap.components.find((c) => c.id === id);
      const state = states.get(id);

      if (!PanelComponent) {
        return (
          <Panel key={id} title={descriptor?.name ?? id} grow={grow}>
            <PanelPlaceholder label={`No panel.tsx in components/${id}/`} />
          </Panel>
        );
      }

      /*
       * Data can be stale in two ways: a refresh failed, or a refresh never
       * happened (the host suspended, the stream dropped). The server reports the
       * first; the second is only visible by looking at the clock, which is why
       * the age is checked here as well.
       */
      const tooOld =
        state?.updatedAt != null &&
        state.maxAgeMs != null &&
        Date.now() - state.updatedAt > state.maxAgeMs;

      const props: PanelProps<never, never> = {
        data: (state?.data ?? null) as never,
        config: (bootstrap.config.components[id] ?? {}) as never,
        stale: (state?.stale ?? false) || tooOld,
        format,
        read: <T,>(otherId: string) => states.get(otherId)?.data as T | undefined,
      };
      return <PanelComponent key={id} {...props} />;
    });

  return (
    <div className="stage">
      <div className="column column--left">{renderArea('left')}</div>
      <div className="column column--center">{renderArea('center')}</div>
      <div className="column column--right">{renderArea('right')}</div>
      <div className="bottom-bar">{renderArea('bottom')}</div>

      {status === 'reconnecting' && (
        <div
          style={{
            position: 'fixed',
            bottom: '0.6rem',
            right: '0.8rem',
            fontSize: 'var(--text-meta)',
            color: 'var(--accent-warn)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Reconnecting
        </div>
      )}
    </div>
  );
}
