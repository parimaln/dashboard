import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';
import { fetchWeather, type WeatherData } from './server.js';

export default defineComponent({
  id: 'weather-yr',
  name: 'Weather (yr / met.no)',
  description: 'Current conditions, five-day forecast, and rule-based advice on what to wear.',
  env: {
    optional: ['MET_USER_AGENT', 'WEATHER_PLACE'],
    describe: {
      MET_USER_AGENT:
        'Contact address sent to met.no, e.g. "you@example.com". Their terms of service require identifying your client; anonymous clients can be blocked.',
      WEATHER_PLACE: 'Optional label shown next to the temperature. Defaults to the global `place`.',
    },
  },
  config: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    /** How many days the forecast strip shows. */
    forecastDays: z.number().int().min(1).max(9).default(5),
  }),
  server: {
    // met.no updates roughly hourly and asks clients not to poll harder than the
    // Expires header allows; the handler additionally honours that header.
    refresh: '15m',
    handler: fetchWeather,
  },
});

export type { WeatherData };
