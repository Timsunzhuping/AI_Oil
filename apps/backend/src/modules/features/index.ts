import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildFeaturesRouter } from './routes.js';
import { FeatureApi } from './feature-api.js';

export function buildFeaturesModule(pool: Pool, logger: Logger) {
  return {
    router: buildFeaturesRouter(pool, logger),
    api: new FeatureApi(pool, logger),
  };
}

export { FeatureApi } from './feature-api.js';
export { FeatureGenerator } from './pipeline/generator.js';
export { buildFeatureSet, defaultExtractors } from './pipeline/builder.js';
export { FeaturesRepository } from './repository.js';
export type * from './types.js';
