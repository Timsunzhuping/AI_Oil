import { describe, it, expect } from 'vitest';
import {
  AssignRolesSchema,
  CreateModelAssetSchema,
  ExportApprovalSchema,
  ExportRequestSchema,
  LoginSchema,
} from '../../../src/modules/security/schemas.js';

describe('LoginSchema', () => {
  it('accepts username + password', () => {
    expect(LoginSchema.safeParse({ username: 'alice', password: 'p' }).success).toBe(true);
  });
  it('accepts sso_token only', () => {
    expect(LoginSchema.safeParse({ sso_token: 'sso:alice@example.com' }).success).toBe(true);
  });
  it('rejects no credentials', () => {
    expect(LoginSchema.safeParse({}).success).toBe(false);
  });
  it('rejects both password and sso_token', () => {
    expect(
      LoginSchema.safeParse({ username: 'a', password: 'p', sso_token: 'sso:x@y.com' }).success
    ).toBe(false);
  });
});

describe('ExportRequestSchema', () => {
  it('requires resource_type + format', () => {
    expect(ExportRequestSchema.safeParse({}).success).toBe(false);
  });
  it('rejects unknown format', () => {
    expect(
      ExportRequestSchema.safeParse({ resource_type: 'formula', format: 'docx' }).success
    ).toBe(false);
  });
  it('accepts a typical body', () => {
    expect(
      ExportRequestSchema.safeParse({
        resource_type: 'formula',
        format: 'pdf',
        classification: 'confidential',
        reason: 'cross-team review',
      }).success
    ).toBe(true);
  });
});

describe('ExportApprovalSchema', () => {
  it('requires `approve` boolean', () => {
    expect(ExportApprovalSchema.safeParse({}).success).toBe(false);
  });
  it('clamps output_expires_in_minutes', () => {
    expect(
      ExportApprovalSchema.safeParse({ approve: true, output_expires_in_minutes: 0 }).success
    ).toBe(false);
    expect(
      ExportApprovalSchema.safeParse({ approve: true, output_expires_in_minutes: 60 }).success
    ).toBe(true);
  });
});

describe('AssignRolesSchema', () => {
  it('rejects unknown role codes', () => {
    expect(
      AssignRolesSchema.safeParse({
        user_id: '00000000-0000-0000-0000-000000000001',
        role_codes: ['banana'],
      }).success
    ).toBe(false);
  });
  it('accepts known roles', () => {
    expect(
      AssignRolesSchema.safeParse({
        user_id: '00000000-0000-0000-0000-000000000001',
        role_codes: ['researcher', 'viewer'],
      }).success
    ).toBe(true);
  });
});

describe('CreateModelAssetSchema', () => {
  it('requires name + asset_type + storage_url', () => {
    expect(CreateModelAssetSchema.safeParse({}).success).toBe(false);
    expect(
      CreateModelAssetSchema.safeParse({
        name: 'x',
        asset_type: 'model_artifact',
        storage_url: 's3://b/k',
      }).success
    ).toBe(true);
  });
  it('rejects unknown classification', () => {
    expect(
      CreateModelAssetSchema.safeParse({
        name: 'x',
        asset_type: 'model_artifact',
        storage_url: 's3://b/k',
        classification: 'banana',
      }).success
    ).toBe(false);
  });
});
