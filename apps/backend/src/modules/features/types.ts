/**
 * Sample base table & feature foundation — shared types.
 *
 * Convention: features are computed PURE from a `FormulaVersionInputs`
 * snapshot. The DB lookups happen ONCE up front (Repository.fetchInputs)
 * so every extractor is unit-testable in isolation.
 */

export type FeatureValue = number | boolean | null;
export type FeatureMap = Record<string, FeatureValue>;
export type FeatureGroup =
  | 'structure'
  | 'weighted_property'
  | 'log_mix'
  | 'complexity'
  | 'cost'
  | 'functional'
  | 'target';

/** Item-level snapshot: one row per formula_items entry, joined to its material. */
export interface FormulaItemInput {
  formula_item_id: string;
  raw_material_id: string | null;
  product_id: string | null;
  sequence_no: number;
  step_no: number | null;
  phase: string | null;
  amount: number | null;
  percentage: number | null;
  unit_of_measure: string | null;
  role: string | null;
  is_optional: boolean;
  is_critical: boolean;
  unit_cost: number | null;
  total_cost: number | null;

  // Joined material properties (null when material is missing)
  material_code: string | null;
  material_name: string | null;
  material_density: number | null;
  material_molecular_weight: number | null;
  material_flash_point_c: number | null;
  material_viscosity_cst: number | null;
  material_ph: number | null;
  material_default_unit_cost: number | null;
  material_tags: string[];
  material_properties: Record<string, unknown>;
}

/** Formula-version-level snapshot. */
export interface FormulaVersionInputs {
  formula_version_id: string;
  formula_id: string;
  formula_code: string;
  formula_name: string;
  product_id: string | null;
  product_category_code: string | null;
  product_code: string | null;
  batch_size: number | null;
  batch_unit: string;
  cost_currency: string;
  items: FormulaItemInput[];
}

/** Output of one extractor — features it computed + any missing-input notes. */
export interface ExtractorOutput {
  features: FeatureMap;
  missing_inputs?: string[];
}

export interface Extractor {
  readonly group: FeatureGroup;
  readonly name: string;
  extract(inputs: FormulaVersionInputs): ExtractorOutput;
}

/** Achieved-metric averages over a formula_version's batches. */
export interface AchievedMetrics {
  // metric_code → { mean, std, count }
  [metric_code: string]: { mean: number; std: number; count: number };
}

/** Composition vector for inverse generator (raw_material_id → percentage). */
export type CompositionVector = Record<string, number>;

/** A whole computed feature record ready to persist. */
export interface FormulaVersionFeatureSet {
  formula_version_id: string;
  feature_set_version: string;
  features: FeatureMap;
  hot: {
    num_items: number | null;
    num_phases: number | null;
    num_active: number | null;
    total_active_pct: number | null;
    weighted_density: number | null;
    weighted_viscosity_log: number | null;
    blended_viscosity_cst: number | null;
    total_cost: number | null;
    cost_currency: string;
    complexity_entropy: number | null;
  };
  has_missing_inputs: boolean;
  missing_inputs: string[];
}

export interface FeatureGenerationRunSummary {
  run_id: string;
  trace_id: string;
  feature_set_version: string;
  status: 'succeeded' | 'partial' | 'failed';
  records_processed: number;
  records_generated: number;
  records_failed: number;
  records_skipped: number;
  duration_ms: number;
  error?: string;
}

/** Forward-model sample shape (X, y). */
export interface ForwardSample {
  formula_version_id: string;
  product_category_code: string | null;
  feature_set_version: string;
  features: FeatureMap;
  target_metrics: Record<string, number>;
  target_metric_codes: string[];
  is_outlier: boolean;
  is_complete: boolean;
  has_targets: boolean;
  weight: number;
  measured_at: string | null;
}

export interface InverseAnchor {
  formula_version_id: string;
  product_category_code: string | null;
  feature_set_version: string;
  features: FeatureMap;
  composition_vector: CompositionVector;
  achieved_metrics: AchievedMetrics;
  sample_size: number;
  cost_target: number | null;
  ingredient_constraints: Record<string, { min_pct: number; max_pct: number }> | null;
}
