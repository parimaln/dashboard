# CI workflows — move these into place

These two files belong at `.github/workflows/`. They are parked here because the
session that wrote them was authenticated with an OAuth token lacking the
`workflow` scope, and GitHub refuses such a push:

```
refusing to allow an OAuth App to create or update workflow
`.github/workflows/ci.yml` without `workflow` scope
```

Nothing is wrong with the files — they simply could not be delivered to their real
path. Move them with one command:

```bash
mkdir -p .github && git mv docs/ci .github/workflows
git rm --cached .github/workflows/README.md && rm .github/workflows/README.md
git commit -m "Move CI workflows into place"
git push
```

Push from a machine whose credentials carry the `workflow` scope — a normal
`git push` over SSH, or a personal access token with that scope. Until then the
repository has no CI, and the documentation that refers to these workflows is
describing something that is not yet active.

## What they do

**`ci.yml`** runs on every pull request:

- typecheck, lint, and the 123 unit tests
- `npm run gen:env -- --check`, which fails if `.env.example` or the environment
  table in `docs/CONFIGURATION.md` has drifted from the component manifests
- a production build
- the Playwright layout suite, which fails the build if any element on the page
  becomes scrollable, if a panel body overflows, or if any text renders below 28px
  at 4K
- a Docker image build

**`release.yml`** runs on merge to `main`:

- injects `vars.PUBLIC_CONFIG` as `config/public.json` if that repository variable
  is set — Tier 1 config only, never a secret
- builds for `linux/amd64` and `linux/arm64` so the same image runs on a Pi or an
  ARM NAS
- pushes `ghcr.io/parimaln/dashboard:latest` and a `sha-` tag, stamping the commit
  into the build id the browser watches for

Once `release.yml` is active, merging a pull request is enough: Watchtower on your
Docker host pulls the new image and the dashboard reloads itself. See
[../INSTALL.md](../INSTALL.md).
