# QMS F1/F2/F3/G 基础数据与接收预留实施计划

> 执行代理依项目 `qms-superpowers-zh` 使用独立实现上下文、TDD、规格/质量审查和主代理验证。F 是前期同一业务范围下的三个交付子单元；G 为纯预留文档任务。

**目标：** 供应商/客户/物料后台可维护和批量新增；供应商档案不要求先建企业组织，人员账号由管理员按需创建；一期外部对接只做预留。

**架构：** 复用供应商、客户领域事实服务，物料只建立两业务字段的独立小模块；UI 共用安全 Excel 读取与结果表，专业字段校验分别拥有。供应商隔离关系在开通协作时显式绑定，旧历史绑定不改写。

**技术栈：** Nest/Prisma/PostgreSQL、现有事务审计与幂等、React/Ant Design、ExcelJS、生成 contracts。

## 当前摘要（2026-10-18，F3 与 F1 接续）

- 负责人明确剩余 P0/P1 推进至合并上线；浏览器全部部署后人工确认，不重复创建事项、不自动关闭 Issue 或写飞书。F2 已部署；F3 复用 Issue #27 / V0.0.14，F1 复用 #25 / V0.0.12，PR 与部署结果逐快照核验。
- F3 实现上下文 `prepare_f3_material`，API/Web 新目录及授权组织切换保护；主代理统一 schema/迁移、权限目录/初始受控授权、模块、平台入口、契约、错误和语言。仅编码/名称，组织内区分大小写并保留前导零；独立 read/write/import，不给供应商默认授予。
- F3 真实 PG 9 项 PASS，含实际迁移授权 SQL、内部组织范围和 413 边界；Web 14 项 PASS，含英文、业务非法行部分提交、数字编码提示、CAS 重载失败保稿、组织切换确认及当前授权清单导出。规格发现三项错误恢复/部分提交缺陷后已返修，最终两轴复审及 CI 按冻结快照接续。
- F1 分 API 核心和消费者上下文实施。主代理已在独立一次性库 `qms_p0p1_f1_20261018` / 55517 应用 nullable 企业与 12 处强 owner/profile FK；新/旧业务、账号与升级兼容门禁仍待完成，不把迁移成功等同完整交付。
- 共享隔离：F3 的 schema/注册/契约单独保存并暂存；F1 并行修改未暂存，不混入 F3 PR。F1 独立库与 F3 原一次性库分离，均不连接 55440。共享文档及 Git 主代理串行整理。
- G 已有专项规格的三对象事实拥有者/未来资料表、认证与幂等/冲突位置和未启用边界；本轮不增加 HTTP 接收路由、同步 Worker、机器凭据或空监控。G 仅预留文档，不是外部联调通过。
- F1 当前证据：真实旧链 99 条迁移→12 域/附件/通知/工作流历史→实际增量升级及约束 29 项通过；冻结全供应商 fresh 库 24 套 193 项通过。账号新建后真实首登改密、回复 SUBMIT 和企业隔离已覆盖；列表 target 锁等待后 owner/target 撤权两条确定性红绿已修。API 两轴复审通过，Web 失权密码清理、StrictMode 和英文恢复正在返修，最终以新门禁/CI 为准。
- 最终 F1 本地：API 与 Web 两轴返修复审均通过；主代理新 master/workflow/consumer/upgrade 四套 58 项、API 全量单测 531 项、Web lint/build、API build、契约、治理/归档/Compose 均通过。Web 面板聚合的两个默认超时保留，受影响单项默认复验通过，完整新快照交 PR CI，不放宽全局超时或跳过。迁移前强制本机加密数据库检查点已以一次性真实 PG18 恢复验证，非异地/对象/WAL 灾备；实际生产执行仍待部署日志核对。
- F2 完整性补缺复用 Issue #26 / `V0.0.13-fix6`：四个客户 Web 文件补当前授权两字段清单导出、业务非法行服务端逐行处理，普通空/超长不阻合法行，安全结构/公式仍整批拒绝，数字编码不猜前导零。规格发现原不传权限 props 入口失败重试后权限不恢复，补红绿后动态刷新清单和权限同组双成功才恢复；两轴复审 PASS。主代理无筛选两文件 21/21 PASS（`f2-fix6-root-web-verified.log`），包含原客户关联/CAS/迟到响应；仅 Mock Web 证据，不冒充真实 PG。基于 F1 提交候选独立分支准备，待前置实际部署后再按 main 基线提 PR，不把功能分支间合并当上线。

