/**
 * SAP business adapter contract.
 *
 * Three entity types: BOM lines, costs, inventory. Each supports both full
 * and incremental modes; the adapter advances the cursor and returns the
 * next watermark so the service can persist it on `erp_jobs.cursor_to`.
 *
 * Real adapters typically implement on top of node-rfc / @sap/cap-fiori /
 * an OData client; the mock returns deterministic samples.
 */
import type {
  AdapterIdentity,
  ErpJobMode,
  SapBomLine,
  SapCostRecord,
  SapInventoryRecord,
} from '../../types.js';

export interface SapSyncContext {
  mode: ErpJobMode;
  cursor: Record<string, unknown> | null;
  limit?: number;
  trace_id: string;
}

export interface SapSyncResult<T> {
  records: T[];
  next_cursor: Record<string, unknown> | null;
}

export interface SapAdapter {
  identity(): AdapterIdentity;
  testConnection(): Promise<{ ok: boolean; latency_ms: number; details?: Record<string, unknown> }>;
  syncBom(ctx: SapSyncContext): Promise<SapSyncResult<SapBomLine>>;
  syncCost(ctx: SapSyncContext): Promise<SapSyncResult<SapCostRecord>>;
  syncInventory(ctx: SapSyncContext): Promise<SapSyncResult<SapInventoryRecord>>;
}
