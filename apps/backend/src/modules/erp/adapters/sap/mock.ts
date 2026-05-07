/**
 * Deterministic mock SAP adapter.
 *
 * Returns stable sample BOM / cost / inventory rows, keyed by a base
 * `Date('2026-04-01T00:00:00Z')` so cursor-based incremental tests are
 * fully reproducible. The same `since` cursor + same code → same output.
 *
 * Real adapter wiring lives in `real.ts` / a sibling implementation that
 * speaks to SAP via RFC, OData, or a 中间件 like SAP Integration Suite.
 */
import type {
  AdapterIdentity,
  SapBomLine,
  SapCostRecord,
  SapInventoryRecord,
} from '../../types.js';
import type { SapAdapter, SapSyncContext, SapSyncResult } from './types.js';

export interface MockSapAdapterOptions {
  name?: string;
  version?: string;
  /** Inject a clock to keep tests deterministic across reruns. */
  baseDate?: Date;
  /** Force `testConnection().ok = false` for failure-path testing. */
  failConnection?: boolean;
  /** Force `syncBom/syncCost/syncInventory` to throw — exercise retry. */
  failureCounter?: { remaining: number };
}

export class MockSapAdapter implements SapAdapter {
  readonly opts: Required<Omit<MockSapAdapterOptions, 'failureCounter'>> & {
    failureCounter?: { remaining: number };
  };

  constructor(opts: MockSapAdapterOptions = {}) {
    this.opts = {
      name: opts.name ?? 'mock-sap',
      version: opts.version ?? 'v1',
      baseDate: opts.baseDate ?? new Date('2026-04-01T00:00:00Z'),
      failConnection: opts.failConnection ?? false,
      ...(opts.failureCounter ? { failureCounter: opts.failureCounter } : {}),
    };
  }

  identity(): AdapterIdentity {
    return { name: this.opts.name, version: this.opts.version, mode: 'mock' };
  }

  async testConnection() {
    if (this.opts.failConnection) {
      return { ok: false, latency_ms: 5, details: { reason: 'mock-fail' } };
    }
    return { ok: true, latency_ms: 12, details: { endpoint: 'mock://sap' } };
  }

  async syncBom(ctx: SapSyncContext): Promise<SapSyncResult<SapBomLine>> {
    this.maybeFail();
    const all = this.sampleBom();
    return this.applyCursor(all, ctx);
  }

  async syncCost(ctx: SapSyncContext): Promise<SapSyncResult<SapCostRecord>> {
    this.maybeFail();
    const all = this.sampleCosts();
    return this.applyCursor(all, ctx);
  }

  async syncInventory(ctx: SapSyncContext): Promise<SapSyncResult<SapInventoryRecord>> {
    this.maybeFail();
    const all = this.sampleInventory();
    return this.applyCursor(all, ctx);
  }

  // ── helpers ───────────────────────────────────────────────────────

  private maybeFail(): void {
    if (this.opts.failureCounter && this.opts.failureCounter.remaining > 0) {
      this.opts.failureCounter.remaining -= 1;
      throw new Error('mock SAP transient failure');
    }
  }

  /** Filter sample by cursor.since when mode='incremental'. */
  private applyCursor<T extends { external_updated_at?: string }>(
    rows: T[],
    ctx: SapSyncContext
  ): SapSyncResult<T> {
    const since =
      ctx.mode === 'incremental' && ctx.cursor && typeof ctx.cursor.since === 'string'
        ? new Date(ctx.cursor.since as string)
        : null;
    const filtered = since
      ? rows.filter((r) => r.external_updated_at && new Date(r.external_updated_at) > since)
      : rows;
    const limited = ctx.limit ? filtered.slice(0, ctx.limit) : filtered;
    const last = limited[limited.length - 1];
    const next_cursor = last?.external_updated_at
      ? { since: last.external_updated_at }
      : (ctx.cursor ?? null);
    return { records: limited, next_cursor };
  }

