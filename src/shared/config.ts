import { z } from 'zod';
import type { ComponentDescriptor } from './component.ts';

/** Where a component may be placed. Matches the CSS grid areas in src/client/styles/grid.css. */
export const GRID_AREAS = ['left', 'center', 'right', 'bottom'] as const;
export type GridArea = (typeof GRID_AREAS)[number];

const hexColour = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex colour like #4f9cf9');

/**
 * Tier 1 config: non-secret, safe to commit and safe to ship to the browser.
 * Everything personal that is NOT a secret lives here (coordinates, stop ids, timezone).
 * Secrets live only in environment variables — see src/server/lib/env.ts.
 */
export const publicConfigSchema = z.object({
  /** Shown in the header and used for weather attribution. */
  place: z.string().min(1).default('Home'),
  /** IANA timezone. Drives every date rendered anywhere. */
  timeZone: z.string().min(1).default('Europe/Oslo'),
  /** BCP-47 locale for date, time and number formatting. */
  locale: z.string().min(1).default('en-GB'),

  display: z
    .object({
      /**
       * Overscan compensation. TVs often crop a few percent of the picture.
       * Raise until nothing is clipped on your panel; 0 for a computer monitor.
       */
      safeAreaX: z.string().default('1.5%'),
      safeAreaY: z.string().default('1.5%'),
      /**
       * Root font size. Every size in the UI is a rem multiple of this, so this
       * single value scales the whole dashboard for your screen and viewing distance.
       */
      rootFontSize: z.string().default('clamp(15px, 0.83vw, 42px)'),
      /** Hide the mouse pointer. Wanted on a kiosk, unwanted while developing. */
      hideCursor: z.boolean().default(true),
      /** Nudge the layout a couple of pixels periodically to avoid burn-in. 0 disables. */
      pixelShiftMinutes: z.number().int().min(0).default(10),
    })
    .default({}),

  /** Component id -> placement. A component absent from here is not rendered. */
  layout: z
    .record(
      z.string(),
      z.object({
        area: z.enum(GRID_AREAS),
        /** Ascending within an area. */
        order: z.number().int().default(0),
        /** Relative vertical share of its area. Ignored in the `bottom` bar. */
        grow: z.number().min(0).default(1),
      }),
    )
    .default({}),

  /** Per-component config, validated against each manifest's `config` schema. */
  components: z.record(z.string(), z.unknown()).default({}),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type LayoutEntry = PublicConfig['layout'][string];

/** A calendar source parsed from CALENDAR_ICS_URLS. */
export const calendarSourceSchema = z.object({
  url: z.string().url(),
  label: z.string().min(1),
  colour: hexColour,
});
export type CalendarSource = z.infer<typeof calendarSourceSchema>;

/** What GET /api/config returns. */
export interface ClientBootstrap {
  config: PublicConfig;
  components: ComponentDescriptor[];
  version: { sha: string; builtAt: string };
}
