import type { HandlerContext } from '../../src/shared/component.js';
import { dressAdvice, type DressReport } from './dress.js';
import { solarTimes, isDaylight } from './sun.js';

export interface WeatherConfig {
  lat: number;
  lon: number;
  forecastDays: number;
}

export interface DailyPoint {
  /** ISO date in the configured timezone, e.g. "2026-09-25". */
  date: string;
  minC: number;
  maxC: number;
  symbolCode: string;
  precipitationMm: number;
}

export interface WeatherData {
  place: string;
  now: {
    temperatureC: number;
    symbolCode: string;
    windSpeedMs: number;
    windGustMs?: number;
    humidity?: number;
    uvIndex?: number;
    precipitationMm: number;
    isDaylight: boolean;
  };
  sunrise: string | null;
  sunset: string | null;
  daily: DailyPoint[];
  dress: DressReport;
}

/** Shape of the slice of met.no's locationforecast/2.0/complete response we use. */
interface MetSeries {
  time: string;
  data: {
    instant: {
      details: {
        air_temperature?: number;
        wind_speed?: number;
        wind_speed_of_gust?: number;
        relative_humidity?: number;
        ultraviolet_index_clear_sky?: number;
      };
    };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: {
      summary?: { symbol_code?: string };
      details?: { precipitation_amount?: number; air_temperature_max?: number; air_temperature_min?: number };
    };
    next_12_hours?: { summary?: { symbol_code?: string } };
  };
}

/**
 * met.no's terms require conditional requests rather than re-downloading an
 * unchanged forecast, and require identifying the client. Both are cheap here
 * because the server is the only thing calling them.
 */
let cached: { expires: number; lastModified?: string; body?: unknown } = { expires: 0 };

/** Exposed so tests can start from a clean slate. */
export function resetWeatherCache(): void {
  cached = { expires: 0 };
}

function localDate(iso: string, timeZone: string): string {
  // en-CA renders as YYYY-MM-DD, which is exactly the key we want to group on.
  return new Date(iso).toLocaleDateString('en-CA', { timeZone });
}

export function normalise(series: MetSeries[], config: WeatherConfig, timeZone: string, now: Date): Omit<WeatherData, 'place'> {
  const first = series[0];
  if (!first) throw new Error('met.no returned an empty forecast');

  const instant = first.data.instant.details;
  const temperatureC = instant.air_temperature ?? 0;
  const windSpeedMs = instant.wind_speed ?? 0;

  // The current symbol lives on the next_1_hours block, which met.no drops from
  // later entries; fall back through the coarser windows rather than showing nothing.
  const symbolCode =
    first.data.next_1_hours?.summary?.symbol_code ??
    first.data.next_6_hours?.summary?.symbol_code ??
    first.data.next_12_hours?.summary?.symbol_code ??
    'cloudy';

  // Dress advice looks six hours ahead, so a dry morning still warns about the
  // afternoon it is about to rain into.
  const precipitationNext6h = series
    .slice(0, 6)
    .reduce((sum, s) => sum + (s.data.next_1_hours?.details?.precipitation_amount ?? 0), 0);

  // Group into local days. met.no thins to six-hourly beyond ~2 days, so both the
  // hourly and the six-hourly blocks have to contribute.
  const byDay = new Map<string, { temps: number[]; precip: number; symbols: Map<string, number>; middaySymbol?: string }>();
  for (const s of series) {
    const date = localDate(s.time, timeZone);
    let day = byDay.get(date);
    if (!day) {
      day = { temps: [], precip: 0, symbols: new Map() };
      byDay.set(date, day);
    }
    const t = s.data.instant.details.air_temperature;
    if (t !== undefined) day.temps.push(t);

    const sixHour = s.data.next_6_hours?.details;
    if (sixHour?.air_temperature_max !== undefined) day.temps.push(sixHour.air_temperature_max);
    if (sixHour?.air_temperature_min !== undefined) day.temps.push(sixHour.air_temperature_min);

    day.precip += s.data.next_1_hours?.details?.precipitation_amount ?? sixHour?.precipitation_amount ?? 0;

    const symbol = s.data.next_6_hours?.summary?.symbol_code ?? s.data.next_1_hours?.summary?.symbol_code;
    if (symbol) {
      day.symbols.set(symbol, (day.symbols.get(symbol) ?? 0) + 1);
      // A day is best characterised by its middle, not by whatever it happened to
      // be doing at midnight.
      const hour = Number(new Date(s.time).toLocaleString('en-GB', { timeZone, hour: '2-digit', hour12: false }));
      if (hour >= 11 && hour <= 14) day.middaySymbol ??= symbol;
    }
  }

  const daily: DailyPoint[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, config.forecastDays)
    .map(([date, day]) => {
      const dominant = [...day.symbols.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        date,
        minC: day.temps.length ? Math.round(Math.min(...day.temps)) : 0,
        maxC: day.temps.length ? Math.round(Math.max(...day.temps)) : 0,
        symbolCode: day.middaySymbol ?? dominant ?? 'cloudy',
        precipitationMm: Math.round(day.precip * 10) / 10,
      };
    });

  const sun = solarTimes(now, config.lat, config.lon);
  const daylight = isDaylight(now, config.lat, config.lon);

  return {
    now: {
      temperatureC: Math.round(temperatureC),
      symbolCode,
      windSpeedMs: Math.round(windSpeedMs * 10) / 10,
      windGustMs: instant.wind_speed_of_gust,
      humidity: instant.relative_humidity,
      uvIndex: instant.ultraviolet_index_clear_sky,
      precipitationMm: Math.round(precipitationNext6h * 10) / 10,
      isDaylight: daylight,
    },
    sunrise: sun.sunrise?.toISOString() ?? null,
    sunset: sun.sunset?.toISOString() ?? null,
    daily,
    dress: dressAdvice({
      temperatureC,
      windSpeedMs,
      windGustMs: instant.wind_speed_of_gust,
      precipitationMm: precipitationNext6h,
      symbolCode,
      uvIndex: instant.ultraviolet_index_clear_sky,
      isDaylight: daylight,
    }),
  };
}

