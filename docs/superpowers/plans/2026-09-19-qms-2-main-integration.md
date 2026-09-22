# QMS 2.0 主目录整合与阶段二收尾计划

**目标：** 将已验收 P1/P2a/P2b/D–H 成果整合进用户指定主目录，保留其已有修改，在主目录重新验证后继续完成阶段二平台剩余能力。

**架构与边界：** 主目录 `D:/WorkSpace/QMS-2.0/qms-2.0` 为后续实现位置。以共同 Git 基线作三方比较，源码沿用已验收实现；Swagger 为契约唯一来源。仅内部子代理协作，不访问其他用户任务或供应商工作树。不自动提交、推送或部署。

## 整合与验证

- [x] 将主目录原有五个修改文件和迁移计划保存到 Git 外快照，记录摘要；根 AGENTS、工作区、根 README、迁移计划保持原样。快照在 `D:/WorkSpace/QMS-2.0-local/main-integration-20260919/original`。
- [x] 将平台工作树已跟踪差异与未跟踪实现文件按白名单整合；README 和 FOUNDATION 以共同基线三方合并，保留 D 盘迁移说明；不复制 node_modules、构建、环境或日志。共175项，README两处冲突保留主目录设置段落，平台新增完整保留。
- [x] 校验整合文件与来源一致（两份合并文档单独复核），检查无冲突标记、无秘密文件和归档修改。规范化内容检查与独立规格复核PASS；auth-routing测试仅移除末尾一个空白行。
- [x] 从主目录运行 frozen install、真实临时 PG 迁移/seed、API/Web、构建、Worker、Compose、archive、contracts、真实浏览器；不使用预览库 55440。九步PASS（PG244/API341/Web90/Worker3/browser13，0 skipped），独立规格/质量复审PASS，记录FOUNDATION。

## 后续开发顺序

- [x] P2c：实时授权任务/通知读取、通知已读及受控领取。失败事件查询/重试沿用已验收 F。固定版本节点与当前授权联合判断，查询先授权后分页；领取不得绕过领域完成校验。开发及定向验收完成，最终全平台聚合归P6。
- [x] P3：附件初始化/完成、真实对象校验、资源授权接口、隔离扫描、删除/保留与读取。45项后端定向、API366/Web8、真实浏览器1、备份5+8、双审PASS。最后租约修复及批量报告证据已进入P4/P5构建，file/inbox最终65项PG PASS；供应商专业关系仍由领域适配。
- [x] P4：设计器属性与发布校验、问题工作空间/任务/保存视图/只读报告及追溯已实现并通过定向PG/Web验证；设计器真实浏览器PASS；中性领域完整浏览器23.3s PASS，规格与质量复核完成。
- [x] P5：简报升级 8D 保留编号/来源/证据、明确字段映射、新固定版本实例、旧任务取消已实现，升级42及六套PG176 PASS；中性浏览器验证PASS，原成功处理回执在证据删除后仍可授权回放。
- [x] P6：2026-09-20全量平台验收退出码0（PG404/API381/Web135/Worker3/安全输入1/browser17，0 skip），主/测试契约、构建、两Compose、归档和冻结安装PASS；缺配置失败门禁与CI真实附件依赖完成。备份恢复8/密钥4/TLS4另行PASS。文档更新，六进程及四临时容器已清理，12端口释放。供应商端到端联调单独记账，不代替其领域验收。

每个开发切片先冻结具体接口/授权和有意义的失败用例，再实现、定向验证、规格审查、质量审查。主代理串行维护 schema/迁移/生成契约及聚合；只读盘点可并行。剩余细节根据现有设计及代码盘点在进入各切片前补入本计划。

依赖顺序细化：P3→P4流程设计器→P5升级与稳定历史归属→P4问题工作空间/报告/追溯→P6。后半P4依赖P5历史归属及领域修订，不能先以当前数据拼装假历史；具体见workflow-designer、workflow-upgrade、problem-workspace三个专项计划。

## P2c 已确认行为与实现边界

用户明确选择：独占处理，领取后由领取人操作，可释放，失去资格后允许重新领取。

### 文件与职责

- `apps/api/src/modules/workflow/workflow-access-policy.ts`：固定节点assignment规范化、角色/额外权限AND判断、实时用户与组织状态；SQL谓词用于数据库内授权过滤。
- `apps/api/src/modules/workflow/workflow-runtime.service.ts`：动作事务显式锁实例及当前轮次任务，执行独占限制；保持原事务回调与成功幂等回放。
- `apps/api/src/modules/task-notification/task-inbox.{controller,dto}.ts`、`task.service.ts`：当前有效任务分页，领取/释放CAS、会话复验和审计。
- `apps/api/src/modules/task-notification/notification.service.ts`：本人可信通知分页与已读CAS，历史通知实时授权；入口和DTO与task-inbox共置。
- `apps/api/prisma/schema.prisma` 和新增迁移：任务领取人/时间，成对非空CHECK、用户FK；通知分页索引及新权限，不自动授予生产角色。
- `apps/api/src/modules/identity/admin-user.service.ts`：历史业务引用保护纳入领取人。
- `apps/api/src/modules/authorization/permission-catalog.ts`、模块注册、seed和错误枚举：注册真正执行的API与权限；Swagger生成契约。
- `apps/web/src/features/tasks/`：任务与通知列表、分页、领取/释放/已读、冲突刷新和中英反馈，仅导入生成契约类型。
- `apps/api/test/task-notification/task-inbox-schema.integration-spec.ts`、HTTP测试、Web测试和真实Playwright：验证权限、SQL分页、竞争和页面操作。

