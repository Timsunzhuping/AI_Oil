/**
 * Programmatic database seeding for FluidMind platform.
 *
 * Usage:
 *   node seed.ts                          # Use DATABASE_URL env var
 *   node seed.ts --dry-run                # Show SQL without executing
 *   node seed.ts --reset                  # DROP + recreate public schema
 *
 * Environment:
 *   DATABASE_URL — PostgreSQL connection string
 *   SEED_DIR     — Path to seed SQL files (default: ./seeds)
 */

import { Pool } from 'pg';
import { readFile } from 'fs/promises';
import { join } from 'path';

const SEED_DIR = process.env.SEED_DIR || join(__dirname, 'seeds');
const DB_URL = process.env.DATABASE_URL;

const SEED_FILES = [
  '01_users_and_roles.sql',
  '02_materials_and_products.sql',
  '03_formulas.sql',
  '04_experiments_and_tests.sql',
  '05_rd_tasks.sql',
  '06_knowledge_and_rules.sql',
  '07_ml_registry.sql',
  '08_master_data.sql',
  '09_integration.sql',
  '10_cleaning.sql',
  '11_features.sql',
  '12_task_templates.sql',
  '13_evaluation_and_acceptance.sql',
  '14_prediction_and_recommendation.sql',
  '15_tasks_knowledge_qa.sql',
];

interface SeedOptions {
  dryRun: boolean;
  reset: boolean;
  verbose: boolean;
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(msg: string, color: keyof typeof colors = 'reset'): void {
  // eslint-disable-next-line no-console
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logInfo(msg: string): void {
  log(`[INFO] ${msg}`, 'green');
}
function logWarn(msg: string): void {
  log(`[WARN] ${msg}`, 'yellow');
}
function logError(msg: string): void {
  log(`[ERROR] ${msg}`, 'red');
}

async function readSeedFile(filename: string): Promise<string> {
  const path = join(SEED_DIR, filename);
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read seed file ${filename}: ${err}`);
  }
}

async function resetDatabase(pool: Pool): Promise<void> {
  logWarn('Resetting database: DROP public schema');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  logInfo('✓ Schema reset complete');
}

async function executeSeedFile(pool: Pool, filename: string, options: SeedOptions): Promise<void> {
  logInfo(`Processing: ${filename}`);

  const sql = await readSeedFile(filename);
  const lines = sql.split('\n').length;

  if (options.dryRun) {
    logInfo(`  [DRY RUN] Would execute ${lines} lines`);
    const preview = sql.split('\n').slice(0, 5).join('\n');
    // eslint-disable-next-line no-console
    console.log(`    ${preview.split('\n').join('\n    ')}`);
    // eslint-disable-next-line no-console
    console.log('    ...');
    return;
  }

  try {
    await pool.query(sql);
    logInfo(`  ✓ Completed (${lines} lines)`);
  } catch (err) {
    const error = err as Error;
    logError(`  Failed: ${error.message}`);
    throw err;
  }
}

async function countRecords(pool: Pool): Promise<Record<string, number>> {
  const tables = [
    'users',
    'raw_materials',
    'formulas',
    'acceptance_test_sets',
    'tasks',
    'knowledge_documents',
    'ml_model_registry',
    'recommendation_requests',
  ];

  const counts: Record<string, number> = {};
  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      counts[table] = parseInt(result.rows[0].count, 10);
    } catch {
      counts[table] = -1; // Table doesn't exist
    }
  }
  return counts;
}

async function seed(options: SeedOptions): Promise<void> {
  if (!DB_URL) {
    logError('DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DB_URL });

  try {
    // Test connection
    logInfo('Verifying database connection...');
    await pool.query('SELECT version()');
    logInfo('✓ Database connection OK');

    // Reset if requested
    if (options.reset) {
      await resetDatabase(pool);
    }

    // Execute seed files
    logInfo('Executing seed scripts...');
    for (const file of SEED_FILES) {
      await executeSeedFile(pool, file, options);
    }

    // Show statistics
    if (!options.dryRun) {
      logInfo('Counting seeded records...');
      const counts = await countRecords(pool);
      // eslint-disable-next-line no-console
      console.log('');
      logInfo('Database Statistics:');
      for (const [table, count] of Object.entries(counts)) {
        const status = count === -1 ? '(table missing)' : count;
        // eslint-disable-next-line no-console
        console.log(`  ${table.padEnd(30)} ${status}`);
      }
      // eslint-disable-next-line no-console
      console.log('');
    }

    logInfo('✓ Seed script execution completed');
  } catch (err) {
    const error = err as Error;
    logError(`Seeding failed: ${error.message}`);
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Parse CLI arguments
function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    reset: args.includes('--reset'),
    verbose: args.includes('--verbose'),
  };
}

// Main
const options = parseArgs();
seed(options).catch((err) => {
  console.error(err);
  process.exit(1);
});