export async function fetchWeather(ctx: HandlerContext<WeatherConfig>): Promise<WeatherData> {
  const config = ctx.config;
  const place = ctx.env('WEATHER_PLACE') ?? '';

  // A real contact address is met.no's condition of use. The browser cannot set
  // User-Agent at all, which is why the previous version of this dashboard was
  // anonymous to them; from the server it is simply a header.
  const contact = ctx.env('MET_USER_AGENT');
  if (!contact) {
    ctx.log('MET_USER_AGENT is not set — met.no asks for a contact address and may block anonymous clients');
  }
  const userAgent = `family-dashboard/1.0 ${contact ?? '(no contact configured)'}`;

  const url = new URL('https://api.met.no/weatherapi/locationforecast/2.0/complete');
  // met.no asks for coordinates truncated to four decimals; more precision is
  // rejected as needlessly cache-busting.
  url.searchParams.set('lat', config.lat.toFixed(4));
  url.searchParams.set('lon', config.lon.toFixed(4));

  const now = Date.now();
  let body = cached.body;

  if (!body || now >= cached.expires) {
    const headers: Record<string, string> = { 'User-Agent': userAgent, Accept: 'application/json' };
    if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;

    const res = await ctx.fetch(url, { headers });

    if (res.status === 304 && cached.body) {
      // Nothing changed; honour the new Expires and keep serving what we have.
      cached.expires = expiresFrom(res, now);
      body = cached.body;
    } else if (res.status === 429 || res.status === 203) {
      // 203 is met.no's deprecation signal; 429 is throttling. Both mean back off.
      if (!cached.body) throw new Error(`met.no returned ${res.status} and there is no cached forecast`);
      cached.expires = now + 30 * 60_000;
      body = cached.body;
    } else if (!res.ok) {
      throw new Error(`met.no returned ${res.status} ${res.statusText}`);
    } else {
      body = await res.json();
      cached = {
        body,
        expires: expiresFrom(res, now),
        lastModified: res.headers.get('last-modified') ?? undefined,
      };
    }
  }

  const series = (body as { properties?: { timeseries?: MetSeries[] } })?.properties?.timeseries;
  if (!series?.length) throw new Error('met.no response did not contain a timeseries');

  return { place, ...normalise(series, config, ctx.timeZone, new Date()) };
}

function expiresFrom(res: Response, now: number): number {
  const header = res.headers.get('expires');
  const parsed = header ? Date.parse(header) : NaN;
  // Never poll faster than every ten minutes regardless of what Expires says.
  return Number.isNaN(parsed) ? now + 30 * 60_000 : Math.max(parsed, now + 10 * 60_000);
}
