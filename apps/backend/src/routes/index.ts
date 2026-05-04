import { Express } from 'express';
import { healthController } from '../controllers/healthController';

export function configureRoutes(app: Express) {
  app.get('/health', healthController);

  app.get('/', (req, res) => {
    res.json({
      message: 'FluidMind Backend API',
      version: '0.0.1',
      status: 'running',
    });
  });
}
