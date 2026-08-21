import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Foundation e2e — health/readiness. DB: mavjud izlan_dev (read-only SELECT 1; hech qanday mutation, §37).
 * Config .env'dan DATABASE_URL oladi (@nestjs/config .env yuklaydi).
 */
describe('Foundation (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health → 200 { status: ok } (liveness)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/ready → 200 { status: ready, database: up } (readiness, DB reachable)', async () => {
    const res = await request(app.getHttpServer()).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', database: 'up' });
    // Internal detallar oshkor etilmaydi (§18)
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|5432|password|127\.0\.0\.1/i);
  });
});
