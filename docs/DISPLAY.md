# The display

## Scaling

Every size in the dashboard is a `rem` multiple of one root font size. Change that
one value and the entire board scales together — type, spacing, panels, icons.

```json
"display": { "rootFontSize": "clamp(15px, 0.83vw, 42px)" }
```

`0.83vw` resolves to about 34px on a 4096-wide panel. The `clamp` floor and ceiling
keep it sensible on a laptop and on an 8K screen respectively.

Rough starting points, assuming you are looking at it from across a room:

| Screen | Suggested |
| --- | --- |
| 55" 4K television, 2–3 m away | `clamp(15px, 0.83vw, 42px)` (the default) |
| 43" 4K, 2 m away | `clamp(15px, 0.78vw, 40px)` |
| 27" 1440p monitor, 1 m away | `clamp(13px, 0.95vw, 24px)` |
| 1080p television | `clamp(13px, 1.35vw, 26px)` |

Too small is the common mistake: text that is comfortable while you are setting it
up on a laptop is unreadable from the sofa. Set it, then go and stand where you
will actually be standing.

The smallest thing that renders is `--text-meta`, at about 29px on a 4K panel.
`tests/e2e/layout.spec.ts` fails the build if anything drops below 28px there.

## Overscan

Televisions frequently crop a few percent off every edge. If the clock or the
countdown bar looks cut off, raise the safe area:

```json
"display": { "safeAreaX": "2.5%", "safeAreaY": "2.5%" }
```

Raise it until nothing is clipped. On a computer monitor set both to `0`. Many TVs
also have a picture setting — often *Screen Fit*, *Just Scan* or *1:1* — that turns
overscan off entirely, which is better than compensating for it.

## Aspect ratio

Nothing is hardcoded to 16:9. The layout derives entirely from viewport units, so
it works on a 16:9 television, a 4096×2160 DCI panel (1.896:1, which is what a
Samsung Frame reports), an ultrawide, or a laptop. It has not been designed for
portrait; if you want that, change `grid-template-areas` in
`src/client/styles/grid.css` and move components between areas in
`config/public.json`.

## Nothing scrolls

A wall display has no keyboard and nobody standing close enough to reach it, so a
scrollbar is content nobody will ever read. Every panel is `overflow: hidden`, and
lists handle it honestly instead:

- **`<AutoFit>`** renders what fits and appends `+7 more`, so a truncated list says
  that it is truncated.
- **`<Paged>`** rotates through pages on a slow crossfade, for lists where an unseen
  item is a real problem — the chores.

Both measure the space they actually have, so they adapt to your screen. A test
asserts that no element on the page is scrollable and that no panel body overflows.

## Screen burn

The board is a nearly static image left on a television for hours, which is the
exact condition that wears a panel unevenly. Three things mitigate it:

- A dark palette with no large bright fills.
- The whole layout drifts a couple of pixels every ten minutes
  (`display.pixelShiftMinutes`; set `0` to disable).
- No panel is pure white.

If your television has its own pixel-shift or screen-saver features, leave them on.

## Kiosk setup

The dashboard is one URL in a fullscreen browser. On the machine attached to the
television:

```bash
chromium \
  --kiosk \
  --app=http://dashboard.lan:8080 \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required
```

Run it as a systemd **user** service so it starts on login and can be stopped and
started by name — which is also what makes voice control work. See
[AUTOMATION.md](AUTOMATION.md) and `docs/kiosk/dashboard-kiosk.service`.

You do not need to worry about the browser going stale: the page reloads itself
when the container is replaced by a newer image, and re-pulls its data whenever the
television is switched back on.

## Fonts

There is no web font. The system UI stack is used instead, which means the CSP
stays at `font-src 'self'` with nothing to fetch, and the board renders correctly
when the internet is down — which matters, because the kiosk usually boots before
the WAN link is up.

To use a specific typeface, put the `woff2` in `public/fonts/` and add an
`@font-face` rule at the top of `src/client/styles/panels.css`. Self-host it; do
not add a CDN link, or the board will render in a fallback font whenever your
connection is down.

## Developing without the television

```
http://localhost:5173/?preview=4096x2160
```

Letterboxes the layout at the real panel's aspect ratio and scale inside an
ordinary browser window. Any `WxH` works, so you can check other people's screens
too.
