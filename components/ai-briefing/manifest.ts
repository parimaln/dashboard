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
    /** Donetick chore labels that always count as important, regardless of priority. */
    importantChoreLabels: z.array(z.string()).default([]),
    /** Calendar source labels (the "Label" in CALENDAR_ICS_URLS) that always count as important. */
    importantCalendarLabels: z.array(z.string()).default([]),
    /**
     * A chore counts as important when its Donetick priority is set and at most this
     * value (lower is more urgent; 0/unset never counts). 0 disables priority-based
     * importance entirely — see docs/AI.md before relying on this.
     */
    importantChorePriorityMax: z.number().int().min(0).max(4).default(0),
    /** Local hour (24h) at/after which the briefing also looks ahead to tomorrow. */
    eveningCutoffHour: z.number().int().min(0).max(23).default(16),
  }),
  // Inference is the most expensive thing on the board and the least time-critical.
  // activeClientsOnly: nobody pays for a model call while no browser has the
  // dashboard open; the scheduler catches up the moment one connects.
  server: { refresh: '1h', handler: generateBriefing, activeClientsOnly: true },
});

export type { BriefingData };
