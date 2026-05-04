import type { Pool } from 'pg';
import type { AdapterRecord, ExtractContext, LoadResult, Loader } from './types.js';

/**
 * Per-entity loaders.
 *
 * The job runner streams adapter records into one of these. They write to
 * the canonical destination tables (master-data, etc.) and return the
 * outcome so the runner can populate counters and per-row error logs.
 *
 * Mock adapters yield records whose `payload` is already shaped close to
 * the destination schema. Real adapters can either map upstream→canonical
 * inside the adapter, or do an explicit transform step here.
 */
export function makeLoaderResolver(pool: Pool): (entityType: string) => Loader {
  return (entityType: string): Loader => {
    switch (entityType) {
      case 'raw_materials':  return makeRawMaterialsLoader(pool);
      case 'suppliers':      return makeSuppliersLoader(pool);
      case 'test_results':   return makeTestResultsLoader(pool);
      case 'experiments':    return makeExperimentsLoader(pool);
      case 'documents':      return makeDocumentsLoader(pool);
      default:
        return async () => ({ outcome: 'failed', error: `No loader for entity_type='${entityType}'` });
    }
  };
}

function makeRawMaterialsLoader(pool: Pool): Loader {
  return async (rec: AdapterRecord, _ctx: ExtractContext): Promise<LoadResult> => {
    const p = rec.payload as { code: string; name: string; cas_number?: string; unit_of_measure?: string; density?: number; status?: string };
    if (!p.code || !p.name) return { outcome: 'failed', error: 'Missing code or name' };

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM raw_materials WHERE code = $1 AND deleted_at IS NULL`,
      [p.code]
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE raw_materials
            SET name = $2, cas_number = COALESCE($3, cas_number),
                unit_of_measure = COALESCE($4, unit_of_measure),
                density = COALESCE($5, density),
                status = COALESCE($6, status),
                metadata = jsonb_set(metadata, '{external_id}', to_jsonb($7::text), true)
          WHERE id = $1`,
        [existing.rows[0].id, p.name, p.cas_number ?? null, p.unit_of_measure ?? null, p.density ?? null, p.status ?? null, rec.external_id]
      );
      return { outcome: 'updated', destination_id: existing.rows[0].id };
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO raw_materials (code, name, cas_number, unit_of_measure, density, status, metadata)
       VALUES ($1, $2, $3, COALESCE($4, 'kg'), $5, COALESCE($6, 'active'), jsonb_build_object('external_id', $7::text))
       RETURNING id`,
      [p.code, p.name, p.cas_number ?? null, p.unit_of_measure ?? null, p.density ?? null, p.status ?? null, rec.external_id]
    );
    return { outcome: 'inserted', destination_id: inserted.rows[0]!.id };
  };
}

function makeSuppliersLoader(pool: Pool): Loader {
  return async (rec: AdapterRecord, _ctx: ExtractContext): Promise<LoadResult> => {
    const p = rec.payload as { code: string; name: string; country_code?: string; qualification_status?: string };
    if (!p.code || !p.name) return { outcome: 'failed', error: 'Missing code or name' };

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM suppliers WHERE code = $1 AND deleted_at IS NULL`,
      [p.code]
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE suppliers SET name = $2, country_code = COALESCE($3, country_code),
                              qualification_status = COALESCE($4, qualification_status)
          WHERE id = $1`,
        [existing.rows[0].id, p.name, p.country_code ?? null, p.qualification_status ?? null]
      );
      return { outcome: 'updated', destination_id: existing.rows[0].id };
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO suppliers (code, name, country_code, qualification_status)
       VALUES ($1, $2, $3, COALESCE($4, 'pending')) RETURNING id`,
      [p.code, p.name, p.country_code ?? null, p.qualification_status ?? null]
    );
    return { outcome: 'inserted', destination_id: inserted.rows[0]!.id };
  };
}

