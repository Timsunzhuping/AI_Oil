import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import { MaterialsRepository, MaterialRow } from './repository.js';
import type { MaterialCreateInput, MaterialUpdateInput, MaterialListQuery } from './schemas.js';

export class MaterialsService {
  constructor(private repo: MaterialsRepository) {}

  list(query: MaterialListQuery) {
    return this.repo.list(query);
  }

  async get(id: string): Promise<MaterialRow> {
    const r = await this.repo.findById(id);
    if (!r) throw new NotFoundError('Material');
    return r;
  }

  async create(input: MaterialCreateInput, actor: { userId?: string }): Promise<MaterialRow> {
    const existing = await this.repo.findByCode(input.code);
    if (existing) throw new ConflictError(`Material with code '${input.code}' already exists`);
    return this.repo.insert(input, actor);
  }

  async update(id: string, input: MaterialUpdateInput, actor: { userId?: string }): Promise<MaterialRow> {
    const updated = await this.repo.update(id, input, actor);
    if (!updated) {
      // Either not found or version mismatch — disambiguate
      const existing = await this.repo.findById(id);
      if (!existing) throw new NotFoundError('Material');
      throw new ConflictError(
        `Version mismatch — expected ${input.expected_version} but current is ${existing.version}`
      );
    }
    return updated;
  }

  async remove(id: string, actor: { userId?: string }): Promise<void> {
    const ok = await this.repo.softDelete(id, actor);
    if (!ok) throw new NotFoundError('Material');
  }

  // ---------------------- Aliases ----------------------

  async resolve(query: string) {
    const result = await this.repo.resolveByQuery(query);
    return {
      query,
      matched: result.material !== null,
      matched_by: result.matchedBy,
      confidence: result.confidence,
      material: result.material,
      alias_id: result.aliasId ?? null,
    };
  }

  async listAliases(materialId: string) {
    await this.get(materialId); // ensure existence
    return this.repo.findAliases(materialId);
  }

  async addAlias(
    materialId: string,
    alias: string,
    actor: { userId?: string },
    opts: { alias_type?: string; language?: string; source?: string } = {}
  ) {
    await this.get(materialId);
    return this.repo.addAlias(materialId, { alias, ...opts }, actor);
  }

  /**
   * Used by the import service: insert if code is new, update if it exists.
   * Returns the resulting row plus a flag.
   */
  async upsertByCode(
    input: MaterialCreateInput,
    actor: { userId?: string }
  ): Promise<{ row: MaterialRow; created: boolean }> {
    const existing = await this.repo.findByCode(input.code);
    if (existing) {
      const updated = await this.repo.update(
        existing.id,
        { ...input, expected_version: existing.version },
        actor
      );
      return { row: updated ?? existing, created: false };
    }
    const row = await this.repo.insert(input, actor);
    return { row, created: true };
  }
}
