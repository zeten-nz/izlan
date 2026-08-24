import { Controller, Get, Module, Patch, Post, Put } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { corsOptions } from './cors';

@Controller('t')
class CorsProbeController {
  @Get('profile') getProfile() {
    return {};
  }
  @Patch('profile') patchProfile() {
    return {};
  }
  @Put('intent') putIntent() {
    return {};
  }
  @Post('login') login() {
    return {};
  }
}

@Module({ controllers: [CorsProbeController] })
class CorsProbeModule {}

/**
 * Regression for the real Firefox failure "Did not find method in Access-Control-Allow-Methods": the Nest-Fastify
 * default only advertised GET,HEAD,POST, so PATCH/PUT preflights were blocked. Boots a real Nest+Fastify app with the
 * SAME `corsOptions` used by main.ts and asserts the requested method is present in the preflight response.
 */
describe('Credentialed CORS preflight — advertised methods (SEC-CORS)', () => {
  let app: NestFastifyApplication;
  const ORIGIN = 'http://localhost:4000';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CorsProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.enableCors(corsOptions([ORIGIN]));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  function preflight(url: string, method: string, requestHeaders = 'authorization,content-type') {
    return app.getHttpAdapter().getInstance().inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin: ORIGIN,
        'access-control-request-method': method,
        'access-control-request-headers': requestHeaders,
      },
    });
  }

  it.each([
    ['/api/t/profile', 'GET'],
    ['/api/t/profile', 'PATCH'],
    ['/api/t/intent', 'PUT'],
    ['/api/t/login', 'POST'],
  ])('SEC-CORS OPTIONS %s (%s) advertises the requested method with exact-origin + credentials', async (url, method) => {
    const res = await preflight(url, method);
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['access-control-allow-methods'] ?? '')).toContain(method);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('SEC-CORS advertises PATCH, PUT and DELETE (the methods the Nest-Fastify default dropped)', async () => {
    const allow = String((await preflight('/api/t/profile', 'PATCH')).headers['access-control-allow-methods'] ?? '');
    for (const m of ['PATCH', 'PUT', 'DELETE']) expect(allow).toContain(m);
  });

  it('SEC-CORS allows the app request headers (Authorization, Content-Type, X-Izlan-CSRF)', async () => {
    const res = await preflight('/api/t/login', 'POST', 'authorization,content-type,x-izlan-csrf');
    const allowHeaders = String(res.headers['access-control-allow-headers'] ?? '').toLowerCase();
    for (const h of ['authorization', 'content-type', 'x-izlan-csrf']) expect(allowHeaders).toContain(h);
  });
});