function makeTestResultsLoader(pool: Pool): Loader {
  return async (rec: AdapterRecord, _ctx: ExtractContext): Promise<LoadResult> => {
    const p = rec.payload as { sample_code: string; test_code: string; test_name?: string; measured_value?: number; unit_of_measure?: string; pass?: boolean };
    if (!p.test_code) return { outcome: 'failed', error: 'Missing test_code' };

    // Idempotent insert — keyed by (sample_code, test_code, external_id) via metadata
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM test_results
        WHERE metadata @> jsonb_build_object('external_id', $1::text)
          AND deleted_at IS NULL
        LIMIT 1`,
      [rec.external_id]
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE test_results SET measured_value = $2, pass = $3 WHERE id = $1`,
        [existing.rows[0].id, p.measured_value ?? null, p.pass ?? null]
      );
      return { outcome: 'updated', destination_id: existing.rows[0].id };
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO test_results
         (sample_code, test_code, test_name, measured_value, unit_of_measure, pass, metadata)
       VALUES ($1, $2, COALESCE($3, $2), $4, $5, $6, jsonb_build_object('external_id', $7::text))
       RETURNING id`,
      [
        p.sample_code ?? null, p.test_code, p.test_name ?? null,
        p.measured_value ?? null, p.unit_of_measure ?? null, p.pass ?? null,
        rec.external_id,
      ]
    );
    return { outcome: 'inserted', destination_id: inserted.rows[0]!.id };
  };
}

function makeExperimentsLoader(pool: Pool): Loader {
  return async (rec: AdapterRecord, _ctx: ExtractContext): Promise<LoadResult> => {
    const p = rec.payload as { code: string; title: string; experiment_type?: string; outcome?: string };
    if (!p.code || !p.title) return { outcome: 'failed', error: 'Missing code or title' };

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM experiments WHERE code = $1 AND deleted_at IS NULL`,
      [p.code]
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE experiments SET title = $2, experiment_type = COALESCE($3, experiment_type),
                                  outcome = COALESCE($4, outcome)
          WHERE id = $1`,
        [existing.rows[0].id, p.title, p.experiment_type ?? null, p.outcome ?? null]
      );
      return { outcome: 'updated', destination_id: existing.rows[0].id };
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO experiments (code, title, experiment_type, status, outcome, metadata)
       VALUES ($1, $2, COALESCE($3, 'trial'), 'completed', $4, jsonb_build_object('external_id', $5::text))
       RETURNING id`,
      [p.code, p.title, p.experiment_type ?? null, p.outcome ?? null, rec.external_id]
    );
    return { outcome: 'inserted', destination_id: inserted.rows[0]!.id };
  };
}

function makeDocumentsLoader(pool: Pool): Loader {
  return async (rec: AdapterRecord, _ctx: ExtractContext): Promise<LoadResult> => {
    const p = rec.payload as { path: string; mtime: string; size_bytes: number; mime_type: string; etag: string; content_preview?: string };
    if (!p.path) return { outcome: 'failed', error: 'Missing path' };

    const existing = await pool.query<{ id: string; metadata: { etag?: string } }>(
      `SELECT id, metadata FROM knowledge_documents
        WHERE source_url = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [p.path]
    );
    if (existing.rows[0]) {
      // Skip if etag unchanged
      if (existing.rows[0].metadata?.etag === p.etag) {
        return { outcome: 'unchanged', destination_id: existing.rows[0].id };
      }
      await pool.query(
        `UPDATE knowledge_documents
            SET file_size_bytes = $2, file_mime_type = $3,
                summary = COALESCE($4, summary),
                metadata = metadata || jsonb_build_object('etag', $5::text, 'mtime', $6::text)
          WHERE id = $1`,
        [existing.rows[0].id, p.size_bytes, p.mime_type, p.content_preview ?? null, p.etag, p.mtime]
      );
      return { outcome: 'updated', destination_id: existing.rows[0].id };
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO knowledge_documents (title, doc_type, status, summary, source_url, file_url,
                                          file_size_bytes, file_mime_type, metadata)
       VALUES ($1, 'report', 'published', $2, $3, $3, $4, $5,
               jsonb_build_object('etag', $6::text, 'mtime', $7::text, 'external_id', $8::text))
       RETURNING id`,
      [
        p.path.split('/').pop() ?? p.path, p.content_preview ?? null,
        p.path, p.size_bytes, p.mime_type, p.etag, p.mtime, rec.external_id,
      ]
    );
    return { outcome: 'inserted', destination_id: inserted.rows[0]!.id };
  };
}
