import { describe, it, expect } from 'vitest';
import {
  CreateAutoFinetuneTriggerSchema,
  CreateDatasetSchema,
  CreateFeatureTemplateSchema,
  CreateModelSchema,
  CreateTrainingJobSchema,
  ManualRetrainSchema,
  ReleaseSchema,
  RollbackSchema,
} from '../../../src/modules/ml/schemas.js';

describe('CreateDatasetSchema', () => {
  it('requires name + storage_url', () => {
    expect(CreateDatasetSchema.safeParse({}).success).toBe(false);
    expect(CreateDatasetSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(CreateDatasetSchema.safeParse({ name: 'x', storage_url: 's3://b/k' }).success).toBe(
      true
    );
  });
});

describe('CreateFeatureTemplateSchema', () => {
  it('rejects unknown task_type', () => {
    expect(
      CreateFeatureTemplateSchema.safeParse({ name: 'a', task_type: 'banana', spec: {} }).success
    ).toBe(false);
  });
});

describe('CreateModelSchema', () => {
  it('accepts a typical payload', () => {
    expect(
      CreateModelSchema.safeParse({ name: 'kv-regressor', task_type: 'regression' }).success
    ).toBe(true);
  });
});

describe('CreateTrainingJobSchema', () => {
  it('accepts an empty body (all fields optional)', () => {
    expect(CreateTrainingJobSchema.safeParse({}).success).toBe(true);
  });
  it('rejects out-of-range max_epochs', () => {
    expect(CreateTrainingJobSchema.safeParse({ config: { max_epochs: 0 } }).success).toBe(false);
    expect(CreateTrainingJobSchema.safeParse({ config: { max_epochs: 5000 } }).success).toBe(false);
  });
});

describe('ReleaseSchema', () => {
  it('requires version_id', () => {
    expect(ReleaseSchema.safeParse({}).success).toBe(false);
  });
  it('accepts guardrails', () => {
    const r = ReleaseSchema.safeParse({
      version_id: '00000000-0000-0000-0000-000000000001',
      guardrails: [{ metric: 'r2', comparator: 'gte', threshold: 0.8 }],
    });
    expect(r.success).toBe(true);
  });
});

describe('RollbackSchema', () => {
  it('accepts an empty body', () => {
    expect(RollbackSchema.safeParse({}).success).toBe(true);
  });
});

describe('CreateAutoFinetuneTriggerSchema', () => {
  it('requires model_id and condition', () => {
    expect(CreateAutoFinetuneTriggerSchema.safeParse({}).success).toBe(false);
    expect(
      CreateAutoFinetuneTriggerSchema.safeParse({
        model_id: '00000000-0000-0000-0000-000000000001',
        condition: { type: 'drift', metric: 'psi', threshold: 0.2 },
      }).success
    ).toBe(true);
  });
});

describe('ManualRetrainSchema', () => {
  it('requires model_id + dataset_id', () => {
    expect(ManualRetrainSchema.safeParse({}).success).toBe(false);
    expect(
      ManualRetrainSchema.safeParse({
        model_id: '00000000-0000-0000-0000-000000000001',
        dataset_id: '00000000-0000-0000-0000-000000000002',
      }).success
    ).toBe(true);
  });
});
