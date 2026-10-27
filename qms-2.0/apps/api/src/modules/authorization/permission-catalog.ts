export const PLATFORM_ADMINISTRATOR_PERMISSION = 'platform:admin';
export const PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES = ['organization:read', 'organization:manage', 'audit:read', 'audit:export'];

export const ADMIN_PERMISSIONS = [
  'configuration:read', 'configuration:manage', 'audit:export',
  'outbox:read', 'outbox:retry',
  'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign', 'audit:read',
  'account:users:read', 'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset',
  'account:roles:read', 'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign',
];

type Operation = { code: string; name: string; enforcement: 'guarded' | 'reserved' };
type Module = { key: string; name: string; status: 'active' | 'planned'; operations: Operation[] };
type Group = { key: string; name: string; status: 'active' | 'planned'; modules: Module[] };
const operation = (code: string, name: string, enforcement: Operation['enforcement'] = 'guarded'): Operation => ({ code, name, enforcement });
const planned = (key: string, name: string, names: string[]): Group => ({ key, name, status: 'planned', modules: names.map((moduleName, index) => ({ key: `${key}-${index + 1}`, name: moduleName, status: 'planned', operations: [] })) });

export const PERMISSION_CATALOG: Group[] = [
  { key: 'platform', name: '平台功能', status: 'active', modules: [
    { key: 'workbench', name: '工作台', status: 'active', operations: [operation('workbench:read', '查看工作台（预留标识）', 'reserved')] },
    { key: 'problem-index', name: '问题查询', status: 'active', operations: [operation('problem-index:read', '查看问题索引')] },
    { key: 'tasks', name: '我的任务', status: 'active', operations: [operation('task:read', '查看授权任务'), operation('task:claim', '领取和释放任务'), operation('task:transfer', '批量转派任务')] },
    { key: 'notifications', name: '我的通知', status: 'active', operations: [operation('notification:read', '查看和标记通知')] },
    { key: 'announcements', name: '公告管理', status: 'active', operations: [operation('announcement:read', '查看公告'), operation('announcement:manage', '管理公告'), operation('announcement:audit:read', '查看公告阅读审计')] },
    { key: 'material-master', name: '物料主数据', status: 'active', operations: [operation('material-master:read', '查看物料清单'), operation('material-master:write', '维护物料编码和名称'), operation('material-master:import', '批量新增物料')] },
    { key: 'component-project', name: '组件项目映射', status: 'active', operations: [operation('component-project:read', '查看组件项目映射'), operation('component-project:manage', '维护组件项目映射及项目状态')] },
    { key: 'workflow', name: '受控流程', status: 'active', operations: [operation('workflow:manage', '管理（创建、编辑、校验、发布、复制）'), operation('workflow:start', '启动流程'), operation('workflow:act', '执行被授权的流程节点')] },
  ] },
  { key: 'supplier', name: '供应商质量', status: 'active', modules: [
    { key: 'supplier-profiles', name: '供应商资料', status: 'active', operations: [operation('supplier-quality:profiles:read', '查看业务资料'), operation('supplier-quality:profiles:write', '维护业务资料')] },
    { key: 'supplier-problems', name: '供应商问题', status: 'active', operations: [operation('supplier-quality:problems:read', '查看问题'), operation('supplier-quality:problems:write', '维护问题草稿')] },
    { key: 'supplier-responses', name: '整改回复', status: 'active', operations: [operation('supplier-quality:responses:read', '查看本企业问题'), operation('supplier-quality:responses:write', '保存回复草稿')] },
    { key: 'supplier-incoming', name: '来料检验', status: 'active', operations: [operation('supplier-incoming:inspections:read', '查看来料检验'), operation('supplier-incoming:inspections:write', '维护来料检验')] },
    { key: 'supplier-admission', name: '供应商质量资料', status: 'active', operations: [operation('supplier-admission:documents:read', '查看供应商质量资料'), operation('supplier-admission:documents:review', '审核供应商质量资料'), operation('supplier-admission:submissions:read', '查看本企业质量资料'), operation('supplier-admission:submissions:write', '提交本企业质量资料')] },
    { key: 'supplier-concession', name: '特采管理', status: 'active', operations: [operation('supplier-concession:requests:read', '查看特采申请'), operation('supplier-concession:requests:write', '提交特采申请'), operation('supplier-concession:requests:approve', '审批特采申请'), operation('supplier-concession:requests:release', '登记特采放行')] },
    { key: 'supplier-performance', name: '供应商绩效', status: 'active', operations: [operation('supplier-performance:cards:read', '查看供应商绩效'), operation('supplier-performance:cards:write', '维护供应商绩效'), operation('supplier-performance:cards:publish', '发布供应商绩效'), operation('supplier-performance:appeals:read', '查看供应商绩效申诉'), operation('supplier-performance:appeals:write', '提交供应商绩效申诉'), operation('supplier-performance:appeals:review', '复核供应商绩效申诉'), operation('supplier-performance:portal:cards:read', '查看本企业已发布绩效'), operation('supplier-performance:portal:appeals:read', '查看本企业绩效申诉'), operation('supplier-performance:portal:appeals:write', '提交本企业绩效申诉')] },
    { key: 'supplier-audit', name: '供应商审核', status: 'active', operations: [operation('supplier-audit:plans:read', '查看供应商审核计划'), operation('supplier-audit:plans:write', '维护供应商审核计划'), operation('supplier-audit:records:read', '查看供应商审核记录'), operation('supplier-audit:records:write', '维护供应商审核记录'), operation('supplier-audit:records:close', '关闭供应商审核记录')] },
    { key: 'supplier-targets', name: '供应商质量目标', status: 'active', operations: [operation('supplier-quality:targets:read', '查看供应商质量目标'), operation('supplier-quality:targets:write', '维护供应商质量目标'), operation('supplier-quality:targets:approve', '审批供应商质量目标'), operation('supplier-quality:targets:publish', '发布供应商质量目标')] },
    { key: 'supplier-meetings', name: '供应商会议', status: 'active', operations: [operation('supplier-meetings:read', '查看供应商会议'), operation('supplier-meetings:write', '维护供应商会议'), operation('supplier-meetings:conclude', '完成供应商会议议题'), operation('supplier-meetings:actions', '维护供应商会议行动项')] },
    { key: 'supplier-4', name: 'PPAP', status: 'active', operations: [operation('supplier-ppap:read', '查看供应商 PPAP'), operation('supplier-ppap:write', '维护供应商 PPAP'), operation('supplier-ppap:review', '审核供应商 PPAP')] },
    { key: 'supplier-inspection-standards', name: '供应商检验规范', status: 'active', operations: [operation('supplier-inspection-standards:read', '查看供应商检验规范'), operation('supplier-inspection-standards:write', '维护供应商检验规范'), operation('supplier-inspection-standards:publish', '发布供应商检验规范')] },
    { key: 'supplier-barcode', name: '供应商条码', status: 'active', operations: [operation('supplier-barcode:read', '查看供应商条码规则'), operation('supplier-barcode:write', '维护供应商条码规则'), operation('supplier-barcode:publish', '发布供应商条码规则'), operation('supplier-barcode:scan', '扫描供应商条码')] },
    { key: 'supplier-asn', name: '供应商 ASN', status: 'active', operations: [operation('supplier-asn:read', '查看供应商 ASN'), operation('supplier-asn:write', '维护供应商 ASN'), operation('supplier-asn:submit', '提交供应商 ASN')] },
    { key: 'supplier-portal', name: '供应商门户扩展', status: 'planned', operations: [] },
    { key: 'supplier-pcn', name: '供应商 PCN', status: 'active', operations: [operation('supplier-pcn:requests:read', '查看供应商 PCN'), operation('supplier-pcn:requests:approve', '审批供应商 PCN'), operation('supplier-pcn:submissions:read', '查看本企业 PCN'), operation('supplier-pcn:submissions:write', '提交本企业 PCN')] },
  ] },
  { key: 'process', name: '制程质量', status: 'active', modules: [
    { key: 'process-defects', name: '制程不良品台账', status: 'active', operations: [
      operation('process-quality:defects:read', '查看制程不良品台账'),
      operation('process-quality:defects:write', '维护制程不良品台账'),
      operation('process-quality:defects:close', '关闭及恢复制程台账'),
      operation('process-quality:materials:review', '复核本人负责的物料不良'),
    ] },
    { key: 'process-issues', name: '制程问题管理', status: 'active', operations: [
      operation('process-quality:issues:read', '查看制程8D及报告'),
      operation('process-quality:issues:report', '导出有权读取的制程8D报告'),
      operation('process-quality:issues:issue', '发起制程8D'),
      operation('process-quality:issues:work', '办理本人负责或协作的制程8D'),
      operation('process-quality:issues:sources', '调整制程8D来源范围'),
      operation('process-quality:issues:risk', '调整制程8D风险'),
      operation('process-quality:issues:reassign', '撤回重派制程8D责任范围'),
      operation('process-quality:issues:deadlines', '设置制程8D质量侧期限'),
    ] },
  ] },
  { key: 'customer', name: '客户质量', status: 'active', modules: [
    { key: 'customer-complaints', name: '客户客诉台账', status: 'active', operations: [
      operation('customer-quality:complaints:read', '查看客户客诉台账'),
      operation('customer-quality:complaints:write', '维护客户客诉台账'),
      operation('customer-quality:complaints:close', '关闭及恢复本人跟进的客诉台账'),
      operation('customer-quality:complaints:closed-edit', '补充已关闭客诉资料'),
        operation('customer-quality:complaints:reassign', '人工交接任职已失效的客诉跟进人'),
      operation('customer-quality:analyses:fae', '办理本人负责的客诉功能解析'),
      operation('customer-quality:analyses:supplier', '办理本人负责的客诉供应商分析'),
    ] },
    { key: 'customer-issues', name: '客户问题管理', status: 'active', operations: [
      operation('customer-quality:issues:read', '查看客户8D及报告'),
      operation('customer-quality:issues:report', '导出有权读取的客户8D报告'),
      operation('customer-quality:issues:issue', '发起客户8D'),
      operation('customer-quality:issues:work', '办理本人负责或协作的客户8D'),
      operation('customer-quality:issues:sources', '调整客户8D来源范围'),
      operation('customer-quality:issues:risk', '调整客户8D风险'),
      operation('customer-quality:issues:reassign', '撤回重派客户8D责任范围'),
      operation('customer-quality:issues:deadlines', '设置客户8D质量侧期限'),
    ] },
  ] },
  { key: 'new-product', name: '新品质量', status: 'active', modules: [
    { key: 'new-product-quality', name: '新品质量管理', status: 'active', operations: [
      operation('new-product-quality:projects:read', '查看新品质量项目'),
      operation('new-product-quality:projects:write', '维护新品质量项目'),
    ] },
    { key: 'new-product-early-flow', name: '试产与初期流动', status: 'planned', operations: [] },
    { key: 'new-product-issues', name: '新品问题管理', status: 'active', operations: [
      operation('new-product-quality:issues:read', '查看新品8D及报告'),
      operation('new-product-quality:issues:report', '导出有权读取的新品8D报告'),
      operation('new-product-quality:issues:issue', '发起新品8D'),
      operation('new-product-quality:issues:work', '办理本人负责或协作的新品8D'),
      operation('new-product-quality:issues:sources', '调整新品8D来源范围'),
      operation('new-product-quality:issues:risk', '调整新品8D风险'),
      operation('new-product-quality:issues:reassign', '撤回重派新品8D责任范围'),
      operation('new-product-quality:issues:deadlines', '设置新品8D质量侧期限'),
    ] },
  ] },
  { key: 'audit', name: '审核管理', status: 'active', modules: [
    { key: 'audit-core', name: '审核计划与整改', status: 'active', operations: [
      operation('audit-management:read', '查看审核管理'),
      operation('audit-management:write', '维护审核管理'),
    ] },
    { key: 'audit-issues', name: '审核问题发单', status: 'planned', operations: [] },
  ] },
  { key: 'quality-data', name: '质量数据', status: 'planned', modules: [
    { key: 'quality-metrics', name: '质量指标与趋势', status: 'planned', operations: [
      operation('quality-data:metrics:read', '查看质量指标与趋势'),
      operation('quality-data:metrics:write', '维护质量指标与事实'),
    ] },
  ] },
  { key: 'coordinate-inspection', name: '三坐标检测', status: 'active', modules: [
    { key: 'coordinate-requests', name: '检测申请', status: 'active', operations: [
      operation('coordinate-inspection:read', '查看三坐标检测申请'),
      operation('coordinate-inspection:write', '维护三坐标检测申请'),
      operation('coordinate-inspection:approve', '审批三坐标检测申请'),
      operation('coordinate-inspection:schedule', '安排三坐标检测'),
    ] },
  ] },
  { key: 'e-signature', name: '电子签名', status: 'active', modules: [
    { key: 'e-signature-core', name: '电子签名与审批签章', status: 'active', operations: [
      operation('e-signature:signatures:read', '查看本人电子签名'),
      operation('e-signature:signatures:write', '注册和撤销电子签名'),
      operation('e-signature:approvals:read', '查看审批签章'),
      operation('e-signature:approvals:sign', '引用电子签名完成审批签章'),
    ] },
  ] },
  { key: 'system', name: '系统管理', status: 'active', modules: [
    { key: 'platform-administrator', name: '平台管理员', status: 'active', operations: [operation(PLATFORM_ADMINISTRATOR_PERMISSION, '平台管理员（全部活跃内部组织的适用权限，须显式授予）')] },
    { key: 'organization', name: '组织目录', status: 'active', operations: [operation('organization:read', '查看组织'), operation('organization:manage', '维护组织树和启停'), operation('organization:structure:read', '查看部门岗位'), operation('organization:structure:manage', '维护部门岗位'), operation('organization:positions:assign', '分配用户任职')] },
    { key: 'management-audit', name: '管理审计', status: 'active', operations: [operation('audit:read', '查询管理审计'), operation('audit:export', '导出管理审计')] },
    { key: 'platform-configuration', name: '平台配置', status: 'active', operations: [operation('configuration:read', '查看配置字典和通知规则'), operation('configuration:manage', '维护配置字典和通知规则')] },
    { key: 'outbox-operations', name: '通知运行监控', status: 'active', operations: [operation('outbox:read', '查看失败事件'), operation('outbox:retry', '重试失败事件')] },
    { key: 'permission-context', name: '当前权限上下文', status: 'active', operations: [operation('system:permissions:read', '查看当前权限')] },
    { key: 'users', name: '用户管理', status: 'active', operations: [
      operation('account:users:read', '查看用户'), operation('account:users:create', '创建用户'), operation('account:users:update', '编辑姓名、电话和邮箱'),
      operation('account:users:status', '启用 / 停用'), operation('account:users:transfer', '变更组织 / 账号类型'), operation('account:users:reset', '重置凭证'),
    ] },
    { key: 'roles', name: '角色管理', status: 'active', operations: [
      operation('account:roles:read', '查看角色'), operation('account:roles:create', '创建 / 复制'), operation('account:roles:update', '编辑角色 / 权限'),
      operation('account:roles:delete', '删除角色'), operation('account:roles:assign', '分配角色'),
    ] },
  ] },
];

