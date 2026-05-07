/**
 * Constraint filter — runs BEFORE the surrogate evaluator so we don't waste
 * inference cycles on candidates that are doomed by hard constraints.
 *
 * Constraints checked here are PURELY structural (BOM totals, locked
 * materials, inventory budget, BOM-level cost / process). Metric-level
 * checks (target windows) live in the ranker because they need the
 * predictor's output.
 */
import type { BomItem } from '../../prediction/types.js';
import type {
  ConstraintMatch,
  GenerateRequest,
  InventoryConstraint,
  LockedMaterial,
  MaterialPoolEntry,
  ProcessConstraints,
} from '../types.js';

export interface ConstraintFilter {
  evaluate(bom: BomItem[], request: GenerateRequest): ConstraintMatch;
  /** True iff the candidate may proceed to the evaluator. */
  passes(match: ConstraintMatch): boolean;
}

/** Reasons surfaced in `failed[].code`. Stable so the UI can colour them. */
export const CONSTRAINT_CODES = {
  BOM_TOTAL: 'BOM_TOTAL_INVALID',
  LOCKED_MISSING: 'LOCKED_MATERIAL_MISSING',
  LOCKED_RATIO: 'LOCKED_MATERIAL_RATIO_DRIFT',
  INVENTORY: 'INVENTORY_INSUFFICIENT',
  COST_LIMIT: 'COST_LIMIT_EXCEEDED',
  ROLE_COVERAGE: 'ROLE_COVERAGE_INCOMPLETE',
  PROCESS: 'PROCESS_CONSTRAINT',
} as const;

export class DefaultConstraintFilter implements ConstraintFilter {
  /** Tolerance for BOM total ≈ 1.0 — a few thousandths of rounding is OK. */
  bomTotalTolerance = 0.01;

  /** Tolerance for locked-ratio drift after normalisation. */
  lockedRatioTolerance = 0.005;

  /** Required functional roles (overridable per category). */
  requiredRoles: string[] = ['base_oil'];

  evaluate(bom: BomItem[], req: GenerateRequest): ConstraintMatch {
    const passed: string[] = [];
    const failed: ConstraintMatch['failed'] = [];

    // 1. BOM total ≈ 1.0
    const total = bom.reduce((s, it) => s + it.ratio, 0);
    if (Math.abs(total - 1) > this.bomTotalTolerance) {
      failed.push({
        code: CONSTRAINT_CODES.BOM_TOTAL,
        reason: `BOM ratios sum to ${total.toFixed(4)} (expected 1.0 ± ${this.bomTotalTolerance})`,
      });
    } else {
      passed.push(CONSTRAINT_CODES.BOM_TOTAL);
    }

    // 2. locked materials
    const lockedFail = this.checkLocked(bom, req.locked_materials ?? []);
    if (lockedFail) failed.push(lockedFail);
    else passed.push('LOCKED_MATERIALS_PRESENT');

    // 3. role coverage
    const missingRole = this.requiredRoles.find((r) => !bom.some((it) => it.role === r));
    if (missingRole) {
      failed.push({
        code: CONSTRAINT_CODES.ROLE_COVERAGE,
        reason: `BOM is missing a material with role='${missingRole}'`,
      });
    } else {
      passed.push(CONSTRAINT_CODES.ROLE_COVERAGE);
    }

    // 4. inventory
    const invFail = this.checkInventory(bom, req.inventory_constraints ?? []);
    if (invFail) failed.push(invFail);
    else passed.push('INVENTORY_OK');

    // 5. cost limit (BOM-level lower bound; evaluator may add nuance)
    const costFail = this.checkCost(bom, req.material_pool ?? [], req.cost_limit);
    if (costFail) failed.push(costFail);
    else passed.push('COST_OK');

    // 6. process constraints (only the explicit, non-metric ones at this stage)
    const procFail = this.checkProcess(req.process_constraints);
    if (procFail) failed.push(procFail);
    else passed.push('PROCESS_OK');

    const total_checks = passed.length + failed.length;
    const score = total_checks === 0 ? 1 : passed.length / total_checks;
    return { passed, failed, score };
  }

  passes(match: ConstraintMatch): boolean {
    // Hard pass: only candidates with no `failed` entries proceed.
    return match.failed.length === 0;
  }

  // ────────────────────────────────────────────────────────────────────