## 历史摘要和实现取舍

2026-10-17，Asia/Taipei：F1/F2/F3/G 均为计划，真实对象/版本和授权见[总计划](2026-10-17-qms-p0-p1-implementation.md)。本次不分配发布号、不运行迁移、不写飞书。推荐错误行部分提交和 100 行上限在总计划单列，不把它们写成负责人此前已批准；三类重复编码跳过是已确认决定。

## 1. 文件与所有权

路径相对 `qms-2.0/`，新增文件在实施时创建。

定向真实 PG 命令使用 Jest exec，只选择当前用例；先依总计划准备一次性库及 migrate/seed，缺前置失败，不能因为直接运行 Jest 而略过迁移链。

| 单元 | 主要修改 | 新增文件 |
| --- | --- | --- |
| F1 | `apps/api/src/modules/supplier-quality/{supplier-quality.service.ts,supplier-quality.dto.ts,supplier-quality.controller.ts,supplier-quality.module.ts,supplier-quality.rules.ts}`；`organization/organization.service.ts`、identity 公开创建入口；`apps/api/prisma/schema.prisma`；Web `features/supplier-quality/SupplierProfilesPage.tsx` | API `supplier-quality/supplier-account.service.ts`、`supplier-profile-import.service.ts`；`test/supplier-quality/supplier-master-schema.integration-spec.ts`；Web `features/supplier-quality/{SupplierUsersPanel.tsx,SupplierUsersPanel.test.tsx}`、`playwright/supplier-master-accounts.spec.ts`；增量迁移 |
| F2 | `apps/api/src/modules/customer-quality/{customer-quality.service.ts,customer-quality.dto.ts,customer-quality.controller.ts,customer-quality.module.ts}`；Web `features/customer-quality/CustomerMasterSection.tsx` | API `customer-quality/customer-master-import.service.ts`、`test/customer-quality/customer-master-import.integration-spec.ts`；Web `features/customer-quality/CustomerMasterImport.test.tsx` |
| F3 | API AppModule/权限目录/新迁移/模块边界；Web 管理入口 | `apps/api/src/modules/material-master/{material-master.module.ts,material-master.controller.ts,material-master.service.ts,material-master.dto.ts}`；`test/material-master/material-master-schema.integration-spec.ts`；Web `features/material-master/{MaterialMasterPage.tsx,MaterialMasterPage.test.tsx}` |
| F 共用 | `apps/web/src/features/admin/AdminPage.tsx`、`layouts/InternalLayout.tsx`、`features/navigation/navigation.ts`、`api/client.ts`、`i18n/Language.tsx`、C 已提取的安全 `features/imports/read-xlsx.ts` | `apps/web/src/features/imports/{MasterDataImport.tsx,MasterDataImport.test.tsx}`、`playwright/master-data-import.spec.ts`；组件仅负责预览/状态，不做领域服务端校验 |
| G | 既有基础数据专项规格与各域交接中的接收预留章节、`docs/README.md` 必要入口 | 不新增运行源码/Controller/队列/机器凭据或监控页面 |

F1 影响既有供应商消费者：`supplier-performance`、`supplier-audit`、`supplier-quality-targets`、`supplier-meetings`、`supplier-pcn`、`supplier-admission`、`supplier-incoming`、`supplier-ppap`、`supplier-asn`、`task-notification` 和文件适配器。仅修改确实依赖组织非空事实的服务/DTO/SQL，不机械重写整个模块；每处在 F1 差异清单和回归记录中逐项标注。

## 2. F1：档案独立维护与兼容历史

### F1.1 先证明“导入不建组织”

