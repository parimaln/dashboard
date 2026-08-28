import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import path from 'node:path';
import type { ComponentDescriptor } from '../shared/component.js';
import type { ClientBootstrap } from '../shared/config.js';
import { loadRegistry } from './lib/registry.js';
import { loadConfig } from './lib/config.js';
import { auditEnv } from './lib/env.js';
import { Scheduler } from './lib/scheduler.js';
import { logger } from './lib/log.js';
import { registerImageProxy } from './routes/image.js';

const log = logger('server');

const VERSION = {
  sha: process.env.BUILD_SHA ?? 'dev',
  builtAt: process.env.BUILD_TIME ?? new Date().toISOString(),
};

/** Like config/ and prompts/, the built client resolves from the working directory. */
const CLIENT_DIR = path.resolve(process.cwd(), process.env.CLIENT_DIR ?? 'dist/client');

async function main() {
  const { components: loaded, problems } = await loadRegistry();
  for (const problem of problems) log.error(`component "${problem.id}" failed to load`, { error: problem.error });

  const definitions = loaded.map((c) => c.definition);
  const { config, componentConfig, errors, source } = await loadConfig(definitions);

  if (errors.length > 0) {
    log.error('configuration is invalid:');
    for (const error of errors) log.error(`  - ${error}`);
    process.exit(1);
  }

  const { missingByComponent } = auditEnv(definitions);

  // In mock mode the fixtures stand in for every upstream, so missing credentials
  // must not disable a component — the point is to render the whole board.
  const mock = process.env.MOCK === '1';
  if (mock) log.warn('MOCK=1 — serving fixture data, no upstream will be contacted');

  // A component is enabled when it is placed in the layout AND has all its
  // required env. Anything else is reported to the browser as a disabled
  // descriptor so the setup screen can say exactly what is missing.
  const descriptors: ComponentDescriptor[] = definitions.map((def) => {
    const missing = mock ? undefined : missingByComponent[def.id];
    const placed = Object.hasOwn(config.layout, def.id);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      enabled: placed && !missing,
      missingEnv: missing,
      hasData: Boolean(def.server),
    };
  });

  const enabled = definitions.filter((def) => descriptors.find((d) => d.id === def.id)?.enabled);

  log.info(`config loaded from ${source}`);
  log.info(
    `${enabled.length}/${definitions.length} components enabled: ${enabled.map((d) => d.id).join(', ') || '(none)'}`,
  );
  for (const [id, missing] of Object.entries(missingByComponent)) {
    log.warn(`component "${id}" disabled — missing env: ${missing.join(', ')}`);
  }

  const scheduler = new Scheduler(enabled, config, componentConfig);
  scheduler.start();

  const app = new Hono();

  // No CDN scripts anywhere: fonts and icons are bundled so the dashboard renders
  // correctly with the WAN down, and so a compromised CDN cannot reach the page.
  app.use('*', async (c, next) => {
    await next();
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "object-src 'none'",
      ].join('; '),
    );
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));
  app.get('/api/version', (c) => c.json(VERSION));

  /*
   * Panels receive the same config the handlers do: parsed through each
   * component's schema, so `.default()` values are already applied. Sending the
   * raw JSON slice instead would leave every unspecified option undefined in the
   * browser while being correctly defaulted on the server.
   */
  const clientConfig = { ...config, components: Object.fromEntries(componentConfig) };
  app.get('/api/config', (c) =>
    c.json<ClientBootstrap>({ config: clientConfig, components: descriptors, version: VERSION }),
  );

  /** Snapshot of every component's current data. Used on first paint and as the SSE fallback. */
  app.get('/api/data', (c) => c.json(scheduler.getAllStates()));

  /**
   * One long-lived stream carries every component's updates plus the build sha.
   * This replaces per-component polling: the browser opens a single connection,
   * gets the current snapshot immediately, then deltas as each handler refreshes.
   * EventSource reconnects on its own, which also makes it the signal that the
   * container was replaced by a new image.
   */
  app.get('/api/stream', (c) => {
    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const send = (event: string, data: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            open = false;
          }
        };

        send('version', VERSION);
        for (const state of scheduler.getAllStates()) send('state', state);

        const unsubscribe = scheduler.subscribe((state) => send('state', state));
        // Proxies drop idle connections; a comment frame keeps it alive without
        // being delivered to the client as an event.
        const keepAlive = setInterval(() => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          } catch {
            open = false;
          }
        }, 25_000);
        keepAlive.unref?.();

        const close = () => {
          open = false;
          clearInterval(keepAlive);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        c.req.raw.signal.addEventListener('abort', close, { once: true });
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });

  registerImageProxy(app, {
    components: enabled,
    componentConfig,
    timeZone: config.timeZone,
    signal: new AbortController().signal,
  });

  // Static client. Hashed assets are immutable; index.html must never be cached or
  // the kiosk would keep booting the previous build after an image update.
  // serveStatic resolves `root` against the working directory, so pass it relative.
  const clientRoot = path.relative(process.cwd(), CLIENT_DIR) || '.';
  app.use('/assets/*', serveStatic({ root: clientRoot }));
  app.use('/*', serveStatic({ root: clientRoot }));
  app.get('*', async (c) => {
    const html = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(CLIENT_DIR, 'index.html'), 'utf8').catch(() => null),
    );
    if (html === null) {
      return c.text('Client bundle not built. Run `npm run build:web`, or use `npm run dev`.', 503);
    }
    return c.html(html, 200, { 'Cache-Control': 'no-store' });
  });

  const port = Number(process.env.PORT ?? 8080);
  const hostname = process.env.HOST ?? '0.0.0.0';

  const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info(`dashboard listening on http://${hostname}:${info.port} (build ${VERSION.sha})`);
  });

  const shutdown = () => {
    log.info('shutting down');
    scheduler.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error('failed to start', { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
