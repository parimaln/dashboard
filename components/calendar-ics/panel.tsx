import { Panel, PanelPlaceholder } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import { AutoFit } from '../../src/client/lib/AutoFit.tsx';
import { relativeDay, time, isoDate } from '../../src/client/lib/format.ts';
import type { CalendarData, CalendarEvent } from './server.ts';

interface CalendarPanelConfig {
  daysAhead: number;
  maxEvents: number;
}

export default function CalendarPanel({ data, stale, format }: PanelProps<CalendarData, CalendarPanelConfig>) {
  if (!data) {
    return (
      <Panel title="Calendar" stale={stale}>
        <PanelPlaceholder label="Loading calendars…" />
      </Panel>
    );
  }

  const events = data.events;

  // Group by day so the reader sees "Today / Tomorrow / Thu 3 Sep" once each,
  // rather than repeating the date on every row.
  const rows: (CalendarEvent | { heading: string })[] = [];
  let lastDay = '';
  for (const event of events) {
    const day = isoDate(format, event.start);
    if (day !== lastDay) {
      rows.push({ heading: relativeDay(format, event.start) });
      lastDay = day;
    }
    rows.push(event);
  }

  return (
    <Panel
      title="Calendar"
      stale={stale}
      staleReason="Calendar feeds unreachable — showing the last fetch"
      meta={
        data.failedSources.length > 0 ? (
          <span style={{ color: 'var(--accent-warn)' }}>{data.failedSources.join(', ')} unavailable</span>
        ) : (
          `${events.length} events`
        )
      }
    >
      {events.length === 0 ? (
        <PanelPlaceholder label="Nothing scheduled" />
      ) : (
        <AutoFit
          items={rows}
          itemKey={(row, index) => ('heading' in row ? `h:${row.heading}:${index}` : row.id)}
        >
          {(row) =>
            'heading' in row ? (
              <div
                style={{
                  fontSize: 'var(--text-meta)',
                  fontWeight: 'var(--weight-bold)',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-faint)',
                  padding: '0.5rem 0 0.15rem',
                }}
              >
                {row.heading}
              </div>
            ) : (
              <div className="row">
                <span className="swatch" style={{ background: row.colour }} />
                <span className="row__lead tabular">{row.allDay ? 'All day' : time(format, row.start)}</span>
                <span className="row__main">{row.title}</span>
                {row.location && <span className="row__trail">{row.location}</span>}
              </div>
            )
          }
        </AutoFit>
      )}
    </Panel>
  );
}