- [ ] `supplier-master-schema.integration-spec.ts` 准备原绑定供应商及其历史问题、通知/附件，再新增无协作账号供应商，断言只新增档案、组织/用户数量不变；编码重复跳过、跨内部组织不可读、现有绑定/历史仍可用。
- [ ] 在一次性 PG 运行 `corepack pnpm --dir apps/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns=supplier-master-schema.integration-spec.ts`，确认原 DTO 强制组织造成的业务红灯。
- [ ] 复用 `SupplierBusinessProfile` 作为唯一供应商商业事实，把 `supplierOrganizationId` 改为可空，新增/修改 DTO 接受自有供应商名称，沿用编码/名称和原有可选联系人信息；不得另建一张与原 profile 同步的供应商事实表。
- [ ] 维持 `(ownerOrganizationId,businessCode)` 唯一；旧 `(ownerOrganizationId,supplierOrganizationId)` 对非空值继续唯一，确保一家已有企业不被重复绑定。旧 profile/id/code/name/organization 原样保留，不按名称自动合并。
- [ ] 给无组织 profile 的问题及内部专业记录建立 `(profileId,ownerOrganizationId)` 的强复合引用，不让 nullable 三元外键在 SQL MATCH SIMPLE 下跳过企业/档案校验。原问题组织快照可为空仅限未发布到供应商的内部记录；已有非空企业快照继续受复合约束保护。
- [ ] 真实迁移测试覆盖空库、旧库升级、无组织新档案、旧历史读取、组织空值不能绕过 profile owner 以及冲突明确失败；不删除数据或将不同供应商放入共享组织。

### F1.2 按需开通账号与企业边界

- [ ] 管理员从供应商档案点击“创建供应商用户账号”，可显式关联已有受控 SUPPLIER 组织；没有时通过组织公开服务建立专用隔离边界并绑定该档案。此动作发生在开通协作时，不发生在清单导入时，也不要求用户配置部门/岗位树。
- [ ] 开通服务校验本内部组织的供应商维护权限，以及相应账号创建权限；底层组织绑定由公开服务验证类型/现有关系，不能接受任意 supplierOrganizationId、前端角色或授权列表。账号复用 C 公开服务生成临时密码，不在供应商模块直接写 user/password 表。
- [ ] 组织绑定与首个账号创建同事务；失败回滚不留空账号/半绑定企业。已经绑定时再加第二账号复用同一个隔离边界，不再建组织；并发创建首个账号锁 profile，唯一约束和幂等确保只有一个边界。
- [ ] 管理员对新建边界得到的权限不超过本次操作所需的既有创建/读取/重置/停用范围；不因使用全局角色或客户资料写权限自动获得任意企业治理权。供应商用户角色只可授予门户业务权限，不授予创建账号/邀请/注册权限。
- [ ] 确认无 supplier signup 路由/入口/服务新增；登录仍是人员账号，普通个人资料/改密保留。同一家多账号分别记录操作者，停用其一不删除历史，也不影响其他账号。

### F1.3 全部领域消费者与隔离

- [ ] 将原 `performanceProfile` 等公开查询按用途分为允许档案无组织的内部读取和必须已绑定的门户操作；返回值类型明确 nullable，禁止 `as string` 或临时造 UUID 通过编译。
- [ ] 内部档案/质量记录按 ownerOrganizationId+profileId 授权；需要外部办理的提交/释放动作要求非空已开通关系，否则受控 `SUPPLIER_COLLABORATION_NOT_ENABLED`（409），UI 给出管理员开通入口。内部处理不因没有供应商账号被迫创建账号。
- [ ] 后续绑定只在受控事务中为仍未发布的记录填组织快照，已发布/历史记录保持原值；检查所有关联表和通知收件人的复合键，冲突停止绑定不重写历史。PCN 的供应商发起路径天然要求已登录企业，不增加匿名/无组织发起。
- [ ] 文件读取、回复提交、工作流节点权限、门户问题查询和通知投递每次以 session 企业与真实业务绑定复验；`null` 不能解释为全部企业或跳过过滤。未开通档案不能产生门户通知。
- [ ] 真实 PG 覆盖 A 企业两账号可读 A、不可读 B；内部跨组织拒绝；未开通档案内部维护/处理可用但门户释放拒绝；重置/停用不串其他企业；原供应商所有既有测试继续通过。
- [ ] 运行新测试及 `supplier-quality-schema.integration-spec.ts`、`supplier-response-schema.integration-spec.ts`、`supplier-workflow-access-schema.integration-spec.ts`、`test/authorization/supplier-isolation.e2e-spec.ts`；受影响阶段五消费者执行全 API PG 与 phase-5 验收，不能只测新空档案。

### F1.4 导入与 Web

