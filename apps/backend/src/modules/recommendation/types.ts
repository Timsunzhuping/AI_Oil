/**
 * Reverse Recommendation Service — shared types.
 *
 * The "reverse" service answers: "given target performance + cost / inventory
 * / regulatory constraints, what BOMs can we propose?"  The pipeline is:
 *
 *     generator   → constraint filter → surrogate evaluator → ranker
 *
 * Each stage is its own class so they can be swapped independently (e.g.
 * replace the random-walk generator with a Bayesian optimizer, or the
 * mock surrogate with a real ML model) without touching the rest.
 */
import type { BomItem, PredictedMetric, RiskWarning } from '../prediction/types.js';

export type RecommendationStrategy = 'cost_priority' | 'material_replacement' | 'new_product';

export type RecommendationStatus = 'processing' | 'succeeded' | 'partial' | 'failed';

export type CandidateOrigin = 'generated' | 'recalculated' | 'replaced';

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

/** A single quantitative target the recommendation should aim at. */
export interface TargetMetric {
  name: string;
  /** Optional canonical display name for UI; defaults to `name`. */
  display_name?: string;
  /** Preferred target value (used for centring objectives). */
  target?: number;
  unit?: string;
  /** Hard lower / upper bound — values outside fail the constraint filter. */
  lower_bound?: number;
  upper_bound?: number;
  /** Importance weight in (0, 10]; defaults to 1.0 in the ranker. */
  weight?: number;
}

/** A material that the generator may pick from. */
export interface MaterialPoolEntry {
  material_code: string;
  material_name: string;
  /** Functional role: 'base_oil', 'vii', 'detergent', 'antioxidant', … */
  role: string;
  /** Optional unit cost (CNY/kg). */
  unit_cost?: number;
  /** Optional carbon intensity (kgCO₂e/kg). */
  carbon_per_kg?: number;
  /** Min ratio for this material when present in a candidate. */
  min_ratio?: number;
  /** Max ratio for this material when present in a candidate. */
  max_ratio?: number;
  /** Hard supplier / lot constraint — propagated to BOM line. */
  supplier_code?: string;
}

/** A material that must (or must not) appear in candidates. */
export interface LockedMaterial {
  material_code: string;
  material_name?: string;
  role?: string;
  /** When set, the locked material is fixed at this exact ratio. */
  ratio?: number;
}

export interface InventoryConstraint {
  material_code: string;
  /** Available stock in kg (or arbitrary unit; the filter compares by ratio × batch_size). */
  available_kg: number;
  /** Notional batch size used to convert ratio → kg (default 1000 kg). */
  batch_size_kg?: number;
}

export interface ProcessConstraints {
  /** Closed bound on blending temperature, ℃. */
  blending_temperature_c?: { min?: number; max?: number };
  blending_time_min?: { min?: number; max?: number };
  filtration_micron?: { max?: number };
  storage_max_temperature_c?: number;
  /** Free-form notes echoed back in the response. */
  notes?: string;
}

/** Defines how the engine should swap a material when strategy='material_replacement'. */
export interface ReplacementCandidate {
  /** Material currently in the seed/base BOM that we want to replace. */
  replace_material_code: string;
  /** Replacement material from the pool. */
  with_material_code: string;
  /** When provided, fix the replacement at this ratio; otherwise inherit. */
  fixed_ratio?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request DTOs
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  product_category: string;
  application_scene?: string;
  /** Auto-detected from inputs when omitted. */
  strategy?: RecommendationStrategy;
  target_metrics: TargetMetric[];
  cost_limit?: number;
  /** Reserved — not yet enforced by the filter, but persisted for replay. */
  carbon_limit?: number | null;
  inventory_constraints?: InventoryConstraint[];
  material_pool?: MaterialPoolEntry[];
  /** When strategy='material_replacement', the seed BOM to start from. */
  base_bom?: BomItem[];
  replacement_pool?: ReplacementCandidate[];
  locked_materials?: LockedMaterial[];
  process_constraints?: ProcessConstraints;
  /** Number of candidates to return; clamped to 1..10. */
  n_candidates?: number;
  /** Seed for reproducible runs; omit to auto-generate. */
  random_seed?: number;
  /** Optional title shown on the task. */
  title?: string;
}

export interface RecalculateRequest {
  task_id: string;
  candidate_id: string;
  /** Either a list of material→ratio overrides, or an entire replacement BOM. */
  modifications?: Array<{ material_code: string; new_ratio: number }>;
  full_bom?: BomItem[];
  /** Persist the result as a new candidate row (default true). */
  persist?: boolean;
}

export interface ReplaceMaterialRequest {
  task_id: string;
  candidate_id: string;
  swap: {
    from_material_code: string;
    to_material_code: string;
    /** Optional override; when absent, inherits the displaced material's ratio. */
    new_ratio?: number;
  };
  /** Persist the result as a new candidate row (default true). */
  persist?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface ConstraintMatch {
  /** Codes of constraints satisfied by this candidate. */
  passed: string[];
  /** Codes of constraints violated, with human-readable reason. */
  failed: Array<{ code: string; reason: string }>;
  /** Aggregate fraction in [0,1]; 1.0 = all constraints satisfied. */
  score: number;
}

export interface CandidateScoreBreakdown {
  /** Weighted-sum component (∈[0,1]) for hitting target metric windows. */
  target_score: number;
  /** Cost-vs-limit component (∈[0,1]). */
  cost_score: number;
  /** Average prediction confidence (∈[0,1]). */
  confidence_score: number;
  /** Constraint compliance share (∈[0,1]). */
  constraint_score: number;
  /** Penalty deducted for risk warnings. */
  risk_penalty: number;
}

export interface CandidateResult {
  id: string;
  task_id: string;
  rank: number;
  name: string;
  headline: string;
  origin: CandidateOrigin;
  parent_candidate_id?: string | null;
  bom: BomItem[];
  predicted_metrics: PredictedMetric[];
  estimated_cost: number | null;
  cost_unit: string;
  carbon_estimate: number | null;
  risk_warnings: RiskWarning[];
  constraint_match: ConstraintMatch;
  composite_score: number;
  score_breakdown: CandidateScoreBreakdown;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RecommendationTaskSummary {
  generated: number;
  passed_filters: number;
  evaluated: number;
  ranked: number;
}

export interface RecommendationTaskRow {
  id: string;
  code: string;
  product_category: string;
  application_scene: string | null;
  strategy: RecommendationStrategy;
  target_metrics: TargetMetric[];
  cost_limit: number | null;
  carbon_limit: number | null;
  inventory_constraints: InventoryConstraint[];
  material_pool: MaterialPoolEntry[];
  replacement_pool: ReplacementCandidate[];
  locked_materials: LockedMaterial[];
  process_constraints: ProcessConstraints;
  n_candidates: number;
  random_seed: number;
  model_code: string;
  model_version: string;
  predictor_mode: 'mock' | 'real';
  status: RecommendationStatus;
  error_class: string | null;
  error_message: string | null;
  duration_ms: number;
  summary: RecommendationTaskSummary;
  trace_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface GenerateResponse {
  task: RecommendationTaskRow;
  candidates: CandidateResult[];
  random_seed: number;
  model_version: string;
  model_code: string;
  predictor_mode: 'mock' | 'real';
  trace_id: string;
  duration_ms: number;
}

export interface RecalculateResponse {
  task_id: string;
  base_candidate_id: string;
  candidate: CandidateResult;
  trace_id: string;
  duration_ms: number;
}

export interface HistoryResponse {
  task: RecommendationTaskRow;
  candidates: CandidateResult[];
}
