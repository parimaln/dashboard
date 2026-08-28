import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';
import { generateBriefing, type BriefingData } from './server.js';

export default defineComponent({
  id: 'ai-briefing',
  name: 'Daily briefing',
  description: 'One short, model-written summary joining together what the other panels show.',
  env: {
    required: ['AI_BASE_URL', 'AI_MODEL'],
    optional: ['AI_API_KEY', 'AI_PROMPT_PATH', 'HOUSEHOLD_PATH'],
    describe: {
      AI_BASE_URL:
        'An OpenAI-compatible /v1 endpoint. Ollama: http://host:11434/v1. LM Studio: http://host:1234/v1. Also works with vLLM, llama.cpp, OpenRouter or OpenAI itself.',
      AI_MODEL: 'Model id as that server names it, e.g. qwen2.5:14b-instruct.',
      AI_API_KEY: 'Sent as the bearer token. Local servers ignore it; set it for hosted providers.',
      AI_PROMPT_PATH: 'Override the system prompt file. Defaults to prompts/briefing.md in the image.',
      HOUSEHOLD_PATH:
        'Override the standing household notes file. Defaults to config/household.md. See config/household.example.md for what to put in it.',
    },
  },
  config: z.object({
    /** Documented so the prompt's context can be narrowed without editing code. */
    sources: z
      .array(z.string())
      .default(['weather-yr', 'calendar-ics', 'donetick', 'mealie', 'countdown', 'entur']),
    maxBullets: z.number().int().min(0).max(3).default(3),
    /** Reminders drawn from config/household.md that apply today. */
    maxReminders: z.number().int().min(0).max(4).default(3),
  }),
  // Inference is the most expensive thing on the board and the least time-critical.
  server: { refresh: '1h', handler: generateBriefing },
});

export type { BriefingData };
