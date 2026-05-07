/**
 * Menu catalogue.
 *
 * The frontend asks `GET /security/me` and uses the returned `menu` array
 * to decide which sidebar entries to render. Each entry lists the
 * permissions it requires; if ANY are missing, the entry is `visible: false`
 * and the UI hides it. This is `menu-level auth`.
 *
 * Action-level auth lives in middleware (`requirePermission`) — it's the
 * server's authoritative check; the menu is only a UX hint.
 */
import type { MenuEntry, PermissionCode, RoleCode } from './types.js';

interface MenuTemplate {
  key: string;
  label: string;
  route: string;
  required_permissions: PermissionCode[];
  required_roles?: RoleCode[];
}

const TEMPLATE: MenuTemplate[] = [
  { key: 'dashboard', label: '工作台首页', route: '/', required_permissions: ['task:read'] },
  { key: 'tasks', label: '研发任务', route: '/tasks', required_permissions: ['task:read'] },
  {
    key: 'tasks_new',
    label: '新建任务',
    route: '/tasks/new',
    required_permissions: ['task:write'],
  },
  {
    key: 'predict',
    label: '正向预测',
    route: '/predict',
    required_permissions: ['predict:execute'],
  },
  {
    key: 'recommend',
    label: '逆向推荐',
    route: '/recommend',
    required_permissions: ['recommend:execute'],
  },
  {
    key: 'comparison',
    label: '方案对比',
    route: '/comparison',
    required_permissions: ['formula:read'],
  },
  { key: 'diff', label: '版本 Diff', route: '/diff', required_permissions: ['formula:read'] },
  { key: 'history', label: '历史记录', route: '/history', required_permissions: ['task:read'] },
  {
    key: 'knowledge',
    label: '知识库',
    route: '/knowledge',
    required_permissions: ['knowledge:read'],
  },
  {
    key: 'documents',
    label: '文档中心',
    route: '/docs',
    required_permissions: ['document:upload'],
  },
  { key: 'qa', label: '智能问答', route: '/qa', required_permissions: ['qa:ask'] },
  { key: 'erp_sap', label: 'SAP 同步', route: '/erp/sap', required_permissions: ['erp:sap_sync'] },
  {
    key: 'erp_lims',
    label: 'LIMS 任务',
    route: '/erp/lims',
    required_permissions: ['erp:lims_create'],
  },
  {
    key: 'erp_carbon',
    label: '碳足迹',
    route: '/erp/carbon',
    required_permissions: ['erp:carbon_lookup'],
  },
  {
    key: 'ml_datasets',
    label: '数据集',
    route: '/ml/datasets',
    required_permissions: ['ml:dataset_manage'],
  },
  { key: 'ml_jobs', label: '训练任务', route: '/ml/jobs', required_permissions: ['ml:train'] },
  {
    key: 'ml_models',
    label: '模型注册表',
    route: '/ml/models',
    required_permissions: ['ml:model_read'],
  },
  {
    key: 'ml_release',
    label: '模型发布',
    route: '/ml/release',
    required_permissions: ['ml:release'],
  },
  { key: 'assets', label: '模型资产', route: '/assets', required_permissions: ['asset:read'] },
  {
    key: 'exports',
    label: '导出审批',
    route: '/exports',
    required_permissions: ['export:approve'],
  },
  { key: 'audit', label: '审计日志', route: '/audit', required_permissions: ['audit:read'] },
  {
    key: 'admin_users',
    label: '用户管理',
    route: '/admin/users',
    required_permissions: ['user:manage'],
  },
  {
    key: 'admin_roles',
    label: '角色管理',
    route: '/admin/roles',
    required_permissions: ['role:manage'],
  },
];

export function buildMenu(
  grantedPermissions: ReadonlySet<string>,
  roles: ReadonlySet<string>
): MenuEntry[] {
  return TEMPLATE.map((entry) => {
    const permsOk = entry.required_permissions.every((p) => grantedPermissions.has(p));
    const rolesOk = !entry.required_roles || entry.required_roles.some((r) => roles.has(r));
    return {
      key: entry.key,
      label: entry.label,
      route: entry.route,
      required_permissions: entry.required_permissions,
      ...(entry.required_roles ? { required_roles: entry.required_roles } : {}),
      visible: permsOk && rolesOk,
    };
  });
}
