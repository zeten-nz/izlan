import { FastifyAdapter } from '@nestjs/platform-fastify';

/** Ordinary API JSON body ceiling — the Fastify default (§34). Every route EXCEPT bulk import uses this. */
export const DEFAULT_BODY_LIMIT = 1 * 1024 * 1024; // 1 MiB
/** Bulk-import routes only (TD-253). Raised at the Fastify body-parser boundary — NOT the global API ceiling. */
export const IMPORT_BODY_LIMIT = 5 * 1024 * 1024; // 5 MiB
/** The two topic-scoped import routes in Fastify route-url form (`[^/]+` matches the `:topicId` param placeholder). */
const IMPORT_ROUTE_RE = /\/staff\/content\/topics\/[^/]+\/import\/(?:validate|apply)$/;

/**
 * ONE shared Fastify adapter factory so production (`main.ts`) and e2e cannot drift in body-limit wiring (TD-253).
 * The GLOBAL body limit stays at the ordinary 1 MiB; an `onRoute` hook raises ONLY the two import routes to 5 MiB.
 * `bodyLimit` is a native Fastify route option, so Fastify enforces it WHILE reading the request body — an oversized
 * body is rejected with 413 before it is fully buffered or JSON-parsed (no post-parse size check, no Content-Length
 * trust). The hook is registered on the adapter's Fastify instance BEFORE Nest registers any route, so every route the
 * framework adds passes through it.
 */
export function createFastifyAdapter(opts: { trustProxy?: boolean } = {}): FastifyAdapter {
  const adapter = new FastifyAdapter({ trustProxy: opts.trustProxy ?? false, bodyLimit: DEFAULT_BODY_LIMIT });
  adapter.getInstance().addHook('onRoute', (routeOptions) => {
    if (IMPORT_ROUTE_RE.test(routeOptions.url)) routeOptions.bodyLimit = IMPORT_BODY_LIMIT;
  });
  return adapter;
}
