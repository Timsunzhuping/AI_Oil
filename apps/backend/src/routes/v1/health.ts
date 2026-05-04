import { Router } from 'express';
import { livenessHandler, readinessHandler } from '../../controllers/healthController.js';

export const healthRouter: Router = Router();

healthRouter.get('/', readinessHandler);
healthRouter.get('/live', livenessHandler);
healthRouter.get('/ready', readinessHandler);