- [ ] 写新增/重复/非法行混合结果、导入不造组织、导入后可维护名称、账号按需开通/第二账号/停用的 Web 红灯。
- [ ] 供应商维护页与平台管理入口使用同一领域组件/服务，不复制事实；模板采用代码已存在字段的业务列名（供应商编码、供应商名称及原有可选联系人列），不加新专业字段。portal 状态是技术关系的说明，不增加供应商业务状态选项。
- [ ] 逐行导入调用领域事务，编码 trim 后按既有供应商大小写语义匹配，不主动转换客户或物料规则；重复行不覆盖名称/联系人。竞争插入触发唯一冲突时回读同范围编码判断重复，否则返回失败，不能吞全部 409。
- [ ] `SupplierUsersPanel` 复用 C 的账号/临时密码组件；创建、重置、停用分别遵守原权限，UI 不新增额外审批；网络失败和旧响应不覆盖另一家供应商的面板。
- [ ] 运行新 Web 测试及 `SupplierProfilesPage.test.tsx`；执行真实 `supplier-master-accounts.spec.ts`，关联 C 的首次改密链；完成 F1 自己的全门禁和独立 PR。

## 3. F2：复用客户事实，增加批量新增

- [ ] 在新 PG 用例创建客户及既有关系，导入重复 code+不同 name，断言名称/关系/version 全不变；合法新行新增，非法行失败，跨组织拒绝；审计失败无当前行客户残留。
- [ ] 原客户 `createCustomer` 已规范化 `trim().toUpperCase()` 且按组织唯一，新导入使用同一规范化，不另建客户中心表；重用公开事务内创建逻辑，不在平台层直接 insert 客户表。
- [ ] 新建 `CustomerMasterImportDto` 与独立 customer-master import 端点，沿 `customer-quality:complaints:write/read` 原目录授权，仍不复用 D4 客诉导入 DTO。模板只使用现有客户编码、名称，不一并导入父子/项目/车型关系。
- [ ] 逐行复验已授权组织、合法输入及幂等；重复返回 `SKIPPED_DUPLICATE`，原关系维护和启停路径保持原契约。网络未知后原 key 重放不重复创建。
- [ ] `CustomerMasterSection` 或其抽出的同源组件同时供原客户质量页和平台管理使用；原 `CustomerQualityPage.tsx` 继续维护原关系，不创建同名平行页面事实。
- [ ] 运行 `corepack pnpm --dir apps/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns=customer-master-import.integration-spec.ts` 和 `corepack pnpm --filter @qms/web test src/features/customer-quality/CustomerMasterImport.test.tsx src/features/customer-quality/CustomerMasterSection.test.tsx`，再用真实浏览器验证从平台管理新增后原客户质量页可见、重复不覆盖。
- [ ] 生成/检查契约、审查/回归后独立 F2 PR；无需等待 F1 数据迁移，但共享导航变更由主代理整合。

## 4. F3：两字段物料主数据

- [ ] 写真实库测试：同组织编码唯一，其他组织相同编码可独立存在；编码按字符串保留前导 0，名称必填；重复跳过不改名/version，更新 expectedVersion 过期返回 409；没有单位/规格/来源等额外业务列。
- [ ] 新表 `material_masters`：id、organization_id、material_code、material_name、version、created/updated 元数据；编码 trim、保留大小写/前导 0（不自行生成、不按数字解析），组织内唯一；编码 1～100、名称 1～200 作为现有同类字段约束的实现取值。编码主键语义稳定，改名支持 CAS；首期不做删除/启停功能或业务编号迁移。
- [ ] 注册 `material-master` 模块、Swagger DTO；`GET/POST /api/v1/material-masters`、`PATCH /api/v1/material-masters/:id`、`POST /api/v1/material-masters/import`。写入复用事务审计、幂等和组织复验，查询只经公开服务。
- [ ] 登记 `material-master:read/write/import` 最小权限、Guard、迁移和目录测试；初始授予只给既有受控平台治理角色，其余角色不默认扩大，实际授权由管理员角色设置完成。供应商人员无物料后台权限。
- [ ] 公开查询服务只读当前组织 ID+code/name/version，不将既有 IQC/ASN/C13 的 `materialCode` 字符串强行改外键；新领域依赖按实际使用登记，不为未来接入加空依赖。
- [ ] UI `MaterialMasterPage` 列表、两字段录入/改名、两列表头模板/预览/导入结果，页面只展示必要业务字段和操作。读取 Excel 数字单元格时提示编码需字符串，不能补造丢失的前导 0。
- [ ] 运行 `corepack pnpm --dir apps/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns=material-master-schema.integration-spec.ts`、`corepack pnpm --filter @qms/web test src/features/material-master/MaterialMasterPage.test.tsx`，真实浏览器覆盖新建、改名、冲突、重复和越权，再完成 F3 独立 PR。

## 5. F 共用导入交互与平台入口

