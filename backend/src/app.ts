/** The Express application — CORS, JSON, Swagger, the API, error handling. */
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { config } from '@/config';
import { api } from '@/routers';
import { errorHandler } from '@/http/handler';
import { openapiSpec } from '@/swagger';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  // Liveness probe (used by hosts like Render + the frontend smoke test).
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'localo-backend' }));

  // Interactive docs.
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
  app.get('/openapi.json', (_req, res) => res.json(openapiSpec));

  // All resources live under /api (matches the OpenAPI server url).
  app.use('/api', api);

  app.use(errorHandler);
  return app;
}