### 授权与状态

`task:read`与`workflow:act`及固定节点assignment全部满足才可查看任务。内部用户可持目标组织角色；供应商只在本组织。同角色可见他人已领取任务，但不能执行。assignment中roleCode、assigneeUserId和permission为AND；role与permission允许分别由不同合法角色满足。主组织、目标组织和用户须ACTIVE。

`claimedByUserId/claimedAt`是可释放的领取，不能复用固定指派的assigneeUserId。领取需`task:claim`及处理资格；原领取人的处理资格丧失（禁用、组织停用、撤workflow:act或节点授权）后才可重领。仅撤task:claim不改变其已有处理资格。失效领取存在时，其他人须先重新领取再操作；未领取保持原合格人员可操作行为。已完成轮次的领取不限制REOPEN，新进入轮次不继承领取。

API为 `GET /api/v1/tasks`、`GET /api/v1/notifications`、`POST /api/v1/tasks/:id/claim`、`POST /api/v1/tasks/:id/release`、`POST /api/v1/notifications/:id/read`。写入只接收expectedVersion和组织上下文，actor来自会话；不公开通用complete。普通操作检查有效会话、securityVersion、MFA已完成，不要求五分钟内二次认证。

任务必须符合当前问题→实例、RUNNING、固定版本/当前节点/进入版本全部一致且未关闭归档。查询在SQL中先授权再count/limit；计数和分页来自同一语句快照，空页仍返回total。页大小1..100，offset有上限，排序固定。DTO返回状态/版本/节点/问题编号/时限/领取及canAct/canClaim/canRelease提示，写入不信任这些提示。

通知只显示本人的IN_APP可信kind与固定task/node/instance引用；TASK_ASSIGNED/REMINDER检查workflow:act+assignment，TASK_ESCALATED检查problem-index:read+escalation，LEGACY拒绝。历史通知无需节点仍为当前节点，不因他人领取消失；不依赖当前problem实例指针才能读取，便于后续升级保留追溯。已读需`notification:read`、有效会话和版本CAS，保留原正文与投递状态。

### 并发与事务

统一顺序为runtime幂等锁→problem→instance→当前task；claim/release为problem→instance→task；Worker沿用event→instance→task，不反向锁problem。拿完可能等待的业务锁后再次检查身份、权限和当前轮次；原领取人资格只读。所有业务写入ReadCommitted，不套Serializable管理写服务。

领取/释放复用task.version CAS，成功加1并原子记录审计；旧版本统一409。他人有效领取返回TASK_ALREADY_CLAIMED，非本人释放403 TASK_CLAIM_OWNER_REQUIRED，无领取释放409 TASK_NOT_CLAIMED。领取设IN_PROGRESS、释放设PENDING，过期则均保留OVERDUE；不改变截止时间、流程版本和投影游标。审计失败全部回滚。

### 验证顺序

- [x] 先写真实PG失败用例：角色AND/组织/状态/会话、数据库授权后分页、历史通知分类，验证旧实现未提供相应能力。
- [x] 实现共享资格与只读API，再验证以上用例；不自动把新权限授予已有生产角色。
- [x] 增加独占迁移和runtime锁序；测试双领取唯一胜者、释放/重领、固定指派不可绕过、runtime与claim两方向竞争、投影迟到、等待锁期间撤权/禁用/撤会话、审计回滚。
- [x] 正式Swagger生成后接入Web；验证无权/空态/加载错误、trace安全显示、分页、409刷新、同角色他人领取可见但不可操作。
- [x] 独立规格与质量复核、真实PG/HTTP/Web/浏览器定向验收通过后记录交接，接续P3。
- [x] P3/P4/P5整合后P6最终全平台聚合PASS，覆盖全部真实PG与浏览器链。证据：Git外 `D:/WorkSpace/QMS-2.0-local/main-integration-20260919/p6-final-green3.log`，失败历史与限制详见FOUNDATION。

### P2c 当前验证证据

后端首轮4套真实PG125项PASS；最终补充会话切换幂等回放后重跑inbox33+runtime28=61项PASS。API34套351项PASS，Web新增6项RED→GREEN、全量13文件96项及构建PASS，Swagger已生成。独立规格/质量复核PASS；通知固定排序索引补充部署/生成/构建PASS，真实双浏览器1条19.2s PASS。详细事实与限制记录FOUNDATION，P3实现已启动。

runtime保留既有受信内部服务调用可不传sessionId的边界。领域HTTP调用必须传真实actor.sessionId，供全部业务锁后认证复验；新inbox控制器已强制从真实会话取值。会话ID不进入业务幂等摘要，同用户换有效会话仍可回放，而撤销会话不能回放。
