/**
 * HTTP layer for the Knowledge & Document module.
 *
 * KB CRUD routes:
 *   GET    /knowledge/raw-materials            list
 *   POST   /knowledge/raw-materials            create
 *   GET    /knowledge/raw-materials/:id        read
 *   PATCH  /knowledge/raw-materials/:id        update
 *   DELETE /knowledge/raw-materials/:id        soft-delete
 *
 *   GET    /knowledge/formulas                 list
 *   POST   /knowledge/formulas                 create
 *   GET    /knowledge/formulas/:id             read
 *   PATCH  /knowledge/formulas/:id             update
 *   DELETE /knowledge/formulas/:id             soft-delete
 *
 * Document routes (mounted under `/docs`):
 *   POST   /docs/upload                        multipart upload
 *   GET    /docs                               list
 *   GET    /docs/:id                           detail (doc + current_result + active_task)
 *   GET    /docs/:id/results                   versioned result history
 *   POST   /docs/parse/:id                     enqueue + run parse task
 *   POST   /docs/:id/confirm                   approve / reject / edit (+ optional KB promotion)
 *   DELETE /docs/:id                           soft-delete
 */
import { Router, type Request } from 'express';
import multer from 'multer';
import { validate } from '../../middleware/validate.js';
import { paginated, success } from '../../lib/response.js';
import {
  ConfirmSchema,
  CreateFormulaKbSchema,
  CreateRawMaterialKbSchema,
  DocumentListQuerySchema,
  IdParamSchema,
  KbListQuerySchema,
  ParseEnqueueSchema,
  UpdateFormulaKbSchema,
  UpdateRawMaterialKbSchema,
  UploadDocMetadataSchema,
  normaliseMetadata,
  normaliseTags,
} from './schemas.js';
import type { KnowledgeService } from './service.js';
import { ACCEPTED_MIME_TYPES } from './types.js';

const userIdOf = (req: Request): string | null =>
  (req as Request & { userId?: string }).userId ?? null;

/** Default upload limit — overridable via DOC_UPLOAD_MAX_MB. */
const MAX_UPLOAD_MB = Number(process.env.DOC_UPLOAD_MAX_MB ?? 25);

export interface BuildKnowledgeRouterOptions {
  /** Override multer file size limit in MB (tests may want smaller). */
  maxUploadMb?: number;
}

