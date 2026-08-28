import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';
import { fetchMealPlan, resolveImage, type MealieData } from './server.js';

export default defineComponent({
  id: 'mealie',
  name: 'Meal plan (Mealie)',
  description: "What is planned to cook today and tomorrow, from a self-hosted Mealie instance.",
  env: {
    required: ['MEALIE_BASE_URL', 'MEALIE_TOKEN'],
    describe: {
      MEALIE_BASE_URL: 'Base URL of your Mealie instance on the LAN, e.g. http://mealie.lan:9000 (no trailing slash).',
      MEALIE_TOKEN: 'Long-lived API token from Mealie under Profile → API Tokens.',
    },
  },
  config: z.object({
    /** 2 gives today and tomorrow, which is what a dinner decision actually needs. */
    days: z.number().int().min(1).max(7).default(2),
    showImages: z.boolean().default(true),
  }),
  server: { refresh: '15m', handler: fetchMealPlan, images: resolveImage },
});

export type { MealieData };
