import { describe, it, expect } from 'vitest';
import { parseCsv, parseXlsx } from '../../../src/modules/master-data/import/parsers.js';
import * as XLSX from 'xlsx';

describe('parsers.parseCsv', () => {
  it('reads a simple CSV with header lowercasing', () => {
    const csv = 'CODE,Name,Density\nRM-001,Mineral Oil,0.87\nRM-002,PAO 6,0.82\n';
    const rows = parseCsv(Buffer.from(csv));
    expect(rows).toHaveLength(2);
    expect(rows[0].rowIndex).toBe(1);
    expect(rows[0].data).toEqual({ code: 'RM-001', name: 'Mineral Oil', density: '0.87' });
    expect(rows[1].data.code).toBe('RM-002');
  });

  it('strips UTF-8 BOM', () => {
    const csv = '﻿code,name\nA,B\n';
    const rows = parseCsv(Buffer.from(csv, 'utf8'));
    expect(rows[0].data.code).toBe('A');
  });

  it('trims whitespace and skips empty lines', () => {
    const csv = 'code,name\n  RM-1  ,  Foo  \n\n  RM-2  ,Bar\n';
    const rows = parseCsv(Buffer.from(csv));
    expect(rows).toHaveLength(2);
    expect(rows[0].data.code).toBe('RM-1');
    expect(rows[0].data.name).toBe('Foo');
  });

  it('handles quoted fields with commas', () => {
    const csv = 'code,description\nRM-X,"Hello, world"\n';
    const rows = parseCsv(Buffer.from(csv));
    expect(rows[0].data.description).toBe('Hello, world');
  });
});

describe('parsers.parseXlsx', () => {
  it('reads the first sheet of a workbook', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Code', 'Name', 'Density'],
      ['RM-001', 'Mineral Oil', '0.87'],
      ['RM-002', 'PAO 6', '0.82'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const rows = parseXlsx(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].data.code).toBe('RM-001');
  });

  it('returns empty for a workbook with only a header', () => {
    const ws = XLSX.utils.aoa_to_sheet([['code', 'name']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    expect(parseXlsx(buffer)).toEqual([]);
  });
});
