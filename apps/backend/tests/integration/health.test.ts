import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { resetEnvCache } from '../../src/config/env.js';

describe('health endpoints (integration)', () => {
  let app: Express;

  beforeAll(() => {
    resetEnvCache();
    ({ app } = createApp());
  });

  describe('GET /health (liveness)', () => {
    it('returns 200 with unified envelope', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.message).toBe('success');
      expect(res.body.data.status).toBe('healthy');
      expect(res.body.data.service).toBeDefined();
      expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
      expect(res.body.traceId).toMatch(/.+/);
      expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('echoes client-supplied x-trace-id', async () => {
      const res = await request(app).get('/health').set('x-trace-id', 'client-trace-xyz');
      expect(res.body.traceId).toBe('client-trace-xyz');
      expect(res.headers['x-trace-id']).toBe('client-trace-xyz');
    });

    it('mints a fresh trace_id when none supplied', async () => {
      const res = await request(app).get('/health');
      expect(res.body.traceId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(res.headers['x-trace-id']).toBe(res.body.traceId);
    });

    it('isolates trace_ids across concurrent requests', async () => {
      const responses = await Promise.all([
        request(app).get('/health').set('x-trace-id', 't-1'),
        request(app).get('/health').set('x-trace-id', 't-2'),
        request(app).get('/health').set('x-trace-id', 't-3'),
      ]);
      expect(responses.map((r) => r.body.traceId)).toEqual(['t-1', 't-2', 't-3']);
    });
  });

  describe('GET /api/v1/health (readiness)', () => {
    it('returns 200 with dependency check details', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.checks).toBeDefined();
      expect(res.body.data.checks.process.status).toBe('pass');
    });
  });

  describe('unified error envelope', () => {
    it('404 unknown route returns the unified shape with trace_id', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(40400);
      expect(res.body.message).toContain('not found');
      expect(res.body.traceId).toBeDefined();
    });
  });

  describe('OpenAPI spec', () => {
    it('serves the spec when ENABLE_SWAGGER=true', async () => {
      process.env.ENABLE_SWAGGER = 'true';
      resetEnvCache();
      const { app: app2 } = createApp();
      const res = await request(app2).get('/api/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.info.title).toContain('FluidMind');
    });
  });
});
