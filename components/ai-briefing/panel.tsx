import { Panel, PanelPlaceholder } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import { time } from '../../src/client/lib/format.ts';
import type { BriefingData } from './server.ts';

interface BriefingPanelConfig {
  maxBullets: number;
  maxReminders: number;
}

export default function BriefingPanel({ data, stale, format }: PanelProps<BriefingData, BriefingPanelConfig>) {
  if (!data) {
    return (
      <Panel title="Briefing" grow={0} stale={stale}>
        <PanelPlaceholder label="Waiting for the model…" />
      </Panel>
    );
  }

  return (
    <Panel
      title="Briefing"
      grow={0}
      stale={stale}
      staleReason="The model was unreachable — this briefing is from the last successful run"
      // Naming the model and the time makes a wrong answer traceable to a run
      // rather than mysterious.
      meta={
        <span className="tabular">
          {data.model} · {time(format, data.generatedAt)}
        </span>
      }
    >
      <div className="briefing__headline">{data.headline}</div>
      {data.bullets.length > 0 && (
        <ul className="briefing__bullets">
          {data.bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
        </ul>
      )}

      {/*
        Reminders come from the household notes rather than from any live feed, so
        they are rendered as a distinct row of things to pick up on the way out —
        visually separate from the prose above.
      */}
      {data.reminders.length > 0 && (
        <div className="briefing__reminders">
          {data.reminders.map((reminder, index) => (
            <span key={index} className="chip chip--reminder">
              {reminder}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}
