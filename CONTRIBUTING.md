# Contributing

## Getting set up

```bash
npm install
npm run build
MOCK=1 npm start      # http://localhost:8080 with fixture data, nothing to configure
```

`MOCK=1` serves `tests/fixtures/*.json` instead of calling any upstream, so you can
work on the whole board without a Mealie instance, a calendar, or a GPU.

For live development with hot reload:

```bash
npm run dev           # http://localhost:5173
```

Use `?preview=4096x2160` to see the layout at television scale in a normal window.

## Before opening a pull request

```bash
npm run typecheck
npm run lint
npm test
npm run gen:env -- --check   # .env.example and the docs table are generated
npx playwright test          # layout rules
```

CI runs all of these plus a Docker build.

## Things the tests enforce

Two rules are easy to break with an innocent CSS change and impossible to verify by
eye, so they are checked mechanically:

- **Nothing on the page may be scrollable**, and no panel body may overflow.
- **No text may render below 28px** at 4K.

If you are adding a list to a panel, use `<AutoFit>` or `<Paged>` rather than
letting it overflow. See [docs/COMPONENTS.md](docs/COMPONENTS.md).

## Adding a component

A component is a folder in `components/`. There is nothing to register.
[docs/COMPONENTS.md](docs/COMPONENTS.md) walks through building one end to end.

Two things to get right:

- **Declare every environment variable in the manifest.** That declaration is what
  makes the component hide itself when unconfigured, and what generates
  `.env.example` and the documentation table. A handler cannot read an undeclared
  variable.
- **Throw when a fetch fails.** The scheduler turns a thrown error into "keep the
  previous data and mark it stale". Catching and returning an empty result tells
  the board that everything is fine when it is not.

## What not to put in a commit

- API tokens, calendar URLs, coordinates, or anything else personal. `.env`,
  `config/public.json` and `config/household.md` are gitignored for this reason —
  commit the `.example` versions instead.
- CDN links. Everything is served locally so the board works with the internet
  down.

## Style

Match the surrounding code. Comments should explain why something is the way it
is, particularly where the reason is a physical constraint of the display — no
keyboard, three metres away, running for months without anyone looking at a log.
