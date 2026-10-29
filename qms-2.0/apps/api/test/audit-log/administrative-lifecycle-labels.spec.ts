import { auditActionFilter, auditActionLabel } from '../../src/modules/audit-log/audit-event-read-model.js';

describe('administrative lifecycle audit labels', () => {
  it.each([
    ['ORGANIZATION_FORCE_DELETED', '强制删除组织'],
    ['DEPARTMENT_FORCE_DELETED', '强制删除部门/科室'],
    ['USER_FORCE_DELETED', '永久删除用户'],
    ['SUPPLIER_ACCOUNT_FORCE_DELETED', '永久删除供应商账号'],
    ['ORGANIZATION_RECONFIGURED', '补配组织'],
    ['DEPARTMENT_RECONFIGURED', '补配部门/科室'],
    ['POSITION_RECONFIGURED', '补配岗位'],
    ['USER_RECONFIGURED', '补配用户'],
    ['SUPPLIER_EIGHT_D_ADMINISTRATIVELY_INVALIDATED', '供应商8D管理配置失效'],
    ['SUPPLIER_EIGHT_D_DEADLINE_ADMINISTRATIVELY_CANCELLED', '供应商8D延期因管理配置失效取消'],
    ['WORKFLOW_ADMINISTRATIVELY_RETURNED', '流程因管理配置失效回到办理'],
    ['PROCESS_EIGHT_D_ADMINISTRATIVELY_INVALIDATED', '制程8D管理配置失效'],
    ['PROCESS_EIGHT_D_ADMINISTRATIVELY_RECONFIGURED', '补配制程8D失效职责'],
    ['CUSTOMER_EIGHT_D_ADMINISTRATIVELY_RECONFIGURED', '补配客户8D失效职责'],
    ['NEW_PRODUCT_EIGHT_D_ADMINISTRATIVELY_RECONFIGURED', '补配新品8D失效职责'],
    ['SUPPLIER_EIGHT_D_RECONFIGURED', '补配供应商8D失效职责'],
  ])('explains and searches %s without hiding the action code', (action, label) => {
    expect(auditActionLabel(action)).toBe(label);
    expect(JSON.stringify(auditActionFilter(label))).toContain(action);
  });
});
