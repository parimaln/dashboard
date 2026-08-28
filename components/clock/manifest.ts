import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';

/**
 * The simplest possible component: no environment, no data handler.
 * Everything it needs it can compute in the browser, so it has a panel only.
 * Use this as the template for any purely presentational component.
 */
export default defineComponent({
  id: 'clock',
  name: 'Clock',
  description: 'Time, date and ISO week number.',
  config: z.object({
    /** 24-hour time is the default; set false for AM/PM. */
    hour24: z.boolean().default(true),
    showWeekNumber: z.boolean().default(true),
    showSeconds: z.boolean().default(false),
  }),
});
