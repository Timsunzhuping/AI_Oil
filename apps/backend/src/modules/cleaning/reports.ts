import type { Pool } from 'pg';
import type { IssueSeverity, QualityReport } from './types.js';

/**
 * Compute a quality report for a single cleaning run by aggregating
 * data_quality_issues + normalized_test_results in a few batched queries.
 */
export async function generateQualityReport(pool: Pool, runId: string): Promise<QualityReport | null> {
  const run = await pool.query<{
    id: string;
    records_processed: string;
    records_normalized: string;
    issues_found: string;
  }>(
    `SELECT id, records_processed::text, records_normalized::text, issues_found::text
       FROM cleaning_runs WHERE id = $1`,
    [runId]
  );
  if (!run.rows[0]) return null;

  const totals = run.rows[0];

  // by_severity
  const sevRes = await pool.query<{ severity: IssueSeverity; c: string }>(
    `SELECT severity, COUNT(*)::text c
       FROM data_quality_issues WHERE cleaning_run_id = $1
       GROUP BY severity`,
    [runId]
  );
  const by_severity: Record<IssueSeverity, number> = { info: 0, warning: 0, error: 0, critical: 0 };
  for (const r of sevRes.rows) by_severity[r.severity] = parseInt(r.c, 10);

  // by_type
  const typeRes = await pool.query<{ issue_type: string; c: string }>(
    `SELECT issue_type, COUNT(*)::text c
       FROM data_quality_issues WHERE cleaning_run_id = $1
       GROUP BY issue_type
       ORDER BY 2 DESC`,
    [runId]
  );
  const by_type: Record<string, number> = {};
  for (const r of typeRes.rows) by_type[r.issue_type] = parseInt(r.c, 10);

  // outliers
  const outliersAgg = await pool.query<{ method: string; c: string }>(
    `SELECT unnest(outlier_methods) AS method, COUNT(*)::text c
       FROM normalized_test_results
      WHERE cleaning_run_id = $1 AND is_outlier = TRUE
      GROUP BY method`,
    [runId]
  );
  const by_method: Record<string, number> = {};
  for (const r of outliersAgg.rows) by_method[r.method] = parseInt(r.c, 10);

  const outliersByMetric = await pool.query<{ metric_code: string; c: string }>(
    `SELECT metric_code, COUNT(*)::text c
       FROM normalized_test_results
      WHERE cleaning_run_id = $1 AND is_outlier = TRUE
      GROUP BY metric_code
      ORDER BY 2 DESC LIMIT 5`,
    [runId]
  );
  const top_outlier_metrics = outliersByMetric.rows.map((r) => ({ metric_code: r.metric_code, count: parseInt(r.c, 10) }));

  const outliersTotal = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM normalized_test_results
      WHERE cleaning_run_id = $1 AND is_outlier = TRUE`,
    [runId]
  );

  // unresolved
  const unresolvedTotal = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM normalized_test_results
      WHERE cleaning_run_id = $1 AND is_unresolved = TRUE`,
    [runId]
  );

  const unresolvedSamples = await pool.query<{ source_test_result_id: string; raw_value: unknown }>(
    `SELECT source_test_result_id, raw_value
       FROM normalized_test_results
      WHERE cleaning_run_id = $1 AND is_unresolved = TRUE
      ORDER BY measured_at DESC NULLS LAST
      LIMIT 10`,
    [runId]
  );

  const unresolvedByField = await pool.query<{ field: string; c: string }>(
    `SELECT COALESCE(field, '_unknown') AS field, COUNT(*)::text c
       FROM data_quality_issues
      WHERE cleaning_run_id = $1
        AND issue_type IN ('unresolved_metric','unresolved_material','unresolved_unit')
      GROUP BY field`,
    [runId]
  );
  const unresolved_by_field: Record<string, number> = {};
  for (const r of unresolvedByField.rows) unresolved_by_field[r.field] = parseInt(r.c, 10);

  // missing
  const missingTotal = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM normalized_test_results
      WHERE cleaning_run_id = $1 AND is_missing = TRUE`,
    [runId]
  );

  const missingByField = await pool.query<{ field: string; c: string }>(
    `SELECT COALESCE(field, '_unknown') AS field, COUNT(*)::text c
       FROM data_quality_issues
      WHERE cleaning_run_id = $1
        AND issue_type IN ('missing_value','missing_required_field')
      GROUP BY field`,
    [runId]
  );
  const missing_by_field: Record<string, number> = {};
  for (const r of missingByField.rows) missing_by_field[r.field] = parseInt(r.c, 10);

  // spec violations
  const specCount = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM data_quality_issues
      WHERE cleaning_run_id = $1 AND issue_type = 'spec_violation'`,
    [runId]
  );

  const specTopMetrics = await pool.query<{ metric_code: string; c: string }>(
    `SELECT n.metric_code, COUNT(*)::text c
       FROM data_quality_issues d
       JOIN normalized_test_results n ON n.id = d.entity_id
      WHERE d.cleaning_run_id = $1 AND d.issue_type = 'spec_violation'
      GROUP BY n.metric_code ORDER BY 2 DESC LIMIT 5`,
    [runId]
  );

  // recent issues
  const recent = await pool.query<{
    id: string; issue_type: string; severity: string; field: string | null; message: string; created_at: Date;
  }>(
    `SELECT id, issue_type, severity, field, message, created_at
       FROM data_quality_issues
      WHERE cleaning_run_id = $1
      ORDER BY created_at DESC LIMIT 20`,
    [runId]
  );

  // records_with_issues
  const withIssues = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM normalized_test_results
      WHERE cleaning_run_id = $1 AND has_quality_issues = TRUE`,
    [runId]
  );

  return {
    run_id: runId,
    generated_at: new Date().toISOString(),
    totals: {
      records_processed: parseInt(totals.records_processed, 10),
      records_normalized: parseInt(totals.records_normalized, 10),
      records_with_issues: parseInt(withIssues.rows[0]?.c ?? '0', 10),
      issues_total: parseInt(totals.issues_found, 10),
    },
    by_severity,
    by_type,
    outliers: {
      count: parseInt(outliersTotal.rows[0]?.c ?? '0', 10),
      by_method,
      top_metrics: top_outlier_metrics,
    },
    unresolved: {
      count: parseInt(unresolvedTotal.rows[0]?.c ?? '0', 10),
      by_field: unresolved_by_field,
      samples: unresolvedSamples.rows.map((r) => ({
        source_test_result_id: r.source_test_result_id,
        raw_value: r.raw_value,
      })),
    },
    missing: {
      count: parseInt(missingTotal.rows[0]?.c ?? '0', 10),
      by_field: missing_by_field,
    },
    spec_violations: {
      count: parseInt(specCount.rows[0]?.c ?? '0', 10),
      top_metrics: specTopMetrics.rows.map((r) => ({ metric_code: r.metric_code, count: parseInt(r.c, 10) })),
    },
    recent_issues: recent.rows.map((r) => ({
      id: r.id,
      issue_type: r.issue_type,
      severity: r.severity,
      field: r.field,
      message: r.message,
      created_at: r.created_at.toISOString(),
    })),
  };
}
