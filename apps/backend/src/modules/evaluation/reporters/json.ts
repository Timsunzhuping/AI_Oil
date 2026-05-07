/**
 * JSON reporter — the canonical output format. The acceptance run already
 * persists a structured report on `acceptance_runs.summary`; this reporter
 * just round-trips it as a downloadable file.
 */
import type { AcceptanceReport, ExportResponse, RunRow } from '../types.js';

export function renderJson(run: RunRow): ExportResponse {
  const body = JSON.stringify(run.summary, null, 2);
  return {
    filename: `${run.code}.report.json`,
    content_type: 'application/json',
    body,
  };
}

export function reportFromRun(run: RunRow): AcceptanceReport {
  return run.summary;
}