export function buildKnowledgeRouter(
  service: KnowledgeService,
  opts: BuildKnowledgeRouterOptions = {}
): { knowledgeRouter: Router; documentRouter: Router } {
  const knowledgeRouter = Router();
  const documentRouter = Router();

  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: (opts.maxUploadMb ?? MAX_UPLOAD_MB) * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if ((ACCEPTED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported mime type '${file.mimetype}'`));
      }
    },
  });

  // ──────────────────────────────────────────────────────────────────
  // Raw material KB
  // ──────────────────────────────────────────────────────────────────
  knowledgeRouter.get(
    '/raw-materials',
    validate({ query: KbListQuerySchema }),
    async (req, res) => {
      const q = req.query as unknown as {
        status?: 'draft' | 'published' | 'archived';
        q?: string;
        page: number;
        pageSize: number;
      };
      const result = await service.listRawMaterialKb(q);
      res.json(paginated(result.items, result.total, q.page, q.pageSize, req.traceId));
    }
  );

  knowledgeRouter.post(
    '/raw-materials',
    validate({ body: CreateRawMaterialKbSchema }),
    async (req, res) => {
      const created = await service.createRawMaterialKb(req.body, userIdOf(req));
      res.status(201).json(success(created, 'Raw material KB created', req.traceId));
    }
  );

  knowledgeRouter.get(
    '/raw-materials/:id',
    validate({ params: IdParamSchema }),
    async (req, res) => {
      const r = await service.getRawMaterialKb(req.params.id as string);
      res.json(success(r, 'success', req.traceId));
    }
  );

  knowledgeRouter.patch(
    '/raw-materials/:id',
    validate({ params: IdParamSchema, body: UpdateRawMaterialKbSchema }),
    async (req, res) => {
      const updated = await service.updateRawMaterialKb(
        req.params.id as string,
        req.body,
        userIdOf(req)
      );
      res.json(success(updated, 'Raw material KB updated', req.traceId));
    }
  );

  knowledgeRouter.delete(
    '/raw-materials/:id',
    validate({ params: IdParamSchema }),
    async (req, res) => {
      await service.removeRawMaterialKb(req.params.id as string, userIdOf(req));
      res.status(204).end();
    }
  );

  // ──────────────────────────────────────────────────────────────────
  // Formula KB
  // ──────────────────────────────────────────────────────────────────
  knowledgeRouter.get('/formulas', validate({ query: KbListQuerySchema }), async (req, res) => {
    const q = req.query as unknown as {
      status?: 'draft' | 'published' | 'archived';
      q?: string;
      page: number;
      pageSize: number;
    };
    const result = await service.listFormulaKb(q);
    res.json(paginated(result.items, result.total, q.page, q.pageSize, req.traceId));
  });

  knowledgeRouter.post('/formulas', validate({ body: CreateFormulaKbSchema }), async (req, res) => {
    const created = await service.createFormulaKb(req.body, userIdOf(req));
    res.status(201).json(success(created, 'Formula KB created', req.traceId));
  });

  knowledgeRouter.get('/formulas/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.getFormulaKb(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  knowledgeRouter.patch(
    '/formulas/:id',
    validate({ params: IdParamSchema, body: UpdateFormulaKbSchema }),
    async (req, res) => {
      const updated = await service.updateFormulaKb(
        req.params.id as string,
        req.body,
        userIdOf(req)
      );
      res.json(success(updated, 'Formula KB updated', req.traceId));
    }
  );

  knowledgeRouter.delete('/formulas/:id', validate({ params: IdParamSchema }), async (req, res) => {
    await service.removeFormulaKb(req.params.id as string, userIdOf(req));
    res.status(204).end();
  });

  // ──────────────────────────────────────────────────────────────────
  // Documents
  // ──────────────────────────────────────────────────────────────────

  // POST /docs/upload — multipart/form-data with field `file` + JSON metadata.
  documentRouter.post('/upload', uploader.single('file'), async (req, res, next) => {
    try {
      if (!req.file) throw new Error('Missing file field');
      const metaParsed = UploadDocMetadataSchema.safeParse(req.body ?? {});
      if (!metaParsed.success) {
        const message = metaParsed.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('; ');
        throw new Error(`Invalid metadata: ${message}`);
      }
      const meta = metaParsed.data;
      const tags = normaliseTags(meta.tags);
      const metadata = normaliseMetadata(meta.metadata);
      const parse = meta.parse === true || meta.parse === 'true' || meta.parse === '1';

      const result = await service.uploadDocument(
        {
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
        {
          title: meta.title,
          description: meta.description,
          doc_type: meta.doc_type,
          category: meta.category,
          language: meta.language,
          visibility: meta.visibility,
          ...(tags ? { tags } : {}),
          related_raw_material_id: meta.related_raw_material_id ?? null,
          related_formula_id: meta.related_formula_id ?? null,
          related_supplier_id: meta.related_supplier_id ?? null,
          ...(metadata ? { metadata } : {}),
          parse,
        },
        { trace_id: req.traceId, user_id: userIdOf(req) }
      );
      res.status(201).json(success(result, 'Document uploaded', req.traceId));
    } catch (err) {
      next(err);
    }
  });

  documentRouter.get('/', validate({ query: DocumentListQuerySchema }), async (req, res) => {
    const q = req.query as unknown as Parameters<KnowledgeService['listDocuments']>[0];
    const r = await service.listDocuments(q);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  documentRouter.post(
    '/parse/:id',
    validate({ params: IdParamSchema, body: ParseEnqueueSchema.optional().default({}) }),
    async (req, res) => {
      const r = await service.enqueueParse(req.params.id as string, req.body ?? {}, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.status(202).json(success(r, 'Parse task enqueued', req.traceId));
    }
  );

  documentRouter.get('/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.getDocumentDetail(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  documentRouter.get('/:id/results', validate({ params: IdParamSchema }), async (req, res) => {
    const items = await service.listResults(req.params.id as string);
    res.json(success(items, 'success', req.traceId));
  });

  documentRouter.post(
    '/:id/confirm',
    validate({ params: IdParamSchema, body: ConfirmSchema }),
    async (req, res) => {
      const r = await service.confirm(req.params.id as string, req.body, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.json(success(r, 'Document confirmed', req.traceId));
    }
  );

  return { knowledgeRouter, documentRouter };
}
