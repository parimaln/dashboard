import type { HandlerContext } from '../../src/shared/component.js';

export interface EnturConfig {
  fromStopId: string;
  toStopId: string;
  maxDepartures: number;
  walkingMinutes: number;
}

export interface Departure {
  /** Scheduled departure, ISO. */
  aimedTime: string;
  /** Real-time estimate where available, otherwise the aimed time. */
  expectedTime: string;
  minutesUntil: number;
  line: string;
  destination: string;
  mode: string;
  realtime: boolean;
  /** True when leaving now would not get you there in time. */
  unreachable: boolean;
}

export interface EnturData {
  from: string;
  to: string;
  departures: Departure[];
}

const QUERY = `
query trip($from: String!, $to: String!, $n: Int!) {
  trip(
    from: { place: $from }
    to: { place: $to }
    numTripPatterns: $n
    modes: { accessMode: foot, egressMode: foot }
  ) {
    tripPatterns {
      expectedStartTime
      aimedStartTime
      legs {
        mode
        realtime
        aimedStartTime
        expectedStartTime
        line { publicCode }
        fromEstimatedCall { destinationDisplay { frontText } }
        fromPlace { name }
        toPlace { name }
      }
    }
  }
}`;

interface TripLeg {
  mode?: string;
  realtime?: boolean;
  aimedStartTime?: string;
  expectedStartTime?: string;
  line?: { publicCode?: string } | null;
  fromEstimatedCall?: { destinationDisplay?: { frontText?: string } } | null;
  fromPlace?: { name?: string } | null;
  toPlace?: { name?: string } | null;
}

interface TripPattern {
  expectedStartTime?: string;
  aimedStartTime?: string;
  legs?: TripLeg[];
}

export function normalise(patterns: TripPattern[], config: EnturConfig, now: Date): Departure[] {
  const departures: Departure[] = [];

  for (const pattern of patterns) {
    // The first non-walking leg is the train or bus actually being caught.
    const leg = pattern.legs?.find((l) => l.mode && l.mode !== 'foot') ?? pattern.legs?.[0];
    if (!leg) continue;

    const expected = leg.expectedStartTime ?? pattern.expectedStartTime ?? leg.aimedStartTime;
    const aimed = leg.aimedStartTime ?? pattern.aimedStartTime ?? expected;
    if (!expected || !aimed) continue;

    const minutesUntil = Math.round((new Date(expected).getTime() - now.getTime()) / 60_000);
    if (minutesUntil < 0) continue;

    departures.push({
      aimedTime: aimed,
      expectedTime: expected,
      minutesUntil,
      line: leg.line?.publicCode ?? '',
      destination: leg.fromEstimatedCall?.destinationDisplay?.frontText ?? leg.toPlace?.name ?? '',
      mode: leg.mode ?? 'unknown',
      realtime: leg.realtime ?? false,
      // Surfacing this is the whole point of the panel: a departure you cannot
      // physically reach should look different from one you can.
      unreachable: minutesUntil < config.walkingMinutes,
    });
  }

  return departures.slice(0, config.maxDepartures);
}

export async function fetchDepartures(ctx: HandlerContext<EnturConfig>): Promise<EnturData> {
  // Entur asks every client to identify itself so they can contact heavy users.
  const clientName = ctx.env('ENTUR_CLIENT_NAME') ?? 'family-dashboard';

  const res = await ctx.fetch('https://api.entur.io/journey-planner/v3/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': clientName },
    body: JSON.stringify({
      query: QUERY,
      variables: { from: ctx.config.fromStopId, to: ctx.config.toStopId, n: ctx.config.maxDepartures * 2 },
    }),
  });

  if (!res.ok) throw new Error(`Entur returned ${res.status} ${res.statusText}`);

  const json = (await res.json()) as {
    data?: { trip?: { tripPatterns?: TripPattern[] } };
    errors?: { message: string }[];
  };
  if (json.errors?.length) throw new Error(`Entur: ${json.errors.map((e) => e.message).join('; ')}`);

  const patterns = json.data?.trip?.tripPatterns ?? [];
  const first = patterns[0]?.legs?.[0];

  return {
    from: first?.fromPlace?.name ?? ctx.config.fromStopId,
    to: ctx.config.toStopId,
    departures: normalise(patterns, ctx.config, new Date()),
  };
}
