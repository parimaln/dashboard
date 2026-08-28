import { Panel, PanelPlaceholder } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import { Paged } from '../../src/client/lib/Paged.tsx';
import { relativeDay } from '../../src/client/lib/format.ts';
import type { DonetickData, ChoreBucket } from './server.ts';

interface DonetickPanelConfig {
  maxChores: number;
}

const BUCKET_COLOUR: Record<ChoreBucket, string> = {
  overdue: 'var(--accent-bad)',
  today: 'var(--accent-warm)',
  tomorrow: 'var(--accent)',
  upcoming: 'var(--ink-faint)',
  someday: 'var(--ink-faint)',
};

export default function DonetickPanel({ data, stale, format }: PanelProps<DonetickData, DonetickPanelConfig>) {
  if (!data) {
    return (
      <Panel title="Chores" stale={stale}>
        <PanelPlaceholder label="Loading chores…" />
      </Panel>
    );
  }

  const { chores, counts } = data;

  return (
    <Panel
      title="Chores"
      stale={stale}
      staleReason="Donetick unreachable — showing the last known list"
      meta={
        counts.overdue > 0 ? (
          <span style={{ color: 'var(--accent-bad)', fontWeight: 'var(--weight-bold)' }}>
            {counts.overdue} overdue
          </span>
        ) : (
          `${counts.today} due today`
        )
      }
    >
      {chores.length === 0 ? (
        <PanelPlaceholder label="Nothing due — all clear" />
      ) : (
        // Chores are the one list where an unseen item is a job that will not get
        // done, so it pages through everything rather than truncating.
        <Paged items={chores} itemKey={(chore) => chore.id} intervalSeconds={20}>
          {(chore) => (
            <div className="row">
              <span className="swatch" style={{ background: BUCKET_COLOUR[chore.bucket] }} />
              <span className="row__main">{chore.name}</span>
              {chore.assignee && <span className="row__trail">{chore.assignee}</span>}
              <span
                style={{
                  flex: '0 0 auto',
                  minWidth: '5.4rem',
                  textAlign: 'right',
                  fontSize: 'var(--text-meta)',
                  fontWeight: 'var(--weight-bold)',
                  color: BUCKET_COLOUR[chore.bucket],
                }}
              >
                {chore.bucket === 'overdue'
                  ? `${Math.abs(chore.daysUntil ?? 0)}d late`
                  : chore.dueDate
                    ? relativeDay(format, chore.dueDate)
                    : '—'}
              </span>
            </div>
          )}
        </Paged>
      )}
    </Panel>
  );
}
