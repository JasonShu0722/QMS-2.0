# 流程设计器

## N2-B / B1 关闭职责配置预览（2026-10-25，本地开发）

按[N2计划第9节](../../docs/superpowers/plans/2026-10-24-qms-n2-configuration-and-workflow-foundations.md)接续。`POST /api/v1/workflows/closure-preview`为当前内部组织、有效会话及`workflow:manage`可访问的只读配置测试，不是问题发单、审批或流程发布接口；不写实例 / 轮次 / 待办，不发通知。生产70fdbab不包含本增量，正式设计器页面也尚未接入。

输入明确内部 / 供应商策略、风险、责任科室、专业人员；内部另需责任科室有效负责人，供应商不接受外部负责人身份。专业人员仅为配置测试输入，须本组织有效内部账号 / 任职且具`workflow:act`。将来实际提交必须从领域事实取发单人 / 负责人，不复用客户端试填身份作授权。

解析复用已有经理岗位绑定及部长分管：内部低中风险专业与经理并行，仅有效负责人同经理时管理侧跳过；高重大专业与部长并行，不因缺经理失败。供应商先专业后管理，低中经理、高重大经理及部长；双管理同人仍保留两个等待职责及一次确认组，不免审或混入专业确认。缺配置 / 失效 / 歧义给出明确信息，不指给管理员。

响应始终`previewOnly=true`，`configurationReady`只表示这次配置身份和职责可解析，不表示可执行、已签批或审批快照。末尾复验会话 / 权限 / 当前MFA政策，无actor更新锁；真实审批轮次、执行时资格、任务投影及新schema发布绑定仍在B2～B4实现。旧assignment / 已发布版本解释完全保持，不接受会被旧运行时忽略的新并行字段。

`/app/workflow-designer` 支持列表、查询、草稿创建及准确历史版本。编辑页面固定 definitionId/versionId，不把旧版本链接替换成最新版。

画布按需加载，节点和连线同时提供键盘表单。可编辑节点为 ACTION、APPROVAL、VERIFICATION、CC、CLOSE；退回、驳回、重开使用 RETURN、REJECT、REOPEN 动作边。历史响应仍能读取原有八种节点枚举，但不允许把不可执行的旧节点复制为新可编辑流程。

处理约束中的角色、明确处理人和权限共同满足（AND）。时限提醒 offsetMinutes 表示截止前提前分钟；超时升级只通知配置的负责人，保留当前处理人与节点。条件仅作用于六个公共字段，支持 eq/ne/in/notIn 和受限标量/数组，不执行脚本。

保存允许安全但尚未完善的草稿；发布要求唯一合法起点、完整可达终点、合法动作与条件。CC 只允许 SUBMIT；CLOSE 可以 RETURN 或 REOPEN，关闭本身是终止动作。运行时还校验实际访问历史、条件唯一命中及可选独立验证。

每个定义最多一个草稿。Definition.revision 是编辑 CAS，Version.version 是发布序号，两者不可混用。更新及发布必须提供 draftVersionId/expectedRevision；复制必须给出准确 sourceVersionId/expectedRevision。找不到指定来源直接拒绝，不回退到最新版本。

保存、发布与复制在同一事务中锁定定义及版本、重验真实会话和 workflow:manage、执行 CAS 并写审计。审计失败回滚。发布版本冻结；修改必须复制新草稿。403 禁止后续写入，409 保留本地编辑并要求明确重新加载，不自动替换 revision 覆盖他人修改。

配置选项通过专用受限接口取得必要用户、角色和权限，不要求账号管理权限，也不返回邮箱。API 类型以 Swagger → `@qms/contracts` 为唯一来源。具体数据库、组件及真实双浏览器证据见 [FOUNDATION](FOUNDATION.md)。