  protected checkLocked(
    bom: BomItem[],
    locked: LockedMaterial[]
  ): ConstraintMatch['failed'][number] | null {
    for (const lk of locked) {
      const found = bom.find((it) => it.material_code === lk.material_code);
      if (!found) {
        return {
          code: CONSTRAINT_CODES.LOCKED_MISSING,
          reason: `Locked material '${lk.material_code}' is missing from candidate BOM`,
        };
      }
      if (lk.ratio !== undefined && Math.abs(found.ratio - lk.ratio) > this.lockedRatioTolerance) {
        return {
          code: CONSTRAINT_CODES.LOCKED_RATIO,
          reason: `Locked material '${lk.material_code}' ratio drifted to ${found.ratio.toFixed(4)} (expected ${lk.ratio})`,
        };
      }
    }
    return null;
  }

  protected checkInventory(
    bom: BomItem[],
    inv: InventoryConstraint[]
  ): ConstraintMatch['failed'][number] | null {
    for (const ic of inv) {
      const item = bom.find((it) => it.material_code === ic.material_code);
      if (!item) continue;
      const batch = ic.batch_size_kg ?? 1000;
      const required = item.ratio * batch;
      if (required > ic.available_kg) {
        return {
          code: CONSTRAINT_CODES.INVENTORY,
          reason: `Material '${ic.material_code}' requires ${required.toFixed(1)} kg, only ${ic.available_kg} kg in stock`,
        };
      }
    }
    return null;
  }

  protected checkCost(
    bom: BomItem[],
    pool: MaterialPoolEntry[],
    limit: number | undefined
  ): ConstraintMatch['failed'][number] | null {
    if (limit === undefined || limit === null) return null;
    const cost = estimateBomCost(bom, pool);
    if (cost === null) return null; // can't enforce without unit costs
    if (cost > limit + 1e-6) {
      return {
        code: CONSTRAINT_CODES.COST_LIMIT,
        reason: `Estimated cost ${cost.toFixed(2)} exceeds limit ${limit}`,
      };
    }
    return null;
  }

  protected checkProcess(
    p: ProcessConstraints | undefined
  ): ConstraintMatch['failed'][number] | null {
    if (!p) return null;
    // Generators don't yet emit process targets; just sanity-check the
    // user-supplied bounds for internal consistency.
    if (p.blending_temperature_c) {
      const { min, max } = p.blending_temperature_c;
      if (min !== undefined && max !== undefined && min > max) {
        return {
          code: CONSTRAINT_CODES.PROCESS,
          reason: `blending_temperature_c min (${min}) is greater than max (${max})`,
        };
      }
    }
    if (p.blending_time_min) {
      const { min, max } = p.blending_time_min;
      if (min !== undefined && max !== undefined && min > max) {
        return {
          code: CONSTRAINT_CODES.PROCESS,
          reason: `blending_time_min min (${min}) is greater than max (${max})`,
        };
      }
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper exposed to other pipeline pieces.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate the BOM cost in CNY/kg (or whatever unit `unit_cost` uses).
 * Returns null when we lack price data for at least one item.
 */
export function estimateBomCost(bom: BomItem[], pool: MaterialPoolEntry[]): number | null {
  const priceByCode = new Map<string, number>();
  for (const m of pool) {
    if (m.unit_cost !== undefined) priceByCode.set(m.material_code, m.unit_cost);
  }
  let cost = 0;
  let priced = 0;
  for (const it of bom) {
    const p = priceByCode.get(it.material_code);
    if (p !== undefined) {
      cost += p * it.ratio;
      priced += 1;
    }
  }
  if (priced === 0) return null;
  // Inflate for any unpriced item (assume average pool price)
  if (priced < bom.length) {
    const avg = (() => {
      let s = 0;
      let n = 0;
      priceByCode.forEach((p) => {
        s += p;
        n += 1;
      });
      return n === 0 ? 0 : s / n;
    })();
    const unpriced = bom.length - priced;
    const unpricedRatio = bom
      .filter((it) => !priceByCode.has(it.material_code))
      .reduce((s, it) => s + it.ratio, 0);
    cost += avg * unpricedRatio;
    void unpriced;
  }
  return Math.round(cost * 100) / 100;
}

/**
 * Estimate BOM carbon footprint in kgCO₂e/kg. Returns null when no entry has
 * a `carbon_per_kg` value (consistent with `estimateBomCost`).
 */
export function estimateBomCarbon(bom: BomItem[], pool: MaterialPoolEntry[]): number | null {
  const co2ByCode = new Map<string, number>();
  for (const m of pool) {
    if (m.carbon_per_kg !== undefined) co2ByCode.set(m.material_code, m.carbon_per_kg);
  }
  if (co2ByCode.size === 0) return null;
  let v = 0;
  for (const it of bom) {
    const c = co2ByCode.get(it.material_code);
    if (c !== undefined) v += c * it.ratio;
  }
  return Math.round(v * 1000) / 1000;
}
