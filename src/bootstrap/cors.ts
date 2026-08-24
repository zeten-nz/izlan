/**
 * Credentialed CORS options (§34), ONE source of truth for `main.ts` and its regression test.
 *
 * `methods` and `allowedHeaders` are set EXPLICITLY on purpose: the Nest-Fastify `enableCors` default advertises only
 * the CORS "simple methods" (GET,HEAD,POST) in `Access-Control-Allow-Methods`, so real browser preflights for the
 * PATCH / PUT / DELETE the app uses (profile edit, learning-intent save, CMS deletes) were blocked. We allow exactly
 * the methods and headers the application uses — nothing more. Origin stays an exact allowlist and credentials stay
 * true (never `Access-Control-Allow-Origin: *` with credentials).
 *
 * The return type is left inferred: the literal is structurally accepted by both the generic Nest `CorsOptions` and
 * the Fastify adapter's `FastifyCorsOptions` (whose `origin` union is narrower), so this composes with `enableCors`
 * on a `NestFastifyApplication` without a framework-specific import.
 */
export function corsOptions(corsOrigins: string[]) {
  return {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Izlan-CSRF'],
  };
}
