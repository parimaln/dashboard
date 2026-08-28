import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';
import { fetchChores, type DonetickData } from './server.js';

export default defineComponent({
  id: 'donetick',
  name: 'Chores (Donetick)',
  description: 'Household chores from a self-hosted Donetick instance, overdue first.',
  env: {
    required: ['DONETICK_BASE_URL', 'DONETICK_TOKEN'],
    describe: {
      DONETICK_BASE_URL: 'Base URL of your Donetick instance on the LAN, e.g. http://donetick.lan:2021 (no trailing slash).',
      DONETICK_TOKEN: 'A Donetick access token. Settings → Access Tokens. Sent in the `secretkey` header.',
    },
  },
  config: z.object({
    maxChores: z.number().int().min(1).max(200).default(40),
    hideCompleted: z.boolean().default(true),
    /** Chores further out than this are noise on a wall display. */
    lookaheadDays: z.number().int().min(1).max(365).default(21),
  }),
  server: { refresh: '5m', handler: fetchChores },
});

export type { DonetickData };
