import { Panel, PanelPlaceholder } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import { AutoFit } from '../../src/client/lib/AutoFit.tsx';
import { time } from '../../src/client/lib/format.ts';
import type { EnturData } from './server.ts';

interface EnturPanelConfig {
  maxDepartures: number;
  walkingMinutes: number;
}

export default function EnturPanel({ data, stale, error, format }: PanelProps<EnturData, EnturPanelConfig>) {
  if (!data) {
    return (
      <Panel title="Departures" stale={stale} staleReason={error}>
        <PanelPlaceholder label={error ? `Departures unavailable — ${error}` : 'Loading departures…'} />
      </Panel>
    );
  }

  return (
    <Panel
      title="Departures"
      stale={stale}
      staleReason="Entur unreachable — times may be out of date"
      meta={data.from}
    >
      {data.departures.length === 0 ? (
        <PanelPlaceholder label="No departures found" />
      ) : (
        <AutoFit items={data.departures} itemKey={(d) => `${d.line}:${d.expectedTime}`}>
          {(departure) => {
            const delayed = departure.expectedTime !== departure.aimedTime;
            return (
              <div className="row" style={{ opacity: departure.unreachable ? 0.42 : 1 }}>
                <span
                  className="chip"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 22%, transparent)',
                    color: 'var(--accent)',
                    minWidth: '2.4rem',
                    textAlign: 'center',
                  }}
                >
                  {departure.line || '–'}
                </span>
                <span className="row__main">{departure.destination}</span>
                <span className="row__trail tabular">
                  {time(format, departure.expectedTime)}
                  {delayed && <span style={{ color: 'var(--accent-warn)' }}> !</span>}
                </span>
                <span
                  className="tabular"
                  style={{
                    minWidth: '3.6rem',
                    textAlign: 'right',
                    fontWeight: 'var(--weight-bold)',
                    color: departure.unreachable ? 'var(--ink-faint)' : 'var(--accent)',
                  }}
                >
                  {departure.minutesUntil} min
                </span>
              </div>
            );
          }}
        </AutoFit>
      )}
    </Panel>
  );
}
