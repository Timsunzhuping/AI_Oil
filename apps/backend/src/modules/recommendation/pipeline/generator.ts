/**
 * Candidate generator.
 *
 * Produces an over-sampled set of N candidate BOMs that the downstream
 * filter / evaluator / ranker can prune. Different strategies have
 * different sampling logic, but every BOM produced here is well-formed
 * (ratios sum to 1.0, locked materials honoured, role coverage met).
 *
 * This is deliberately the SIMPLEST sensible random-walk generator —
 * future iterations can swap in Bayesian optimisation, NSGA-II, or a
 * latent-space sampler without touching the rest of the pipeline. The
 * `CandidateGenerator` interface is the only contract.
 */
import type { BomItem } from '../../prediction/types.js';
import type { Rng } from '../random.js';
import type {
  GenerateRequest,
  LockedMaterial,
  MaterialPoolEntry,
  RecommendationStrategy,
  ReplacementCandidate,
} from '../types.js';

export interface RawCandidate {
  /** Internal label propagated to `metadata.label` for traceability. */
  label: string;
  bom: BomItem[];
  /** What the generator wants to communicate to ranker (e.g. seed origin). */
  metadata: Record<string, unknown>;
}

export interface CandidateGenerator {
  generate(request: GenerateRequest, strategy: RecommendationStrategy, rng: Rng): RawCandidate[];
}

/**
 * Default generator — random-walk with role-coverage and lock honouring.
 *
 * Tuneable knobs are public so subclasses / tests can override, but the
 * defaults are calibrated against the seed mock data.
 */
export class DefaultCandidateGenerator implements CandidateGenerator {
  /** How many raw candidates to over-sample before filtering. */
  oversampleFactor = 6;

