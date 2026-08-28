import { Panel, PanelPlaceholder } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import { relativeDay } from '../../src/client/lib/format.ts';
import type { MealieData } from './server.ts';

interface MealiePanelConfig {
  days: number;
  showImages: boolean;
}

export default function MealiePanel({ data, stale, config, format }: PanelProps<MealieData, MealiePanelConfig>) {
  if (!data) {
    return (
      <Panel title="Meals" grow={0} stale={stale}>
        <PanelPlaceholder label="Loading meal plan…" />
      </Panel>
    );
  }

  return (
    <Panel title="Meals" grow={0} stale={stale} staleReason="Mealie unreachable — showing the last plan">
      <div style={{ display: 'flex', gap: 'var(--gap)' }}>
        {data.days.map((day) => (
          <div key={day.date} style={{ flex: '1 1 0', minWidth: 0 }}>
            <div
              style={{
                fontSize: 'var(--text-meta)',
                fontWeight: 'var(--weight-bold)',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
                marginBottom: '0.3rem',
              }}
            >
              {relativeDay(format, `${day.date}T12:00:00`)}
            </div>

            {day.entries.length === 0 ? (
              <div className="faint" style={{ fontSize: 'var(--text-meta)' }}>
                Nothing planned
              </div>
            ) : (
              day.entries.map((entry, index) => (
                <div
                  key={`${entry.type}:${entry.title}:${index}`}
                  style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', padding: '0.2rem 0' }}
                >
                  {config.showImages && entry.imageUrl && (
                    <img
                      src={entry.imageUrl}
                      alt=""
                      loading="lazy"
                      style={{
                        width: '2.1rem',
                        height: '2.1rem',
                        borderRadius: '0.35rem',
                        objectFit: 'cover',
                        flex: '0 0 auto',
                      }}
                      // A missing image must not leave a broken-image glyph on the wall.
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="faint" style={{ fontSize: 'var(--text-meta)', textTransform: 'capitalize' }}>
                      {entry.type}
                    </div>
                    <div className="row__main" style={{ fontWeight: 'var(--weight-medium)' }}>
                      {entry.title}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
