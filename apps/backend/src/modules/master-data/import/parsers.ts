import { parse as parseCsvSync } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

export interface ParsedRow {
  rowIndex: number;       // 1-based row number from the source (1 = first DATA row, header is 0)
  data: Record<string, string>;
}

/**
 * Parse a CSV buffer. Returns rows keyed by lowercased header names.
 * Handles BOM, quoting, and trailing whitespace.
 */
export function parseCsv(buffer: Buffer): ParsedRow[] {
  const text = buffer.toString('utf8').replace(/^﻿/, ''); // strip BOM
  const records = parseCsvSync(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  return records.map((data, idx) => ({ rowIndex: idx + 1, data }));
}

/**
 * Parse an XLSX/XLS buffer. Reads only the FIRST sheet.
 * Returns rows keyed by lowercased header names.
 */
export function parseXlsx(buffer: Buffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];

  const aoa = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown as string[][];

  if (aoa.length < 2) return [];

  const header = (aoa[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const data: Record<string, string> = {};
    header.forEach((key, j) => {
      if (key) data[key] = String(row[j] ?? '').trim();
    });
    // skip rows where every cell is empty
    if (Object.values(data).every((v) => v === '')) continue;
    rows.push({ rowIndex: i, data });
  }
  return rows;
}

export function parseByFormat(buffer: Buffer, format: 'csv' | 'xlsx'): ParsedRow[] {
  return format === 'xlsx' ? parseXlsx(buffer) : parseCsv(buffer);
}
