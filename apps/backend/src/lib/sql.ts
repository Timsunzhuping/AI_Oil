/**
 * Tiny query-building helpers tailored to our master-data CRUD repositories.
 *
 * NOT a full ORM — just enough to keep parameterized SQL readable.
 */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

export function paginationClause(opts: PageQuery, allowedSort: string[], paramOffset: number) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 20));
  const orderBy = allowedSort.includes(opts.orderBy ?? '')
    ? (opts.orderBy as string)
    : allowedSort[0];
  const orderDir = opts.orderDir === 'asc' ? 'ASC' : 'DESC';
  return {
    page,
    pageSize,
    sql: `ORDER BY ${orderBy} ${orderDir} LIMIT $${paramOffset + 1} OFFSET $${paramOffset + 2}`,
    params: [pageSize, (page - 1) * pageSize] as const,
  };
}

/**
 * Build a `SET col1 = $n, col2 = $n+1` clause from an object, returning
 * the SQL fragment, the parameter list, and the next placeholder index.
 */
export function buildUpdateSet(
  obj: Record<string, unknown>,
  paramStart = 1
): { sql: string; params: unknown[]; nextIndex: number } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let i = paramStart;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    parts.push(`${k} = $${i}`);
    params.push(v);
    i++;
  }
  return { sql: parts.join(', '), params, nextIndex: i };
}

/**
 * Lower-case + trim — the canonical normalization used for alias keys.
 */
export function normalizeAlias(input: string): string {
  return input.trim().toLowerCase();
}