- [ ] 仅提取 C/F2/F3 实际共同使用的安全 `.xlsx` 首表读取；保留现有 2 MiB 文件、ZIP/解压/单元格/行列上限、防公式限制，逐领域映射字段，避免 build 时同步载入 ExcelJS 增大所有页面。
- [ ] 不同领域服务端校验独立；批量 1～100 行、逐行事务为本计划推荐。顶层 schema/权限/组织/大小失败在首行前拒绝；逐行输入错误返回 `FAILED`，已经存在编码返回 `SKIPPED_DUPLICATE`，只有提交并写审计成功才返回 `CREATED`。
- [ ] 同一个文件内部重复编码按原行号顺序处理：第一个合法行尝试新增，后续合法重复跳过；非法行先给具体错误，不能拿它拦住后面真正合法的同编码行。并发批次靠唯一约束确保仅一份事实。
- [ ] 平台管理三类页各按领域权限判定：当前 `/app/admin` 导航只按账号/角色治理组织目录显示，F 必须增量支持仅有主数据权限的内部用户看到对应清单，不能为看清单强授账号权限。其余账号治理分区继续按各自权限显隐，组织选择按该领域受控范围提供。
- [ ] 维护与导出同数据范围；必要清单导出复用既有导出授权/容量边界，不因导入权限自动放开跨组织全量导出。导出 `.xlsx` 字符串字段不解释公式。
- [ ] `MasterDataImport.test.tsx` 覆盖模板、前导 0、中文名、空态/错误、重复分组、行号、修正后重提、双击/中断重放/切换组织；已有 D4/F4 安全解析与文件用例回归通过。
- [ ] `master-data-import.spec.ts` 使用真实后端完成三类导入→重复不覆盖→原领域可见→跨组织拒绝；F1 另验多人供应商用户和无注册入口。每个 PR 只依赖自己已声明的共用代码快照。

结果格式示意（设计类型必须由 Swagger 生成，不在 Web 重复手写）：

```json
{"items":[
  {"rowNumber":2,"code":"00042","status":"CREATED"},
  {"rowNumber":3,"code":"00042","status":"SKIPPED_DUPLICATE"},
  {"rowNumber":4,"code":"","status":"FAILED","errorCode":"MASTER_DATA_INPUT_INVALID"}
],"created":1,"skipped":1,"failed":1}
```

## 6. G：把“只预留”落实为可验收文档

- [ ] 在已有基础数据设计写未来供应商/客户/物料接收对象与领域事实拥有者，标为未启用；预留所需认证、来源键、请求幂等、全量/增量、冲突权威方和监控数据来源的设计位置。
- [ ] 不定义未经外部资料证明的厂商字段/认证协议；将真实接入时必须取得的端口样本和授权资料列为后续需求输入，本次不索取密钥、不搭新 Controller/Worker/监控页面。
- [ ] 阅读实际变更清单确认 G 无 HTTP route、module provider、外部网络请求或机器凭据写入；文档明确手工导入不是已接通外部接口。
- [ ] 更新相关领域交接和文档导航；新工程文档按原索引规则登记。纯文档免独立 Issue/PR，但 G 验收作为 REQ-0015 的范围证明保留。
- [ ] 执行 `corepack pnpm check:governance`、`corepack pnpm check:docs` 和 `git diff --check`；不因没有外部调用而伪报“外部联调通过”。

## 7. 分单元完成及回退

F1、F2、F3 分别执行总计划 S0～S8：先实际 Issue，按任务红/绿，独立规格及质量审查，当前 PR 快照验证，通过后提交/推送/建 PR；合并/发布和台账回填按实际授权接续。不能先把 F 全部混入一个提交再声称三个 PR 独立通过。

- F1 新 nullable 数据存在后，旧程序可能报错或漏隔离；迁移前备份与真实旧库升级/兼容验证必需。回退停止新入口并前向兼容修复，不能为恢复 NOT NULL 删除无组织供应商。
- F2 沿原客户事实回退导入 UI/端点，不删除已经成功的新客户及关系。
- F3 新表保留已创建物料事实；关闭入口不改既有领域 materialCode，不逆向删除被业务使用的数据。
- 导入逐行成功后其他行失败不自动删已成功资料；结果中如实返回，修正行用新请求重提。
- 相关规格、领域交接、能力状态和验收记录仅随真实交付同步；G 的文档检查不替代 F 的数据库与门户行为证据。
