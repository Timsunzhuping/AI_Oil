import type { Pool } from 'pg';
import type { CleaningContext, Stage, WorkingRow } from '../../types.js';

/**
 * Link the test result to upstream entities the source row already
 * references. When formula_version_id is present we backfill formula_id.
 *
 * If the source has only a `batch_code` or `sample_code` we leave the
 * structural FKs null but persist the codes so analytics can group.
 */
export class LinkStage implements Stage {
  readonly name = 'link';
  constructor(private pool: Pool) {}

  async process(row: WorkingRow, _ctx: CleaningContext): Promise<void> {
    const { raw } = row;
    row.formula_version_id = raw.formula_version_id;
    row.product_id = raw.product_id;
    row.raw_material_id = raw.raw_material_id;
    row.experiment_id = raw.experiment_id;
    row.sample_code = raw.sample_code;
    row.batch_code = raw.batch_code;

    // Backfill formula_id from formula_versions
    if (raw.formula_version_id) {
      const r = await this.pool.query<{ formula_id: string }>(
        `SELECT formula_id FROM formula_versions WHERE id = $1`,
        [raw.formula_version_id]
      );
      row.formula_id = r.rows[0]?.formula_id ?? null;
    }

    // If product_id is null but formula_version → product is set, backfill
    if (!row.product_id && raw.formula_version_id) {
      const r = await this.pool.query<{ product_id: string | null }>(
        `SELECT p.id AS product_id
           FROM formula_versions fv
           JOIN formulas f ON f.id = fv.formula_id
           LEFT JOIN products p ON p.current_formula_version_id = fv.id
          WHERE fv.id = $1
          LIMIT 1`,
        [raw.formula_version_id]
      );
      if (r.rows[0]?.product_id) row.product_id = r.rows[0].product_id;
    }

    // Best-effort: if no formula_version but we have a batch_code, look for
    // a recent experiment with this batch and pick its formula_version.
    if (!row.formula_version_id && raw.batch_code) {
      const r = await this.pool.query<{ formula_version_id: string | null }>(
        `SELECT formula_version_id
           FROM experiments
          WHERE metadata @> jsonb_build_object('batch_code', $1::text)
             OR code ILIKE $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [raw.batch_code, `%${raw.batch_code}%`]
      );
      if (r.rows[0]?.formula_version_id) {
        row.formula_version_id = r.rows[0].formula_version_id;
        const f = await this.pool.query<{ formula_id: string }>(
          `SELECT formula_id FROM formula_versions WHERE id = $1`,
          [row.formula_version_id]
        );
        row.formula_id = f.rows[0]?.formula_id ?? null;
      } else {
        // Note the linkage gap, but this is informational — many test_results
        // legitimately have no formula context.
        row.issues.push({
          type: 'linkage_failed',
          severity: 'info',
          field: 'formula_version_id',
          message: `Could not link batch_code='${raw.batch_code}' to any formula version`,
        });
      }
    }
  }
}
