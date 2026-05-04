import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../../middleware/validate.js';
import { success, paginated } from '../../../lib/response.js';
import {
  MaterialCreateSchema,
  MaterialUpdateSchema,
  MaterialListQuerySchema,
  MaterialIdParamSchema,
  MaterialResolveQuerySchema,
} from './schemas.js';
import type { MaterialsService } from './service.js';

interface AuthedReq extends Request {
  userId?: string;
}

export function buildMaterialsRouter(service: MaterialsService): Router {
  const router = Router();
  const actor = (req: AuthedReq) => ({ userId: req.userId });

  router.get(
    '/',
    validate({ query: MaterialListQuerySchema }),
    async (req: Request, res: Response) => {
      const query = req.query as unknown as z.infer<typeof MaterialListQuerySchema>;
      const result = await service.list(query);
      res.json(paginated(result.items, result.total, result.page, result.pageSize));
    }
  );

  router.get(
    '/resolve',
    validate({ query: MaterialResolveQuerySchema }),
    async (req: Request, res: Response) => {
      const { q } = req.query as unknown as z.infer<typeof MaterialResolveQuerySchema>;
      const result = await service.resolve(q);
      res.json(success(result));
    }
  );

  router.get(
    '/:id',
    validate({ params: MaterialIdParamSchema }),
    async (req: Request, res: Response) => {
      const material = await service.get(req.params.id as string);
      res.json(success(material));
    }
  );

  router.post(
    '/',
    validate({ body: MaterialCreateSchema }),
    async (req: AuthedReq, res: Response) => {
      const created = await service.create(req.body, actor(req));
      res.status(201).json(success(created, 'Material created'));
    }
  );

  router.patch(
    '/:id',
    validate({ params: MaterialIdParamSchema, body: MaterialUpdateSchema }),
    async (req: AuthedReq, res: Response) => {
      const updated = await service.update(req.params.id as string, req.body, actor(req));
      res.json(success(updated, 'Material updated'));
    }
  );

  router.delete(
    '/:id',
    validate({ params: MaterialIdParamSchema }),
    async (req: AuthedReq, res: Response) => {
      await service.remove(req.params.id as string, actor(req));
      res.status(204).end();
    }
  );

  // ---------------------- Aliases ----------------------
  router.get(
    '/:id/aliases',
    validate({ params: MaterialIdParamSchema }),
    async (req: Request, res: Response) => {
      const aliases = await service.listAliases(req.params.id as string);
      res.json(success(aliases));
    }
  );

  const AddAliasSchema = z.object({
    alias: z.string().min(1),
    alias_type: z.enum(['name','abbreviation','trade_name','cas','supplier_sku','legacy_code','synonym']).optional(),
    language: z.string().optional(),
    source: z.enum(['manual','import','auto_suggested']).optional(),
  });

  router.post(
    '/:id/aliases',
    validate({ params: MaterialIdParamSchema, body: AddAliasSchema }),
    async (req: AuthedReq, res: Response) => {
      const created = await service.addAlias(
        req.params.id as string,
        req.body.alias,
        actor(req),
        req.body
      );
      res.status(201).json(success(created, 'Alias created'));
    }
  );

  return router;
}
