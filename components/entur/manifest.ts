import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';
import { fetchDepartures, type EnturData } from './server.js';

export default defineComponent({
  id: 'entur',
  name: 'Entur departures',
  description: 'Next public-transport departures between two Norwegian stop places.',
  env: {
    optional: ['ENTUR_CLIENT_NAME'],
    describe: {
      ENTUR_CLIENT_NAME:
        'Identifier sent to Entur as ET-Client-Name, e.g. "surname-dashboard". Entur asks all clients to identify themselves. No account or key is needed.',
    },
  },
  config: z.object({
    /** Find stop ids at https://stoppested.entur.org — they look like NSR:StopPlace:337. */
    fromStopId: z.string().regex(/^NSR:StopPlace:\d+$/, 'expected an id like NSR:StopPlace:337'),
    toStopId: z.string().regex(/^NSR:StopPlace:\d+$/, 'expected an id like NSR:StopPlace:337'),
    maxDepartures: z.number().int().min(1).max(12).default(5),
    /** Minutes needed to reach the platform; earlier departures are dimmed as unreachable. */
    walkingMinutes: z.number().int().min(0).max(60).default(8),
  }),
  server: { refresh: '60s', handler: fetchDepartures },
});

export type { EnturData };
