# Installing

## Why this has to run on your own network

The dashboard reads from services on your LAN — Mealie, Donetick, a local language
model. It is tempting to host the page itself somewhere public (GitHub Pages, a
VPS) and just point it at your home network. That does not work, and it is worth
understanding why before you try.

A page served from `https://something.github.io` has a **public HTTPS origin**.
Opening that URL on a machine inside your own network does not change its origin.
Chrome will then block it from reaching `http://192.168.1.50:9000` on two separate
grounds:

- **Mixed content** — an HTTPS page may not make plain HTTP subresource requests.
- **Private Network Access** — a page from a public origin may not request a
  private IP address at all, even over HTTPS.

No amount of CORS configuration on Mealie or Donetick changes either rule; CORS is
a different mechanism answering a different question. (`http://localhost` is
exempt from both, but your services are on other machines.)

So the dashboard is a small server that you run on your own network. The browser
talks only to that server, and that server talks to everything else. This also
means your API tokens never reach the browser at all, which is a better outcome
than the alternative was ever going to be.

## Running it

Run it on the same Docker host as Mealie and Donetick — it is a small Node
process and needs almost nothing.

```bash
mkdir -p ~/dashboard && cd ~/dashboard

curl -O https://raw.githubusercontent.com/parimaln/dashboard/main/compose.example.yml
curl -o .env https://raw.githubusercontent.com/parimaln/dashboard/main/.env.example
mv compose.example.yml compose.yml

mkdir -p config
curl -o config/public.json     https://raw.githubusercontent.com/parimaln/dashboard/main/config/public.example.json
curl -o config/events.json     https://raw.githubusercontent.com/parimaln/dashboard/main/config/events.json
curl -o config/household.md    https://raw.githubusercontent.com/parimaln/dashboard/main/config/household.example.md

# Edit .env and config/public.json, then:
docker compose up -d
```

Open `http://<that host>:8080`. Anything not yet configured shows on a setup
screen naming exactly which variable it is waiting for, so you can bring services
online one at a time rather than all at once.

The published image contains **no secrets**: every token and LAN address is read
from your `.env` at container start. That is what makes the image safe to publish
and reusable by other people.

### Building it yourself instead

```bash
git clone https://github.com/parimaln/dashboard.git && cd dashboard
docker build -f docker/Dockerfile -t dashboard .
docker run -d --env-file .env -p 8080:8080 \
  -v "$PWD/config:/app/config:ro" dashboard
```

### Without Docker

```bash
npm ci && npm run build && npm start
```

Node 20 or newer. Put it behind a systemd unit if you want it to survive a reboot.

## Getting the credentials

| Service | Where to find it |
| --- | --- |
| **Calendars** | Google Calendar → Settings → pick the calendar → *Secret address in iCal format*. Repeat per calendar. These URLs are passwords: anyone holding one can read that calendar, so keep them in `.env` and never in git. |
| **Mealie** | Your Mealie instance → Profile → API Tokens → create one. |
| **Donetick** | Donetick → Settings → Access Tokens. Sent in the `secretkey` header. |
| **Entur** | No account needed. Find stop ids at <https://stoppested.entur.org>; they look like `NSR:StopPlace:337`. |
| **met.no** | No account needed, but their terms require identifying your client. Put a contact address in `MET_USER_AGENT`. |
| **Language model** | Any OpenAI-compatible `/v1` endpoint. See [AI.md](AI.md). |

## Keeping it up to date

The `compose.example.yml` includes [Watchtower](https://containrrr.dev/watchtower/),
which closes the loop between merging a change and the wall display showing it:

```
merge a pull request
  → CI publishes ghcr.io/parimaln/dashboard:latest
  → Watchtower pulls it within its poll interval (5 minutes by default)
  → the container restarts
  → the browser sees a new build id on the event stream and reloads itself
```

No inbound ports, no webhooks, no tunnel. If you would rather update by hand,
delete the `watchtower` service and run `docker compose pull && docker compose up -d`.

## Keeping the data fresh

Each component declares its own refresh interval in its manifest — departures
every minute, chores every five, weather every fifteen. Updates are pushed to the
browser over a single Server-Sent Events stream, so panels update as soon as new
data exists rather than on a polling delay.

Three things can still leave a wall display quietly showing yesterday:

- **The host suspends.** Timers do not fire while a machine is asleep. A watchdog
  sweeps every 30 seconds and re-runs anything overdue, so the board is correct
  within half a minute of the machine waking.
- **The television was off for hours.** Browsers throttle hidden tabs hard and may
  drop the stream. The page re-pulls a full snapshot whenever it becomes visible
  again, so what you see on switching the TV back on is current.
- **A refresh is wedged rather than failing.** Data older than 2.5× its refresh
  interval is marked stale and the panel dims with a small amber dot, whether or
  not anything threw.

The rule throughout: a panel never blanks and never silently lies. It either shows
current data, or it shows the last good data and says that it is old.

## Troubleshooting

**A panel says "Waiting for…" forever.** Check the container logs — the component
names its own failure: `docker compose logs -f dashboard`.

**A component is missing entirely.** It is either absent from `layout` in
`config/public.json`, or missing a required variable. The setup screen at
`http://<host>:8080` lists both.

**The whole page is a setup screen.** Nothing is configured yet, or
`config/public.json` failed to parse. The logs name the exact field.

**met.no returns 403.** Set `MET_USER_AGENT` to a real contact address.

**Mealie returns 404.** Path differences between Mealie versions are handled
automatically; a 404 from both candidates usually means `MEALIE_BASE_URL` has a
trailing slash or the wrong port.
