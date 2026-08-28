# Components

A component is a folder in `components/`. There is no registry to edit, no
lifecycle to implement, and no base class to extend. Adding the folder installs
it; deleting the folder removes it completely.

```
components/countdown/
├── manifest.ts     required — identity, config, environment, data handler
├── panel.tsx       optional — the React view
├── server.ts       optional — where the data handler usually lives
├── README.md       optional
└── __tests__/      optional
```

The manifest and the panel are separate files on purpose. The manifest runs on the
server, where the credentials are; the panel runs in the browser, where they must
never go. Keeping them apart makes it impossible to leak a token into the bundle by
accident. They are linked by the folder name, which is also the component id.

## Changing an existing component

Most changes are one file.

**Change how something looks** → edit that component's `panel.tsx`.
Shared styling lives in `src/client/styles/panels.css`; the `.row`, `.chip` and
`.swatch` classes are there so panels look like each other without copying CSS.

**Change what data is fetched** → edit that component's `server.ts`. The handler
returns whatever object you like; the panel receives it as `data`.

**Change a refresh interval** → the `server.refresh` field in `manifest.ts`.
`"30s"`, `"10m"`, `"1h"`, or `false` to run only once at startup.

**Add a setting** → add it to the `config` schema in `manifest.ts` with a
`.default()`. It is validated at boot, available as `ctx.config` in the handler and
as `config` in the panel, and users set it under `components.<id>` in
`config/public.json`.

**Add a credential** → declare it in `env` in `manifest.ts`. That single
declaration makes the component hide itself when the value is missing, adds it to
`.env.example` and the docs table (`npm run gen:env`), and permits the handler to
read it. A handler may only read variables its manifest declares — reading an
undeclared one throws, naming the component and the fix.

**Move a panel somewhere else on screen** → that is configuration, not code. See
[CONFIGURATION.md](CONFIGURATION.md).

## Writing a new one

A worked example: a component showing the current electricity price.

### 1. Create the folder

```bash
mkdir -p components/power-price
```

The folder name is the component id. It must match the `id` in the manifest; the
server refuses to load a component where they disagree, because otherwise the
layout, the API and the panel lookup could quietly diverge.

### 2. Write the data handler

`components/power-price/server.ts`

```ts
import type { HandlerContext } from '../../src/shared/component.js';

export interface PowerPriceConfig {
  zone: string;
}

export interface PowerPriceData {
  nowOre: number;
  peakHour: number;
}

export async function fetchPrice(ctx: HandlerContext<PowerPriceConfig>): Promise<PowerPriceData> {
  const apiKey = ctx.requireEnv('POWER_API_KEY');

  // Use ctx.fetch, not global fetch: it applies a timeout, so a service that is
  // switched off cannot hang this component's refresh loop indefinitely.
  const res = await ctx.fetch(`https://example.com/prices?zone=${ctx.config.zone}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`price API returned ${res.status}`);

  const prices = (await res.json()) as { hour: number; ore: number }[];
  const currentHour = new Date().getHours();

  return {
    nowOre: prices.find((p) => p.hour === currentHour)?.ore ?? 0,
    peakHour: prices.reduce((a, b) => (a.ore > b.ore ? a : b)).hour,
  };
}
```

Throw on failure. Do not catch and return an empty result: the scheduler treats a
thrown error as "keep showing the previous data and mark it stale", which is what
you want. Swallowing the error tells the board everything is fine.

### 3. Write the manifest

`components/power-price/manifest.ts`

```ts
import { z } from 'zod';
import { defineComponent } from '../../src/shared/component.js';
import { fetchPrice, type PowerPriceData } from './server.js';

export default defineComponent({
  id: 'power-price',            // must equal the folder name
  name: 'Electricity price',
  description: 'Current spot price and when today peaks.',
  env: {
    required: ['POWER_API_KEY'],
    describe: {
      POWER_API_KEY: 'API key from your electricity provider.',
    },
  },
  config: z.object({
    zone: z.string().default('NO1'),
  }),
  server: { refresh: '30m', handler: fetchPrice },
});

