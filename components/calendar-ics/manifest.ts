import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';
import { fetchCalendars, type CalendarData } from './server.js';

export default defineComponent({
  id: 'calendar-ics',
  name: 'Family calendar',
  description: 'Merges any number of iCal feeds into one colour-coded agenda.',
  env: {
    required: ['CALENDAR_ICS_URLS'],
    describe: {
      CALENDAR_ICS_URLS:
        'Comma-separated list of "url|Label|#colour". In Google Calendar use Settings → the calendar → "Secret address in iCal format". Treat these URLs as passwords: anyone holding one can read that calendar.',
    },
  },
  config: z.object({
    /** How far ahead to look. Events beyond this are never fetched. */
    daysAhead: z.number().int().min(1).max(365).default(90),
    /** Upper bound on events held in memory; the panel shows as many as fit. */
    maxEvents: z.number().int().min(1).max(200).default(30),
    showDeclined: z.boolean().default(false),
  }),
  server: { refresh: '10m', handler: fetchCalendars },
});

export type { CalendarData };