  private day(n: number): string {
    return new Date(this.opts.baseDate.getTime() + n * 24 * 3600_000).toISOString();
  }

  private sampleBom(): SapBomLine[] {
    return [
      {
        external_id: 'SAP-BOM-1',
        parent_material_code: 'PROD-5W30',
        child_material_code: 'RM-PAO-6',
        ratio: 0.42,
        uom: 'kg',
        effective_from: this.day(0),
        effective_to: null,
        external_updated_at: this.day(1),
      },
      {
        external_id: 'SAP-BOM-2',
        parent_material_code: 'PROD-5W30',
        child_material_code: 'RM-GIII-4',
        ratio: 0.38,
        uom: 'kg',
        effective_from: this.day(0),
        effective_to: null,
        external_updated_at: this.day(2),
      },
      {
        external_id: 'SAP-BOM-3',
        parent_material_code: 'PROD-5W30',
        child_material_code: 'RM-OCP',
        ratio: 0.085,
        uom: 'kg',
        effective_from: this.day(0),
        effective_to: null,
        external_updated_at: this.day(3),
      },
      {
        external_id: 'SAP-BOM-4',
        parent_material_code: 'PROD-5W30',
        child_material_code: 'RM-PKG-A',
        ratio: 0.115,
        uom: 'kg',
        effective_from: this.day(0),
        effective_to: null,
        external_updated_at: this.day(4),
      },
      {
        external_id: 'SAP-BOM-5',
        parent_material_code: 'PROD-15W40',
        child_material_code: 'RM-MO-220',
        ratio: 0.85,
        uom: 'kg',
        effective_from: this.day(0),
        effective_to: null,
        external_updated_at: this.day(7),
      },
    ];
  }

  private sampleCosts(): SapCostRecord[] {
    return [
      {
        external_id: 'SAP-COST-1',
        material_code: 'RM-PAO-6',
        unit_cost: 22.0,
        currency: 'CNY',
        uom: 'kg',
        effective_date: this.day(0),
        external_updated_at: this.day(1),
      },
      {
        external_id: 'SAP-COST-2',
        material_code: 'RM-GIII-4',
        unit_cost: 14.0,
        currency: 'CNY',
        uom: 'kg',
        effective_date: this.day(0),
        external_updated_at: this.day(2),
      },
      {
        external_id: 'SAP-COST-3',
        material_code: 'RM-OCP',
        unit_cost: 9.0,
        currency: 'CNY',
        uom: 'kg',
        effective_date: this.day(0),
        external_updated_at: this.day(3),
      },
      {
        external_id: 'SAP-COST-4',
        material_code: 'RM-PKG-A',
        unit_cost: 30.0,
        currency: 'CNY',
        uom: 'kg',
        effective_date: this.day(0),
        external_updated_at: this.day(4),
      },
    ];
  }

  private sampleInventory(): SapInventoryRecord[] {
    return [
      {
        external_id: 'SAP-INV-1',
        material_code: 'RM-PAO-6',
        plant: 'CN-1',
        available_qty: 8200,
        reserved_qty: 200,
        uom: 'kg',
        external_updated_at: this.day(2),
      },
      {
        external_id: 'SAP-INV-2',
        material_code: 'RM-GIII-4',
        plant: 'CN-1',
        available_qty: 11500,
        reserved_qty: 0,
        uom: 'kg',
        external_updated_at: this.day(3),
      },
      {
        external_id: 'SAP-INV-3',
        material_code: 'RM-OCP',
        plant: 'CN-1',
        available_qty: 850,
        reserved_qty: 100,
        uom: 'kg',
        external_updated_at: this.day(5),
      },
      {
        external_id: 'SAP-INV-4',
        material_code: 'RM-PKG-A',
        plant: 'CN-1',
        available_qty: 1300,
        reserved_qty: 200,
        uom: 'kg',
        external_updated_at: this.day(6),
      },
    ];
  }
}
