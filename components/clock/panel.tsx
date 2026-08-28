import { Panel } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import { useNow } from '../../src/client/lib/store.ts';
import { isoWeek } from '../../src/client/lib/format.ts';

interface ClockConfig {
  hour24: boolean;
  showWeekNumber: boolean;
  showSeconds: boolean;
}

export default function ClockPanel({ config, format }: PanelProps<null, ClockConfig>) {
  // Ticking every second even when seconds are hidden keeps the minute change
  // sharp; the cost is one re-render of two text nodes.
  const now = useNow(1_000);

  const time = now.toLocaleTimeString(format.locale, {
    timeZone: format.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(config.showSeconds ? { second: '2-digit' } : {}),
    hour12: !config.hour24,
  });

  const date = now.toLocaleDateString(format.locale, {
    timeZone: format.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <Panel grow={0} bare>
      <div className="clock__time tabular">{time}</div>
      <div className="clock__meta">
        <span>{date}</span>
        {config.showWeekNumber && <span className="faint tabular">Week {isoWeek(now)}</span>}
      </div>
    </Panel>
  );
}
