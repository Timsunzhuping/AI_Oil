import type {
  Adapter,
  AdapterRecord,
  ConnectionTestResult,
  Cursor,
  EntityCapability,
  ExtractContext,
  SourceRow,
  SourceType,
} from '../types.js';

/**
 * Convenience base. Concrete adapters override the abstract methods.
 * Provides a default `nextCursor` strategy that advances by `external_updated_at`.
 */
export abstract class BaseAdapter implements Adapter {
  abstract readonly sourceType: SourceType;

  abstract capabilities(): EntityCapability[];

  abstract testConnection(source: SourceRow): Promise<ConnectionTestResult>;

  abstract extractFull(ctx: ExtractContext): AsyncIterable<AdapterRecord>;
  abstract extractIncremental(ctx: ExtractContext, cursor: Cursor | null): AsyncIterable<AdapterRecord>;

  /**
   * Default cursor advance: take the last record's `external_updated_at`
   * (or `external_id` as fallback) and store it under `since`.
   */
  nextCursor(currentCursor: Cursor | null, lastRecord: AdapterRecord | null): Cursor | null {
    if (!lastRecord) return currentCursor;
    const since = lastRecord.external_updated_at ?? lastRecord.external_id;
    if (!since) return currentCursor;
    return { ...(currentCursor ?? {}), since: typeof since === 'string' ? since : new Date(since).toISOString() };
  }
}

/**
 * Sleep helper — mock adapters use this to simulate IO.
 */
export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