  generate(req: GenerateRequest, strategy: RecommendationStrategy, rng: Rng): RawCandidate[] {
    const target = (req.n_candidates ?? 5) * this.oversampleFactor;
    switch (strategy) {
      case 'cost_priority':
        return this.costPriority(req, rng, target);
      case 'material_replacement':
        return this.materialReplacement(req, rng, target);
      case 'new_product':
        return this.newProduct(req, rng, target);
      default: {
        const _exhaustive: never = strategy;
        return _exhaustive;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Strategy 1 — cost-priority: vary base oils + VII, pick cheap detergents.
  // ──────────────────────────────────────────────────────────────────────
  protected costPriority(req: GenerateRequest, rng: Rng, n: number): RawCandidate[] {
    const pool = req.material_pool ?? [];
    if (pool.length === 0) return [];
    const out: RawCandidate[] = [];
    for (let i = 0; i < n; i++) {
      const bom = this.buildSampledBom(pool, req.locked_materials ?? [], rng, /* costBias */ true);
      if (bom.length > 0) {
        out.push({
          label: `cost-${i + 1}`,
          bom,
          metadata: { strategy: 'cost_priority', sample: i },
        });
      }
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Strategy 2 — material replacement: take base BOM, swap in pool entries.
  // ──────────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected materialReplacement(req: GenerateRequest, rng: Rng, _n: number): RawCandidate[] {
    const base = req.base_bom ?? [];
    const pool = req.replacement_pool ?? [];
    if (base.length === 0 || pool.length === 0) return [];
    const out: RawCandidate[] = [];
    for (let i = 0; i < pool.length; i++) {
      const swap = pool[i] as ReplacementCandidate;
      const bom = base.map<BomItem>((it) => {
        if (it.material_code === swap.replace_material_code) {
          const ratio = swap.fixed_ratio ?? it.ratio;
          // Resolve a friendly material_name — fall back to the code.
          const name =
            (req.material_pool ?? []).find((m) => m.material_code === swap.with_material_code)
              ?.material_name ?? swap.with_material_code;
          return { ...it, material_code: swap.with_material_code, material_name: name, ratio };
        }
        return it;
      });
      const balanced = this.normaliseRatios(bom, req.locked_materials ?? []);
      out.push({
        label: `swap-${swap.replace_material_code}->${swap.with_material_code}`,
        bom: balanced,
        metadata: { strategy: 'material_replacement', swap },
      });
    }
    // Optional: shuffle a copy so the over-sample isn't strictly deterministic
    // in candidate ORDER (the ranker re-orders anyway).
    return rng.shuffle(out);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Strategy 3 — new product: build a balanced BOM from scratch.
  // ──────────────────────────────────────────────────────────────────────
  protected newProduct(req: GenerateRequest, rng: Rng, n: number): RawCandidate[] {
    const pool = req.material_pool ?? [];
    if (pool.length === 0) return [];
    const out: RawCandidate[] = [];
    for (let i = 0; i < n; i++) {
      const bom = this.buildSampledBom(pool, req.locked_materials ?? [], rng, /* costBias */ false);
      if (bom.length > 0) {
        out.push({ label: `new-${i + 1}`, bom, metadata: { strategy: 'new_product', sample: i } });
      }
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /** Build one BOM by sampling at most one material per role from the pool. */
  protected buildSampledBom(
    pool: MaterialPoolEntry[],
    locked: LockedMaterial[],
    rng: Rng,
    costBias: boolean
  ): BomItem[] {
    const byRole = new Map<string, MaterialPoolEntry[]>();
    for (const m of pool) {
      const key = m.role;
      const arr = byRole.get(key);
      if (arr) arr.push(m);
      else byRole.set(key, [m]);
    }

    // Honour locked materials first; their ratios are deducted from the
    // available budget and they cannot be swapped out by the role sampler.
    const items: BomItem[] = [];
    let used = 0;
    const lockedCodes = new Set<string>();
    for (const lk of locked) {
      lockedCodes.add(lk.material_code);
      const meta = pool.find((p) => p.material_code === lk.material_code);
      const ratio = lk.ratio ?? meta?.min_ratio ?? 0.05;
      if (used + ratio > 1) break;
      items.push({
        material_code: lk.material_code,
        material_name: lk.material_name ?? meta?.material_name ?? lk.material_code,
        role: lk.role ?? meta?.role ?? 'locked',
        ratio,
      });
      used += ratio;
    }

    // Sample one entry per role, weighted toward cheaper ones when costBias=true.
    const remainingRoles = [...byRole.keys()].filter(
      (role) => !items.some((it) => it.role === role)
    );

    for (const role of rng.shuffle(remainingRoles)) {
      const candidates = (byRole.get(role) ?? []).filter((m) => !lockedCodes.has(m.material_code));
      if (candidates.length === 0) continue;
      const picked = costBias ? this.weightedPick(candidates, rng) : rng.pick(candidates);
      const minR = picked.min_ratio ?? 0.02;
      const maxR = Math.min(picked.max_ratio ?? 0.7, 1 - used);
      if (maxR <= minR) continue;
      const ratio = round3(rng.nextFloat(minR, maxR));
      items.push({
        material_code: picked.material_code,
        material_name: picked.material_name,
        role: picked.role,
        ratio,
        ...(picked.supplier_code ? { supplier_code: picked.supplier_code } : {}),
      });
      used += ratio;
      if (used >= 0.99) break;
    }
    if (items.length === 0) return [];
    return this.normaliseRatios(items, locked);
  }

  /** Weight pool entries by inverse cost; cheaper materials are picked more often. */
  protected weightedPick(pool: MaterialPoolEntry[], rng: Rng): MaterialPoolEntry {
    const weights = pool.map((m) => {
      const c = m.unit_cost ?? 1;
      return c > 0 ? 1 / c : 1;
    });
    const total = weights.reduce((s, w) => s + w, 0) || 1;
    let r = rng.next() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i] as number;
      if (r <= 0) return pool[i] as MaterialPoolEntry;
    }
    return pool[pool.length - 1] as MaterialPoolEntry;
  }

  /**
   * Re-scale ratios so they sum to exactly 1.0, but never overwrite a locked
   * material's fixed ratio. We rescale only the "free" portion.
   */
  protected normaliseRatios(items: BomItem[], locked: LockedMaterial[]): BomItem[] {
    const lockedFixed = new Map<string, number>();
    for (const lk of locked) {
      if (lk.ratio !== undefined) lockedFixed.set(lk.material_code, lk.ratio);
    }

    const fixedSum = items
      .filter((it) => lockedFixed.has(it.material_code))
      .reduce((s, it) => s + (lockedFixed.get(it.material_code) ?? 0), 0);

    const free = items.filter((it) => !lockedFixed.has(it.material_code));
    const freeSum = free.reduce((s, it) => s + it.ratio, 0);

    const target = Math.max(1 - fixedSum, 0);
    const scale = freeSum > 0 ? target / freeSum : 0;

    return items.map((it) => {
      if (lockedFixed.has(it.material_code)) {
        return { ...it, ratio: round4(lockedFixed.get(it.material_code) ?? it.ratio) };
      }
      return { ...it, ratio: round4(it.ratio * scale) };
    });
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
