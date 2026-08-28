import { Panel, PanelPlaceholder } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import { weekday, time } from '../../src/client/lib/format.ts';
import { weatherGlyph, describeSymbol } from './icons.ts';
import type { WeatherData } from './server.ts';

interface WeatherPanelConfig {
  forecastDays: number;
}

export default function WeatherPanel({ data, stale, format, read }: PanelProps<WeatherData, WeatherPanelConfig>) {
  if (!data) {
    return (
      <Panel title="Weather" grow={0} stale={stale}>
        <PanelPlaceholder label="Waiting for forecast…" />
      </Panel>
    );
  }

  const { now, dress, daily } = data;

  /*
   * Show only what the children need *beyond* what the adults need. Rendering the
   * full child advice repeats the adult headline word for word most of the time,
   * which costs two lines on a panel that is competing for column height and tells
   * the reader nothing new.
   */
  const adultAccessories = new Set(dress.adult.accessories);
  const childExtras = dress.child.accessories.filter((a) => !adultAccessories.has(a)).slice(0, 4);
  const childNote = [childExtras.join(' · '), dress.child.extraWarning].filter(Boolean).join(' · ');

  /*
   * The rules decide *what* to wear; the model, when one is configured, only
   * rephrases that decision in the context of the day. Structurally typed rather
   * than imported, so this component has no dependency on the briefing component
   * and works identically when it is absent.
   */
  const phrased = read<{ dressLine?: string }>('ai-briefing')?.dressLine;

  return (
    <Panel
      title="Weather"
      grow={0}
      stale={stale}
      staleReason="met.no unreachable — showing the last forecast"
      meta={
        <>
          {data.place}
          {data.sunrise && data.sunset && (
            <span className="tabular">
              {'  ↑'}
              {time(format, data.sunrise)} {'↓'}
              {time(format, data.sunset)}
            </span>
          )}
        </>
      }
    >
      <div className="weather__now">
        <span className="weather__glyph">{weatherGlyph(now.symbolCode)}</span>
        <div>
          <div className="weather__temp tabular">{now.temperatureC}°</div>
          <div className="muted">
            {describeSymbol(now.symbolCode)}
            {dress.adult.feelsLikeC !== now.temperatureC && (
              <span className="faint tabular"> · feels {dress.adult.feelsLikeC}°</span>
            )}
            <span className="faint tabular"> · {now.windSpeedMs} m/s</span>
          </div>
        </div>
      </div>

      <div className="weather__dress">
        <div style={{ fontWeight: 'var(--weight-medium)' }}>{phrased ?? dress.adult.headline}</div>
        <div className="muted" style={{ fontSize: 'var(--text-meta)', marginTop: '0.2rem' }}>
          {dress.adult.layers.join(' · ')}
          {dress.adult.accessories.length > 0 && ` · ${dress.adult.accessories.join(' · ')}`}
        </div>
        {dress.adult.warning && (
          <div style={{ color: 'var(--accent-warn)', fontSize: 'var(--text-meta)', marginTop: '0.25rem' }}>
            {dress.adult.warning}
          </div>
        )}
        {childNote && (
          <div className="faint" style={{ fontSize: 'var(--text-meta)', marginTop: '0.25rem' }}>
            Kids also: {childNote}
          </div>
        )}
      </div>

      <div className="weather__forecast">
        {daily.map((day) => (
          <div key={day.date} className="weather__day">
            <div className="faint" style={{ fontSize: 'var(--text-meta)' }}>
              {weekday(format, `${day.date}T12:00:00`)}
            </div>
            <div style={{ fontSize: 'var(--text-lg)', lineHeight: 1.1 }}>{weatherGlyph(day.symbolCode)}</div>
            <div className="tabular" style={{ fontWeight: 'var(--weight-bold)' }}>
              {day.maxC}°
              <span className="faint" style={{ fontWeight: 'var(--weight-regular)' }}>
                {' '}
                {day.minC}°
              </span>
            </div>
            {day.precipitationMm > 0 && (
              <div className="tabular" style={{ fontSize: 'var(--text-meta)', color: 'var(--accent)' }}>
                {day.precipitationMm} mm
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
