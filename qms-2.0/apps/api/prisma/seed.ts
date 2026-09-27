import 'dotenv/config';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordHasherService } from '../src/common/security/password-hasher.service.js';

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for local seed');
  const url = new URL(databaseUrl);
  if (process.env.NODE_ENV !== 'development' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Demo seed requires NODE_ENV=development and a loopback PostgreSQL host');
  }
  const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
  const supplierPassword = process.env.QMS_SEED_SUPPLIER_PASSWORD;
  if (!internalPassword || !supplierPassword ||
      [internalPassword, supplierPassword].some((value) => value.length < 16 || value.startsWith('replace-'))) {
    throw new Error('Provide distinct local seed passwords of at least 16 characters through environment variables');
  }
  if (internalPassword === supplierPassword) throw new Error('Local seed passwords must be distinct');
  const hasher = new PasswordHasherService();
  const passwordHashes = await Promise.all([hasher.hash(internalPassword), hasher.hash(supplierPassword)]);
  const prisma = new PrismaService(databaseUrl);
  try {
    await prisma.$transaction(async (tx) => {
      for (const [index, type] of (['INTERNAL', 'SUPPLIER'] as const).entries()) {
        const organization = await tx.organization.upsert({
          where: { code: `LOCAL-${type}` }, update: {},
          create: { code: `LOCAL-${type}`, name: `本地演示 ${type}`, type },
        });
        const username = type === 'INTERNAL' ? 'local.internal' : 'local.supplier';
        const user = await tx.user.upsert({
          where: { organizationId_username: { organizationId: organization.id, username } },
          update: {},
          create: { organizationId: organization.id, username, passwordHash: passwordHashes[index]!, accountType: type },
        });
        const role = await tx.role.upsert({
          where: { organizationId_code: { organizationId: organization.id, code: 'LOCAL_MEMBER' } },
          update: {}, create: { organizationId: organization.id, code: 'LOCAL_MEMBER', name: '本地演示成员' },
        });
        const permissions = [
          ['workbench:read', '查看工作台'],
          ['organization:read', '查看组织'],
          ['system:permissions:read', '查看系统权限'],
          ['problem-index:read', '查看问题索引'],
          ['workflow:manage', '管理受控流程'],
          ['task:read', '查看授权任务'],
          ['task:claim', '领取和释放任务'],
          ['task:transfer', '批量转派任务'],
          ['notification:read', '查看和标记通知'],
          ['announcement:read', '查看公告'],
          ...(type === 'SUPPLIER' ? [
            ['supplier-admission:submissions:read', '查看本企业质量资料'],
            ['supplier-admission:submissions:write', '提交本企业质量资料'],
            ['supplier-performance:portal:cards:read', '查看本企业已发布绩效'],
            ['supplier-performance:portal:appeals:read', '查看本企业绩效申诉'],
            ['supplier-performance:portal:appeals:write', '提交本企业绩效申诉'],
          ] : []),
          ...(type === 'INTERNAL' ? [
            ['supplier-admission:documents:read', '查看供应商质量资料'],
            ['supplier-admission:documents:review', '审核供应商质量资料'],
            ['announcement:manage', '管理公告'],
            ['announcement:audit:read', '查看公告阅读审计'],
            ['organization:manage', '维护组织树和启停'],
            ['organization:structure:read', '查看部门岗位'],
            ['organization:structure:manage', '维护部门岗位'],
            ['organization:positions:assign', '分配用户任职'],
            ['audit:read', '查询管理审计'],
            ['audit:export', '导出管理审计'],
            ['configuration:read', '查看平台配置'],
            ['configuration:manage', '维护平台配置'],
            ['outbox:read', '查看失败事件'],
            ['outbox:retry', '重试失败事件'],
            ['account:users:read', '查看用户账号'],
            ['account:users:create', '创建用户账号'],
            ['account:users:update', '编辑用户邮箱'],
            ['account:users:status', '启用或停用用户'],
            ['account:users:transfer', '变更用户组织或账号类型'],
            ['account:users:reset', '签发密码重置凭证'],
            ['account:roles:read', '查看角色与权限'],
            ['account:roles:create', '创建或复制角色'],
            ['account:roles:update', '编辑角色与权限'],
            ['account:roles:delete', '删除角色'],
            ['account:roles:assign', '分配用户角色'],
            ['quality-data:metrics:read', '查看质量指标与趋势'],
            ['quality-data:metrics:write', '维护质量指标与事实'],
            ['customer-quality:complaints:read', '查看客户与客诉'],
            ['customer-quality:complaints:write', '维护客户与客诉'],
            ['audit-management:read', '查看审核管理'],
            ['audit-management:write', '维护审核管理'],
            ['workflow:start', '发起受控流程'],
            ['supplier-incoming:inspections:read', '查看来料检验'],
            ['supplier-incoming:inspections:write', '维护来料检验'],
            ['supplier-concession:requests:read', '查看特采申请'],
            ['supplier-concession:requests:write', '提交特采申请'],
            ['supplier-concession:requests:approve', '审批特采申请'],
            ['supplier-concession:requests:release', '登记特采放行'],
            ['supplier-performance:cards:read', '查看供应商绩效'],
            ['supplier-performance:cards:write', '维护供应商绩效'],
            ['supplier-performance:cards:publish', '发布供应商绩效'],
            ['supplier-performance:appeals:read', '查看供应商绩效申诉'],
            ['supplier-performance:appeals:write', '提交供应商绩效申诉'],
            ['supplier-performance:appeals:review', '复核供应商绩效申诉'],
            ['supplier-audit:plans:read', '查看供应商审核计划'],
            ['supplier-audit:plans:write', '维护供应商审核计划'],
            ['supplier-audit:records:read', '查看供应商审核记录'],
            ['supplier-audit:records:write', '维护供应商审核记录'],
            ['supplier-audit:records:close', '关闭供应商审核记录'],
            ['supplier-quality:targets:read', '查看供应商质量目标'],
            ['supplier-quality:targets:write', '维护供应商质量目标'],
            ['supplier-quality:targets:approve', '审批供应商质量目标'],
            ['supplier-quality:targets:publish', '发布供应商质量目标'],
            ['supplier-meetings:read', '查看供应商会议'],
            ['supplier-meetings:write', '维护供应商会议'],
            ['supplier-meetings:conclude', '完成供应商会议议题'],
            ['supplier-meetings:actions', '维护供应商会议行动项'],
            ['supplier-ppap:read', '查看供应商 PPAP'],
            ['supplier-ppap:write', '维护供应商 PPAP'],
            ['supplier-ppap:review', '审核供应商 PPAP'],
            ['supplier-inspection-standards:read', '查看供应商检验规范'],
            ['supplier-inspection-standards:write', '维护供应商检验规范'],
            ['supplier-inspection-standards:publish', '发布供应商检验规范'],
            ['supplier-barcode:read', '查看供应商条码规则'],
            ['supplier-barcode:write', '维护供应商条码规则'],
            ['supplier-barcode:publish', '发布供应商条码规则'],
            ['supplier-barcode:scan', '扫描供应商条码'],
            ['supplier-asn:read', '查看供应商 ASN'],
            ['supplier-asn:write', '维护供应商 ASN'],
            ['supplier-asn:submit', '提交供应商 ASN'],
            ['e-signature:signatures:read', '查看本人电子签名'],
            ['e-signature:signatures:write', '注册和撤销电子签名'],
            ['e-signature:approvals:read', '查看审批签章'],
            ['e-signature:approvals:sign', '引用电子签名完成审批签章'],
            ['coordinate-inspection:read', '查看三坐标检测申请'],
            ['coordinate-inspection:write', '维护三坐标检测申请'],
            ['coordinate-inspection:approve', '审批三坐标检测申请'],
            ['coordinate-inspection:schedule', '安排三坐标检测'],
          ] : []),
        ] as const;
        for (const [code, name] of permissions) {
          const permission = await tx.permission.upsert({
            where: { code }, update: {}, create: { code, name },
          });
          await tx.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
            update: {}, create: { roleId: role.id, permissionId: permission.id },
          });
        }
        const assignment = { userId: user.id, roleId: role.id, organizationId: organization.id };
        await tx.userRole.upsert({ where: { userId_roleId_organizationId: assignment }, update: {}, create: assignment });
      }
    });
    console.info('Local demo seed complete; existing accounts and passwords were preserved.');
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch(() => {
  console.error(process.env.DATABASE_URL
    ? 'Local seed failed. Check development mode, loopback PostgreSQL, distinct seed passwords, and deployed migrations.'
    : 'Local seed failed: DATABASE_URL is required.');
  process.exitCode = 1;
});
