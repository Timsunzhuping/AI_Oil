import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { Pool } from 'pg';
import { z } from 'zod';
import { BadRequestError } from '../../../lib/errors.js';
import { validate } from '../../../middleware/validate.js';
import { success } from '../../../lib/response.js';
import { ImportService, type ImportTarget } from './import.service.js';
import { SCHEMA_BY_TARGET } from './validators.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB cap
});

const ImportBodySchema = z.object({
  target: z.string().refine((v) => Object.keys(SCHEMA_BY_TARGET).includes(v), {
    message: `target must be one of: ${Object.keys(SCHEMA_BY_TARGET).join(', ')}`,
  }),
  mode: z.enum(['insert','update','upsert','dry_run']).default('upsert'),
});

const JobListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  target: z.string().optional(),
  status: z.string().optional(),
});

export function buildImportRouter(pool: Pool): Router {
  const router = Router();
  const service = new ImportService(pool);

  router.post(
    '/',
    upload.single('file'),
    async (req: Request, res: Response) => {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) throw new BadRequestError('Missing file (multipart field "file")');

      const body = ImportBodySchema.safeParse(req.body);
      if (!body.success) {
        throw new BadRequestError(
          'Invalid request: ' + body.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
        );
      }

      // Detect format from filename or mime
      const lowerName = (file.originalname ?? '').toLowerCase();
      const format: 'csv' | 'xlsx' = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')
        ? 'xlsx'
        : lowerName.endsWith('.csv') || file.mimetype === 'text/csv'
        ? 'csv'
        : 'csv';

      const report = await service.run({
        target: body.data.target as ImportTarget,
        format,
        buffer: file.buffer,
        filename: file.originalname,
        mode: body.data.mode,
        userId: (req as Request & { userId?: string }).userId,
      });

      // Map status -> HTTP code
      const httpStatus = report.status === 'completed' ? 200 : report.status === 'partial' ? 207 : 422;
      res.status(httpStatus).json(success(report, `Import ${report.status}`));
    }
  );

  // List recent import jobs
  router.get('/jobs', validate({ query: JobListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof JobListQuery>;
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (q.target) { where.push(`target = $${i}`); params.push(q.target); i++; }
    if (q.status) { where.push(`status = $${i}`); params.push(q.status); i++; }

    const limit = q.pageSize;
    const offset = (q.page - 1) * q.pageSize;
    const totalRes = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text c FROM import_jobs WHERE ${where.join(' AND ')}`,
      params
    );
    const rows = await pool.query(
      `SELECT id, target, source_filename, source_format, total_rows, success_count, error_count,
              warning_count, status, mode, duration_ms, imported_by, created_at, completed_at
         FROM import_jobs
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );
    res.json(success({
      items: rows.rows,
      total: parseInt(totalRes.rows[0]?.c ?? '0', 10),
      page: q.page,
      pageSize: q.pageSize,
    }));
  });

  router.get('/jobs/:id', async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const r = await pool.query(`SELECT * FROM import_jobs WHERE id = $1`, [id]);
    if (!r.rows[0]) throw new BadRequestError('Import job not found');
    res.json(success(r.rows[0]));
  });

  return router;
}
