import type { Hono } from 'hono';
import type { ComponentDefinition, HandlerContext } from '../../shared/component.js';
import { scopedEnv } from '../lib/env.js';
import { fetchWithTimeout } from '../lib/fetch.js';
import { logger } from '../lib/log.js';

const log = logger('image-proxy');

/** Only these ever reach the browser; anything else upstream returns is dropped. */
const ALLOWED_CONTENT_TYPES = /^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/;
const MAX_BYTES = 12 * 1024 * 1024;

export interface ImageProxyDeps {
  components: ComponentDefinition<unknown, unknown>[];
  componentConfig: Map<string, unknown>;
  timeZone: string;
  signal: AbortSignal;
}

/**
 * `GET /img/:componentId/:ref` — streams an upstream image using the owning
 * component's credentials, so a token never appears in page source or in a
 * browser's network log.
 */
export function registerImageProxy(app: Hono, deps?: ImageProxyDeps): void {
  app.get('/img/:componentId/:ref{.+}', async (c) => {
    if (!deps) return c.text('Image proxy not configured', 503);

    const componentId = c.req.param('componentId');
    const ref = c.req.param('ref');

    const def = deps.components.find((d) => d.id === componentId);
    if (!def?.server?.images) return c.text('Not found', 404);

    const { env, requireEnv } = scopedEnv(def);
    const ctx: HandlerContext<unknown> = {
      config: deps.componentConfig.get(componentId),
      env,
      requireEnv,
      fetch: (input, init) => fetchWithTimeout(input, init),
      timeZone: deps.timeZone,
      log: (m, e) => log.debug(`${componentId}: ${m}`, e),
      signal: deps.signal,
      // The image resolver only needs credentials, never another component's data.
      readComponent: () => undefined,
    };

    try {
      const { url, headers } = await def.server.images(ctx, ref);
      const upstream = await fetchWithTimeout(url, { headers, signal: c.req.raw.signal });
      if (!upstream.ok || !upstream.body) return c.text('Upstream image unavailable', 502);

      const contentType = upstream.headers.get('content-type') ?? '';
      if (!ALLOWED_CONTENT_TYPES.test(contentType.split(';')[0]!.trim())) {
        return c.text('Unsupported image type', 415);
      }
      const length = Number(upstream.headers.get('content-length') ?? 0);
      if (length > MAX_BYTES) return c.text('Image too large', 413);

      return new Response(upstream.body, {
        headers: {
          'Content-Type': contentType,
          // Recipe art changes rarely and the kiosk re-renders constantly.
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch (err) {
      log.warn(`failed for ${componentId}/${ref}`, { error: err instanceof Error ? err.message : String(err) });
      return c.text('Image proxy error', 502);
    }
  });
}