export const ACTIVE_PERMISSION_CODES = PERMISSION_CATALOG.flatMap((group) => group.modules.flatMap((module) => module.operations.map((entry) => entry.code)));

const SUPPLIER_ONLY_PERMISSION_CODES = new Set([
  'supplier-quality:responses:read', 'supplier-quality:responses:write',
  'supplier-admission:submissions:read', 'supplier-admission:submissions:write',
  'supplier-performance:portal:cards:read', 'supplier-performance:portal:appeals:read', 'supplier-performance:portal:appeals:write',
  'supplier-pcn:submissions:read', 'supplier-pcn:submissions:write',
]);

export const INTERNAL_PLATFORM_PERMISSION_CODES = PERMISSION_CATALOG
  .filter(group => group.status === 'active')
  .flatMap(group => group.modules.filter(module => module.status === 'active')
    .flatMap(module => module.operations.filter(entry => entry.enforcement === 'guarded' && !SUPPLIER_ONLY_PERMISSION_CODES.has(entry.code)).map(entry => entry.code)));

export function userUpdatePermissions(fields: object): string[] {
  const submitted = fields as Record<string, unknown>;
  const permissions: string[] = [];
  if (submitted.email !== undefined || submitted.fullName !== undefined || submitted.phone !== undefined) permissions.push('account:users:update');
  if (submitted.status !== undefined) permissions.push('account:users:status');
  if (submitted.organizationId !== undefined || submitted.accountType !== undefined) permissions.push('account:users:transfer');
  return permissions.length ? permissions : ['account:users:update'];
}