export type { PowerPriceData };
```

### 4. Write the panel

`components/power-price/panel.tsx`

```tsx
import { Panel, PanelPlaceholder } from '../../src/client/lib/Panel.tsx';
import type { PanelProps } from '../../src/client/lib/panels.ts';
import type { PowerPriceData } from './server.ts';

export default function PowerPricePanel({
  data,
  stale,
}: PanelProps<PowerPriceData, { zone: string }>) {
  // data is null until the first successful refresh. Always handle it.
  if (!data) {
    return (
      <Panel title="Power" grow={0} stale={stale}>
        <PanelPlaceholder label="Loading prices…" />
      </Panel>
    );
  }

  return (
    <Panel title="Power" grow={0} stale={stale} staleReason="Price feed unreachable">
      <div className="tabular" style={{ fontSize: 'var(--text-xl)' }}>
        {data.nowOre} øre
      </div>
      <div className="muted">Peaks at {data.peakHour}:00</div>
    </Panel>
  );
}
```

### 5. Place it and run

Add it to `layout` in `config/public.json`, set `POWER_API_KEY` in `.env`, and
restart. That is the whole installation.

```json
"power-price": { "area": "center", "order": 3, "grow": 0 }
```

```bash
npm run gen:env    # picks up the new variable for .env.example and the docs
npm run dev
```

## Rules the layout depends on

The board is exactly one screen and **nothing scrolls** — it hangs on a wall, with
no keyboard and nobody close enough to reach it. A scrollbar is content that can
never be read. Two helpers exist so this is not simply lossy:

**`<AutoFit>`** renders as many items as physically fit and appends `+7 more`, so
a truncated list announces itself.

```tsx
<AutoFit items={events} itemKey={(e) => e.id}>
  {(event) => <div className="row">{event.title}</div>}
</AutoFit>
```

**`<Paged>`** rotates through a long list in place on a slow crossfade. Use it when
an unseen item is a problem — the chore list, where something invisible is
something that will not get done.

```tsx
<Paged items={chores} itemKey={(c) => c.id} intervalSeconds={20}>
  {(chore) => <div className="row">{chore.name}</div>}
</Paged>
```

Both measure the space they actually have, so they adapt to the panel's real size
on whatever screen this is running on. If your panel renders a list, use one of
them. `tests/e2e/layout.spec.ts` fails the build if anything on the page becomes
scrollable or if a panel body overflows.

Also: keep text at or above `var(--text-meta)`. That is the smallest size still
readable at three metres, and a test asserts nothing renders below 28px at 4K.

## Reading another component's data

A component can read what another is showing, on both sides:

```ts
// in a handler
const weather = ctx.readComponent<{ now: { temperatureC: number } }>('weather-yr');

// in a panel
const weather = read<{ now: { temperatureC: number } }>('weather-yr');
```

Both return `undefined` when that component is disabled or has not loaded yet, so
treat it as a bonus and never as a dependency. Type the shape structurally, as
above, rather than importing from the other component — that way your component
still compiles and runs if the other one is deleted.

The weather panel uses this: it prefers the model-written dressing sentence from
`ai-briefing` when there is one, and falls back to its own rule-generated
headline when there is not.

## Testing

Pure logic — parsing, bucketing, date maths — should be a plain function tested
without a network. See `components/weather-yr/__tests__/dress.test.ts` or
`components/donetick/__tests__/normalise.test.ts` for the pattern: export the
normaliser separately from the fetching, then test the normaliser against fixtures.

```bash
npm test                  # unit
npx playwright test       # layout, against the real server in MOCK mode
```

Drop a `tests/fixtures/<component-id>.json` file and `MOCK=1 npm start` will serve
it instead of calling your upstream, so the whole board can be developed and tested
with nothing configured.
