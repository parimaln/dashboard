import { Panel, PanelPlaceholder } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import type { CountdownData } from './server.ts';

interface CountdownPanelConfig {
  maxEvents: number;
}

/** "in 3 days" reads badly at a glance; a bare number and a unit reads instantly. */
function describe(daysUntil: number): { value: string; unit: string } {
  if (daysUntil === 0) return { value: 'Today', unit: '' };
  if (daysUntil === 1) return { value: '1', unit: 'day' };
  if (daysUntil < 0) return { value: `${Math.abs(daysUntil)}`, unit: 'days ago' };
  return { value: `${daysUntil}`, unit: 'days' };
}

export default function CountdownPanel({ data, stale }: PanelProps<CountdownData, CountdownPanelConfig>) {
  if (!data || data.items.length === 0) {
    return (
      <Panel grow={0} stale={stale}>
        <PanelPlaceholder label="No countdowns — add one to config/events.json" />
      </Panel>
    );
  }

  return (
    <Panel grow={0} stale={stale} staleReason="Could not re-read config/events.json">
      <div className="countdown">
        {data.items.map((item) => {
          const { value, unit } = describe(item.daysUntil);
          const colour = item.colour ?? (item.isToday ? 'var(--accent-warm)' : 'var(--ink)');
          return (
            <div key={`${item.date}:${item.label}`} className="countdown__item">
              {item.emoji && <span style={{ fontSize: 'var(--text-xl)' }}>{item.emoji}</span>}
              <span className="countdown__days tabular" style={{ color: colour }}>
                {value}
              </span>
              <span className="countdown__label">
                {unit && <span className="faint">{unit} · </span>}
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
