import { Router } from 'express';
import type { Pool } from 'pg';

import { buildMaterialsRouter } from './materials/routes.js';
import { MaterialsService } from './materials/service.js';
import { MaterialsRepository } from './materials/repository.js';

import { buildSuppliersRouter } from './suppliers/index.js';
import { buildProductsRouter } from './products/index.js';
import { buildMetricsRouter } from './metrics/index.js';
import { buildUnitsRouter } from './units/index.js';
import { buildAliasesRouter } from './aliases/index.js';
import { buildImportRouter } from './import/index.js';

/**
 * Master Data Management module — composes every resource sub-router under
 * /api/v1/master-data.
 */
export function buildMasterDataRouter(pool: Pool): Router {
  const router = Router();

  const materialsService = new MaterialsService(new MaterialsRepository(pool));

  router.use('/materials', buildMaterialsRouter(materialsService));
  router.use('/suppliers', buildSuppliersRouter(pool));
  router.use('/products',  buildProductsRouter(pool));
  router.use('/metrics',   buildMetricsRouter(pool));
  router.use('/units',     buildUnitsRouter(pool));
  router.use('/aliases',   buildAliasesRouter(pool));
  router.use('/import',    buildImportRouter(pool));

  router.get('/', (_req, res) => {
    res.json({
      code: 0,
      message: 'success',
      data: {
        module: 'master-data',
        endpoints: {
          materials:  '/master-data/materials',
          suppliers:  '/master-data/suppliers',
          products:   '/master-data/products',
          metrics:    '/master-data/metrics',
          units:      '/master-data/units',
          aliases:    '/master-data/aliases',
          import:     '/master-data/import',
        },
      },
      traceId: 'no-trace',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
