# QMS 2.0 受控流程设计器实施计划

**目标：** 提供可操作流程列表、草稿图编辑、校验、冻结发布、明确来源复制及冲突恢复；作为P4独立切片，不替代问题工作空间和领域动作。

**架构：** 现有WorkflowDefinition.version用作编辑revision，WorkflowVersion.version仍是发布序列；服务端定义锁与CAS保护图写入，审计同事务。React Flow画布与键盘表单使用同一受控graph，HTTP类型全部从Swagger生成。

## 实施前缺口（已关闭）

实施前 WorkflowDefinitionService 更新/发布没有编辑CAS，审计在提交后；copy找不到显式来源时会回退最新发布版，且不禁止并存草稿。控制器没有GET列表/准确版本详情，config/condition仍开放Object，旧version.e2e测试是fakePrisma，Web两页仍为静态占位。上述缺口现已由事务CAS、严格DTO、真实PG并发验证、React Flow设计器和真实浏览器链关闭。

## 文件与操作

- `apps/api/src/modules/workflow/workflow-definition.service.ts`：列表/定义/准确版本查询；create/update/publish/copy事务锁、会话与权限复验、revision CAS及事务内审计。
- `workflow.controller.ts`、`workflow.dto.ts`：GET集合、`:id`、`:id/versions/:versionId`；保存/发布必须draftVersionId+expectedRevision，复制明确sourceVersionId+expectedRevision。
- `workflow-validation.service.ts`、`workflow.types.ts`：区分结构安全草稿与可执行发布校验；严格config/condition，图数量与文本上限，不支持脚本。
- `prisma/migrations/20260919210000_workflow_draft_integrity`：每个definition仅一DRAFT的部分唯一索引，既有重复明确失败而不静默删除。
- `apps/web/src/features/workflows/workflow-api.ts`、`WorkflowListPage.tsx`、`WorkflowDesignerPage.tsx`：契约客户端、分页列表、准确版本编辑和发布态只读。
- `apps/web/src/layouts/InternalLayout.tsx`：流程分支区分列表及`/:definitionId/:versionId`详情；不重构其他路由。
- `apps/api/test/workflow/workflow-designer-schema.integration-spec.ts`、Web组件及Playwright：真实CAS/事务/冻结和实际图编辑浏览器链。

## 行为基线

保持workflow:manage与会话所属组织边界。内部服务与公开HTTP边界明确；HTTP始终传actor/session与revision。写入ReadCommitted中锁definition→准确version，等待后重验身份/权限、revision、草稿状态，再操作图与审计，成功revision恰好+1。旧baseline409，不能自动覆盖；已发布图任何写通道均拒绝。

响应保留嵌套version表示流程版本，新增revision映射definition.version，不能相互混淆。GET列表有限分页/搜索/状态，GET定义含版本摘要，不一次加载所有图。GET准确版本返回明确WorkflowGraphDto、发布信息和当前revision。显式复制来源不存在/跨定义/跨组织/非发布均404，不回退；已存在草稿409；复制重建节点UUID，保留nodeKey、动作、配置及布局。

保存允许结构安全、引用合法但尚未完成拓扑的草稿；发布必须完整校验。assignment规范化为roleCode/assigneeUserId/permission至少一个、AND，未知键拒绝。config明确isStart/isEnd、assignment、slaMinutes、reminders、escalation、requireIndependentVerification、有限editorPosition。条件仅六个现有公共字段，eq/ne/in/notIn和受限标量/数组；无条件省略，旧空对象读取规范化，不新增动态表达式。旧发布结构不重写。

当前执行语义中ACTION/APPROVAL/VERIFICATION/CC/CLOSE为处理节点，RETURN/REJECT/REOPEN通过显式动作边表达并在设计器可编辑；不把枚举中的同名独立节点冒充可执行能力。CC按已有人工节点处理，自动抄送另有明确边界。返回边只到前向祖先，REOPEN只从CLOSE，关闭为终止动作而非CLOSE出边。开始不能CLOSE，前向无环且全部可达终止，运行时继续检查实际访问历史及条件命中唯一性。

## Web状态

列表→准确版本；载入后冻结baseline(revision/versionId/graph)，编辑态独立。保存成功原子更新baseline；409保留本地草稿并提供显式重新加载，绝不自动换revision重试。403保留内容并禁提交。脏草稿发布须先保存成功再用新revision发布；成功后所有画布/表单/键盘修改禁用。复制明确来源并跳到新草稿，旧版始终冻结。加载以definition/version隔离过时响应。

画布外提供可键盘操作的节点列表、连线表单、属性与删除按钮。属性覆盖处理约束、时限、提前分钟提醒、只通知负责人升级、关闭独立验证；边覆盖动作/目标/受控条件。诊断可定位节点/边。配置选项接口只暴露必要用户ID/名称、角色代码、权限代码，不能要求额外账号管理权限或暴露邮箱。图不写localStorage或工作标签持久化。

## 验证

- [x] 真实PG RED：同revision并发保存、保存与发布两种先后、错误显式复制源不得回退、多个草稿拒绝、四种审计失败回滚。
- [x] 实现查询/严格DTO/事务CAS；非法字段、脚本、条件、SLA、图拓扑拒绝；冻结版本v1不受新v2修改影响。
- [x] Swagger生成与React Flow依赖锁定后接Web；组件验证编辑、校验定位、冲突保留、过时响应丢弃、只读所有通道。
- [x] 真实浏览器登录→创建/编辑/保存/发布/复制→旧版冻结，第二会话409、受限角色UI/API拒绝；另以中性发布版本执行 ACTION→APPROVAL→VERIFICATION→CLOSE，三步专用动作及不可变修订均通过；独立规格/质量复核。
- [x] P6整体聚合回归、contracts/build/PG/Compose/archive全部完成并记录最终结果。

## 当前状态

2026-09-20：设计器专项实现与定向验证完成。真实 PG 专项 24 PASS、相关四套 93 PASS，Web 组件 8 PASS；真实双会话设计器浏览器 1 PASS（用例 15.1 秒、整体 20.1 秒），覆盖创建、图编辑、保存、发布、明确来源复制、旧版冻结、第二会话409及受限角色 UI/API 拒绝。扩展中性问题浏览器在全新专库另 1 PASS（1.0 分钟），执行已发布 ACTION→APPROVAL→VERIFICATION→CLOSE 固定图，验证三步专用动作、任务投影、不可变领域修订、失败 Outbox 治理重试且不重复任务/通知；日志为 `D:/WorkSpace/QMS-2.0-local/main-integration-20260919/problem-browser-approval-verification-retry-pass.log`。最终 P6 四步聚合约 1130 秒全部 PASS（0 skip）：PG 20 套 404、API 36 套 381、Web 21 文件 135（440.39 秒）、Worker 3、安全输入 1、真实浏览器 17（3.7 分钟，其中中性闭环 40.4 秒），主契约与测试契约、API/Web build、两套 Compose、archive 与 frozen 检查全部通过；日志为 `D:/WorkSpace/QMS-2.0-local/main-integration-20260919/p6-final-green3.log`。生产领域注册边界及供应商质量阶段三能力继续独立维护。
