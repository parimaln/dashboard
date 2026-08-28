# Configuration

Configuration comes in two tiers, split by whether it is a secret.

| | Tier 1 — public | Tier 2 — secret |
| --- | --- | --- |
| Lives in | `config/public.json` | `.env` on the host |
| Holds | location, layout, stop ids, display settings | tokens, LAN addresses, calendar URLs |
| Reaches the browser | yes | **never** |
| In the published image | yes | **never** |
| Safe to commit | yes | no |

This split is the reason the container image can be public: it contains no
credentials, so anyone can run it and supply their own.

`config/public.json` is gitignored, because it holds your coordinates and your
transit stops. `config/public.example.json` is committed as the starting point,
and the server falls back to it so a fresh clone still renders something.

## config/public.json

```json
{
  "place": "Oslo",
  "timeZone": "Europe/Oslo",
  "locale": "en-GB",

  "display": {
    "safeAreaX": "1.5%",
    "safeAreaY": "1.5%",
    "rootFontSize": "clamp(15px, 0.83vw, 42px)",
    "hideCursor": true,
    "pixelShiftMinutes": 10
  },

  "layout": {
    "clock":        { "area": "left",   "order": 0, "grow": 0 },
    "calendar-ics": { "area": "left",   "order": 1, "grow": 1 }
  },

  "components": {
    "weather-yr": { "lat": 59.9139, "lon": 10.7522, "forecastDays": 5 }
  }
}
```

### Top level

| Key | Meaning |
| --- | --- |
| `place` | Label shown beside the temperature. |
| `timeZone` | IANA zone. Drives every date on the board — set this before anything else. |
| `locale` | BCP-47 tag for date, time and number formatting. |

### `display`

Covered in [DISPLAY.md](DISPLAY.md) — screen size, overscan, and how the whole
board scales from one value.

### `layout`

Maps a component id to where it goes. **A component absent from `layout` does not
render and does not run**, which is how you switch one off without deleting it.

| Key | Meaning |
| --- | --- |
| `area` | `left`, `center`, `right` or `bottom`. |
| `order` | Ascending within an area. |
| `grow` | Share of the remaining space. `0` means "only as tall as its content". |

The three columns are full height; `bottom` is a wide, short bar across all of
them. `grow` works along the area's axis: height in a column, width in the bottom
bar. So two panels in `bottom` with `grow: 1` each take half the width.

A layout entry naming a component that does not exist stops the server at boot with
an error naming it, rather than silently rendering nothing.

### `components`

Each component's own settings, keyed by id, validated against the schema in its
manifest. An invalid value stops the boot with a message naming the exact field —
`config.components.entur.fromStopId: expected an id like NSR:StopPlace:337` — rather
than failing mysteriously at runtime.

Anything you leave out gets the manifest's default, so you only need to specify
what you want to change.

## Environment variables

Everything secret. Copy `.env.example` to `.env` and fill in what applies.

`.env.example` and the table below are **generated from the component manifests**
by `npm run gen:env`, so they cannot drift from the code. CI fails if they are out
of date.

<!-- BEGIN GENERATED ENV TABLE -->

| Variable | Component | Required | Description |
| --- | --- | --- | --- |
| `PORT` | core | no | HTTP port to listen on (default 8080). |
| `HOST` | core | no | Interface to bind (default 0.0.0.0). |
| `CONFIG_PATH` | core | no | Path to public.json (default ./config/public.json). |
| `MOCK` | core | no | Set to 1 to serve fixture data instead of calling any upstream. Used by tests. |
| `LOG_LEVEL` | core | no | error \| warn \| info \| debug (default info). |
| `CLIENT_DIR` | core | no | Path to the built client, relative to the working directory (default dist/client). |
| `AI_BASE_URL` | ai-briefing | yes | An OpenAI-compatible /v1 endpoint. Ollama: http://host:11434/v1. LM Studio: http://host:1234/v1. Also works with vLLM, llama.cpp, OpenRouter or OpenAI itself. |
| `AI_MODEL` | ai-briefing | yes | Model id as that server names it, e.g. qwen2.5:14b-instruct. |
| `AI_API_KEY` | ai-briefing | no | Sent as the bearer token. Local servers ignore it; set it for hosted providers. |
| `AI_PROMPT_PATH` | ai-briefing | no | Override the system prompt file. Defaults to prompts/briefing.md in the image. |
| `HOUSEHOLD_PATH` | ai-briefing | no | Override the standing household notes file. Defaults to config/household.md. See config/household.example.md for what to put in it. |
| `CALENDAR_ICS_URLS` | calendar-ics | yes | Comma-separated list of "url\|Label\|#colour". In Google Calendar use Settings → the calendar → "Secret address in iCal format". Treat these URLs as passwords: anyone holding one can read that calendar. |
| `COUNTDOWN_EVENTS_PATH` | countdown | no | Override the path to the events file. Useful for mounting a file you edit outside the image. |
| `DONETICK_BASE_URL` | donetick | yes | Base URL of your Donetick instance on the LAN, e.g. http://donetick.lan:2021 (no trailing slash). |
| `DONETICK_TOKEN` | donetick | yes | A Donetick access token. Settings → Access Tokens. Sent in the `secretkey` header. |
| `ENTUR_CLIENT_NAME` | entur | no | Identifier sent to Entur as ET-Client-Name, e.g. "surname-dashboard". Entur asks all clients to identify themselves. No account or key is needed. |
| `MEALIE_BASE_URL` | mealie | yes | Base URL of your Mealie instance on the LAN, e.g. http://mealie.lan:9000 (no trailing slash). |
| `MEALIE_TOKEN` | mealie | yes | Long-lived API token from Mealie under Profile → API Tokens. |
| `MET_USER_AGENT` | weather-yr | no | Contact address sent to met.no, e.g. "you@example.com". Their terms of service require identifying your client; anonymous clients can be blocked. |
| `WEATHER_PLACE` | weather-yr | no | Optional label shown next to the temperature. Defaults to the global `place`. |

<!-- END GENERATED ENV TABLE -->

## Configuration from GitHub

If you build your own image with the included `release.yml`, set a repository
variable named `PUBLIC_CONFIG` (Settings → Secrets and variables → Actions →
Variables) containing the whole of `config/public.json`. It is baked into the image
at build time.

Only put Tier 1 values there. It is a *variable*, not a secret, and it ends up
readable inside a published image — which is exactly right for coordinates and
layout, and exactly wrong for a token. Secrets stay in the `.env` on your host,
where they are read at container start.
