import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';
import { loadCountdowns, type CountdownData } from './server.js';

export default defineComponent({
  id: 'countdown',
  name: 'Countdowns',
  description: 'Days remaining until dates you care about. Edit config/events.json.',
  env: {
    optional: ['COUNTDOWN_EVENTS_PATH'],
    describe: {
      COUNTDOWN_EVENTS_PATH:
        'Override the path to the events file. Useful for mounting a file you edit outside the image.',
    },
  },
  config: z.object({
    maxEvents: z.number().int().min(1).max(20).default(6),
    /** Keep an event on screen this many days after it passes. */
    hidePastDays: z.number().int().min(0).max(30).default(0),
  }),
  // Cheap and local; hourly is enough to roll over at midnight without drift.
  server: { refresh: '1h', handler: loadCountdowns },
});

export type { CountdownData };
