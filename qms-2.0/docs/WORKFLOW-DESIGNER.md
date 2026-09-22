# 流程设计器

`/app/workflow-designer` 支持列表、查询、草稿创建及准确历史版本。编辑页面固定 definitionId/versionId，不把旧版本链接替换成最新版。

画布按需加载，节点和连线同时提供键盘表单。可编辑节点为 ACTION、APPROVAL、VERIFICATION、CC、CLOSE；退回、驳回、重开使用 RETURN、REJECT、REOPEN 动作边。历史响应仍能读取原有八种节点枚举，但不允许把不可执行的旧节点复制为新可编辑流程。

处理约束中的角色、明确处理人和权限共同满足（AND）。时限提醒 offsetMinutes 表示截止前提前分钟；超时升级只通知配置的负责人，保留当前处理人与节点。条件仅作用于六个公共字段，支持 eq/ne/in/notIn 和受限标量/数组，不执行脚本。

保存允许安全但尚未完善的草稿；发布要求唯一合法起点、完整可达终点、合法动作与条件。CC 只允许 SUBMIT；CLOSE 可以 RETURN 或 REOPEN，关闭本身是终止动作。运行时还校验实际访问历史、条件唯一命中及可选独立验证。

每个定义最多一个草稿。Definition.revision 是编辑 CAS，Version.version 是发布序号，两者不可混用。更新及发布必须提供 draftVersionId/expectedRevision；复制必须给出准确 sourceVersionId/expectedRevision。找不到指定来源直接拒绝，不回退到最新版本。

保存、发布与复制在同一事务中锁定定义及版本、重验真实会话和 workflow:manage、执行 CAS 并写审计。审计失败回滚。发布版本冻结；修改必须复制新草稿。403 禁止后续写入，409 保留本地编辑并要求明确重新加载，不自动替换 revision 覆盖他人修改。

配置选项通过专用受限接口取得必要用户、角色和权限，不要求账号管理权限，也不返回邮箱。API 类型以 Swagger → `@qms/contracts` 为唯一来源。具体数据库、组件及真实双浏览器证据见 [FOUNDATION](FOUNDATION.md)。
