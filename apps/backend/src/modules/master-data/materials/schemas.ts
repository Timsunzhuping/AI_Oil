import { z } from 'zod';

export const MaterialCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  alternate_names: z.array(z.string()).optional(),
  cas_number: z.string().max(32).optional().nullable(),
  einecs_number: z.string().max(32).optional().nullable(),
  hs_code: z.string().max(32).optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  physical_state: z.enum(['solid','liquid','gas','paste','powder','granule']).optional().nullable(),
  density: z.number().nonnegative().optional().nullable(),
  molecular_weight: z.number().nonnegative().optional().nullable(),
  melting_point_c: z.number().optional().nullable(),
  boiling_point_c: z.number().optional().nullable(),
  flash_point_c: z.number().optional().nullable(),
  viscosity_cst: z.number().nonnegative().optional().nullable(),
  ph_value: z.number().min(0).max(14).optional().nullable(),
  unit_of_measure: z.string().max(32).default('kg'),
  default_supplier_id: z.string().uuid().optional().nullable(),
  default_unit_cost: z.number().nonnegative().optional().nullable(),
  cost_currency: z.string().length(3).optional(),
  shelf_life_days: z.number().int().nonnegative().optional().nullable(),
  storage_conditions: z.string().optional().nullable(),
  hazard_class: z.string().optional().nullable(),
  ghs_codes: z.array(z.string()).optional(),
  is_restricted: z.boolean().optional(),
  is_controlled: z.boolean().optional(),
  status: z.enum(['active','phased_out','obsolete','blocked']).default('active'),
  properties: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const MaterialUpdateSchema = MaterialCreateSchema.partial().extend({
  expected_version: z.number().int().nonnegative(),
});

export const MaterialListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().optional(),
  category_id: z.string().uuid().optional(),
  status: z.string().optional(),
  tag: z.string().optional(),
  orderBy: z.enum(['code','name','created_at','updated_at']).default('created_at'),
  orderDir: z.enum(['asc','desc']).default('desc'),
});

export const MaterialIdParamSchema = z.object({ id: z.string().uuid() });
export const MaterialResolveQuerySchema = z.object({
  q: z.string().min(1),
});

export type MaterialCreateInput = z.infer<typeof MaterialCreateSchema>;
export type MaterialUpdateInput = z.infer<typeof MaterialUpdateSchema>;
export type MaterialListQuery = z.infer<typeof MaterialListQuerySchema>;
