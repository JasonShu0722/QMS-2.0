# 导航、工作台、登录与反馈修复实现计划（交付单元 A～D）

> **面向 AI 代理的工作者：** 使用 `superpowers-zh:subagent-driven-development` 逐任务实施；实现使用 TDD，规格审查通过后进行独立质量审查。未经授权不提交、推送或操作外部台账。

**目标：** 实施五条需求的四个交付单元：导航与层级、工作台文案、登录工具栏、双门户反馈。

**架构：** 复用前端导航配置、现有权限接口、内部外壳、共享语言和工作标签；路由与权限码保持原值。流程对象名称及版本使用已有读取结果，不创建数据库菜单或重复请求流程详情。

**技术栈：** React、TypeScript、Ant Design、lucide-react、Zustand、Vitest；真实验收使用一次性服务与浏览器。

## 1. 授权、基线和交付映射

- 设计：[导航、登录工具栏与需求反馈设计](../specs/2026-10-09-qms-navigation-and-feedback-design.md)。
- 本地授权：2026-10-09 用户在本线程要求“启动这一轮变更修复”；随后明确本人将五条需求设置为“开发中”。本地批准范围以会话确认设计为准，飞书机器人初稿不是扩展授权。
- 开工前已回读 Base `B12bbPj4Ta9Usos1Y4xcbTiFnue`、表 `tbl4mISZxWdE2bG7`，rev 148，五条均为“开发中”，当时 Issue / PR 链接均为空；GitHub 当时无开放 Issue / PR。后续已创建 Issue 如下，尚未回填飞书。
- 源码基线：`da61624645d55767963ea598ef244b8d38d7ff76`；活动位置 `D:/WorkSpace/QMS-2.0`；A 分支 `codex/req-0007-0010-navigation`。
- 保留本轮既有设计、项目规则、技能、文档入口和索引的未提交改动。它们首次随 A 交付；不回退或重复加入后续 PR。
- 分支隔离：遵循活动 checkout 要求，在 D 盘本地功能分支工作，不迁入 C / E 盘 worktree。依赖已经安装；受影响基线为导航和流程编辑测试 2 文件、13 用例 PASS；并行文件所有权见第 7 节。
- 2026-10-09 用户纠正执行顺序，要求先建立 Issue；已实际建立并回读 #12～#15。创建 Issue 的动作不扩大提交、推送、PR、合并、发布及飞书写入范围。
- 同日用户明确“可以并行同步修复的可以并行起来做”，调整原本地串行安排：独立实现并行，共享文件由主代理统一整合；四个 Issue / PR 不合并。当前活动分支暂保存本轮未提交整合改动，按下述文件归属整理各单元提交，不将所有修改混入 A PR；正式交付分支仍按核验后的主分支或明确记录的依赖基线建立。

| 单元 | 需求及实际记录 ID | Issue / PR 状态 | 计划分支及依赖 |
| --- | --- | --- | --- |
| A | REQ-0007 `recvxs4jVc8pek`；REQ-0010 `rec28l95YoFGnT` | [Issue #12](https://github.com/JasonShu0722/QMS-2.0/issues/12)；[V0.0.1 / PR #16](https://github.com/JasonShu0722/QMS-2.0/pull/16) | `codex/req-0007-0010-navigation` |
| B | REQ-0008 `recvxsiXu2gv5S` | [Issue #13](https://github.com/JasonShu0722/QMS-2.0/issues/13)；[V0.0.2 / PR #17](https://github.com/JasonShu0722/QMS-2.0/pull/17) | `codex/req-0008-workbench`，独立实现并行 |
| C | REQ-0006 `recvxrTGzJl04f` | [Issue #14](https://github.com/JasonShu0722/QMS-2.0/issues/14)；[V0.0.3 / PR #18](https://github.com/JasonShu0722/QMS-2.0/pull/18) | `codex/req-0006-login-tools`，独立实现并行 |
| D | REQ-0009 `rec28l7O9rBQf5` | [Issue #15](https://github.com/JasonShu0722/QMS-2.0/issues/15)；[V0.0.4 / PR #19](https://github.com/JasonShu0722/QMS-2.0/pull/19) | `codex/req-0009-feedback`，独立组件并行，共享外壳整合串行 |

A 两条共同定义导航树与编辑上下文，需要共同验收与回滚；B / C / D 目标和失败场景独立。状态、批准范围、验收与最终回填仍逐条记录。

### 1.1 提交与 PR 授权（2026-10-09）

用户在本线程明确“授权提交、推送并创建四个 PR”，采用上一轮建议的版本：A `V0.0.1`、B `V0.0.2`、C `V0.0.3`、D `V0.0.4`。该授权不含合并、发布、关闭 Issue 或飞书写入。

四个 PR 按 A → B → C → D 建立依赖基线：A 对 `main`；B 对 A 分支；C 对 B 分支；D 对 C 分支。独立实现仍分别归属四个单元；共享文件逐层只加入当前单元的 hunk，登录与反馈的真实联合浏览器用例随 D 提交。拆分最终树与已验证整合源码逐文件核对一致，不把整合测试结果表述为四个独立快照均已实测。

后续获准合并时，先将前置 PR 合入 `main`，再核对后续 PR 的基线并改为 `main`；如果采用 squash / rebase 合并，须重建后续依赖基线并重新验证差异，避免带入前置提交。不得直接把后续 PR 合入功能分支当作主分支交付。实际 PR 链接与源码 SHA 在创建后记录；CI、最终部署与闭环状态以真实结果为准。

### 1.2 PR #18 的 CI 回归修复

2026-10-09 用户指出 PR #18 失败并要求继续；沿用本轮提交、推送和原 PR 更新授权，不新增 Issue / PR。Foundation run `37892252611` 的 `web-tests (4)` 唯一失败是供应商附件用例未等到“已选 1 个可提交证据”，其他 127 项及其余任务通过；A / B / D 的最新 Foundation 已通过。

影响范围仅为 `SupplierQualityPage.test.tsx` 的异步刷新交互和本计划 / 来源摘要，不修改附件上传、扫描、证据授权、API、数据库或 CI 超时。根因已验证：上传后“等待安全扫描”已显示，但自动查询仍在进行，测试点击禁用的刷新按钮被忽略；自动轮询 2000 ms 晚于查询断言默认 1000 ms。受控附件读取 Promise 稳定重现同一断言红灯；修复等待可交互状态后点击，并保留扫描前拒绝、扫描后新增读取及实际提交证据 ID 的断言。

检查点：全新实现代理 `ci18_attachment_test_fix` 执行确定性红绿及附件相邻测试；先规格审查，再独立质量审查；主代理复跑受影响测试、原 4/4 shard、类型检查、治理和差异检查。修复版本预留 `V0.0.3-fix1`；验证通过后更新原 PR #18，并以普通合并同步 D 的依赖基线，不重写已推送历史。CI 通过前保持失败 / 待复核状态，部署、Issue 关闭及飞书回填仍未执行。

证据在 Git 外本轮目录的 `publication/`：原单文件基线 9 PASS / exit 0（`C-fix1-baseline.log`）；受控读取原失败 1 FAIL / exit 1（`C-fix1-red.log`，仅选择目标用例）；附件相邻 2 文件 / 15 PASS / exit 0（`C-fix1-green.log`）；最终目标 1 PASS / exit 0（`C-fix1-target-final.log`）。主代理在 Node 24.21.0 复跑原 CI 命令 `corepack pnpm --filter @qms/web test --shard=4/4 --maxWorkers=1`：16 文件 / 128 PASS / exit 0（`C-fix1-shard4.log`），无 Skip；Web 类型检查 exit 0（`C-fix1-lint.log`）。规格代理 `ci18_spec_review` 与质量代理 `ci18_quality_review` 均 PASS，无阻断；最终 CI 结果在原 PR 接续，不将本地结果当作 CI 或上线结果。

本次生产源码完全不变，未重建一次性业务环境或重跑真实浏览器 / PostgreSQL；本轮之前的业务证据仍对应相同生产源码，不作为最终发布验收。沿用既有“异步交互等待状态、不用延长超时掩盖竞态”的维护要求，无新增通用规则；受控读请求保留在失败用例中防止复发。

修复提交 `72c9dfc9578943476822b40f8bf1795026ae5bb5` 已推送至原 PR #18；[Foundation #84](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37897054682) 实际 completed / success。D 通过普通合并同步此依赖提交，保留既有 PR 映射和交付文档；唯一来源摘要冲突按最终合并计划的实际内容重算，不选用任一旧摘要。D 最新 HEAD 的检查仍单独核验，不复用旧 HEAD 的绿色结果。

## 2. 已发布 Issue 的范围底稿

### A：调整导航结构与页面层级

背景：条码校验领域归属错误，供应商台账与领域重名；公告、个人账号、平台管理分散，流程编辑与流程列表没有清晰的对象层级。

范围：问题中心 / 问题管理面板、供应商问题台账、关键件条码校验迁入供应商质量、系统服务四入口、暂时隐藏知识与文件 / 体系文件、流程对象名称 / 版本 / 编辑层级、类似详情页排查。

非目标：不删除文件业务、路由、数据，不迁移数据库菜单，不改变 API、权限码、接口拒绝、组织隔离或流程状态；供应商门户导航保留原结构。

逐项验收：REQ-0007 的供应商名称、条码归属、旧 URL、页面 / 顶栏 / 标签名称及权限保持；REQ-0010 的领域整合、问题面板、知识入口隐藏、系统服务独立权限 / 默认可访问页 / 加载失败、流程对象层级 / 未保存保护、其他页面排查。具体操作与联合验收见设计第 9、12 节。

验证：红绿用例、受影响 Web 测试、Web lint / build、治理与差异检查；一次性真实服务上的多角色、深链接、移动导航、语言 / 标签 / 未保存保护回归。最终含 A～D 的部署 SHA 再执行联合验收。

依赖 / 回滚：无新依赖或迁移；恢复前端导航、名称和外壳版本即可，无数据回滚。普通关联设计和历史 Issue #7，不使用自动关闭语句。两个需求及受影响联合项全通过后才关闭本 Issue，随后分别回填两行。

### B：精简工作台重复入口与页面文案

背景与范围：两处待办跳转都到 `/app/my-tasks`；保留“我的待办”卡片，删除顶部按钮和布局占位；逐正式菜单页面核查重复标题 / 描述 / 无效装饰说明，必要错误、权限、未保存和未接入提示保留。不新增角标或统计、不删除数据库配置。

验收 / 验证 / 回滚：保留入口目标与多语言、响应式正确；排查清单列每页结论和删减理由；受影响测试、lint / build、治理和真实浏览器回归通过；恢复对应页面及 CSS。独立一个 Issue / PR，可并行实现，正式 PR 基线在提交时核验；最终联合验收后关闭并逐记录回填。

### C：整合登录页语言与外观入口

背景与范围：登录页右上角紧凑两个入口，复用语言菜单与外观抽屉，保留中英文、模式、主色和持久化，不增加第三个泛化设置入口，不更换背景及登录表单。

验收 / 验证 / 回滚：键盘、焦点、刷新、登录后偏好一致；1920 / 1366 / 平板 / 窄屏无重叠；受影响测试、lint / build、治理和真实浏览器回归；恢复工具栏与局部样式。独立 Issue / PR，可并行实现，正式 PR 基线在提交时核验；最终联合验收后关闭并逐记录回填。

### D：双门户共用可拖动需求反馈按钮

背景与范围：内部和供应商登录后外壳挂共享组件，登录页隐藏；指针位移超过 5 px 屏蔽该手势点击，释放贴边、视口校正、有界容错记忆，键盘 / 点击用 `noopener,noreferrer` 打开设计中固定表单；不附带业务、身份或凭据数据。

验收 / 验证 / 回滚：鼠标 / 触屏 10 次拖动、取消和捕获释放、键盘、缩放、坏存储 / 存储不可用、弹窗层级、打印、减少动态效果；受影响测试、lint / build、治理和真实浏览器回归；恢复双外壳及组件版本。独立 Issue / PR，共享整合在 A 源码完成后执行，正式 PR 基线在提交时核验；最终联合验收后关闭并逐记录回填。

四份草案的交付记录都需填写实际 Issue / PR、每次部署 SHA、最终回归结果、关闭、回填及沉淀状态。没有实际对象不分配虚构编号。外部各阶段按获准动作执行；失败仅接续未完成步骤。

## 3. A 的文件职责与影响分析

| 文件（均在 `qms-2.0/`） | 职责 / 变更 |
| --- | --- |
| `apps/web/src/features/navigation/navigation.ts` | 领域、子入口、标题配置与旧路由识别 |
| `apps/web/src/layouts/InternalLayout.tsx` | 独立入口权限过滤、默认可访问子页、桌面 / 移动菜单、选中态、顶栏与工作标签 |
| `apps/web/src/features/workflows/WorkflowDesignerPage.tsx` | 根据已有对象结果展示系统服务 / 流程设计 / 对象 / 实际版本动作层级，并更新工作标签 |
| `apps/web/src/features/problem-center/ProblemCenterPage.tsx` | 问题管理面板标题 |
| `apps/web/src/features/supplier-quality/SupplierQualityPage.tsx` | 内部供应商问题台账标题；供应商门户保持现有名称 |
| `apps/web/src/features/site-scanning/SiteScanningPage.tsx` | 关键件条码校验标题与供应商领域上下文 |
| `apps/web/src/i18n/Language.tsx` | 新名称及对象层级词条 |
| `apps/web/src/layouts/shell.css` | 仅在层级呈现必要时补局部样式 |
| 上述目录已有 `.test.tsx`，必要新增 `navigation-access.test.tsx` | 原始问题、权限组合 / 失败、旧 URL、移动导航、语言切换、对象标题 / 状态与标签测试 |
| `docs/FRONTEND-DESIGN.md`、`docs/README.md`、`governance/documentation-index.json` | 当前状态、计划入口、来源复核，主代理所有 |

事实拥有者是 Web 导航配置；消费者包括领域导航、图标轨、移动菜单、上下文、页面标题、工作标签和工作台快捷入口。生成契约中已有 `PermissionsResponseDto`，权限事实来自 `/api/v1/system/my-permissions` 与既有管理组织查询；`workflow:manage` 与平台管理组织权限独立，不相互推导。

API / OpenAPI、数据库、权限码、数据范围、流程写入、审计、附件、Worker：均不变。新增前端权限消费不放宽接口访问。纯前端菜单无数据库迁移 / 回滚脚本。不得把单元测试中的 stub 当作真实权限或业务验收。

## 4. 执行步骤

### 任务 1：导航与独立权限可见性

- [x] 回读 A 两条记录的批准范围，保存 Git 外快照；源码写入前确认未撤回。
- [x] 增改行为用例：工作台显示“问题中心”“系统服务”、知识入口不见；系统服务分别覆盖普通内部用户、仅流程维护者、仅管理员、两者兼有、权限加载失败；条码校验仍使用原 URL；桌面与移动导航一致。
- [x] 运行红灯：`corepack pnpm --filter @qms/web test src/features/navigation/navigation.test.tsx src/features/navigation/navigation-access.test.tsx`。预期目标结构与权限断言在原实现失败，不以网络错误或测试配置失败代替。
- [x] 最小配置改动，原 URL 不动；可见领域由各自可见子入口组成，默认进入首个可见子入口。例如：

```ts
const children = domain.children.filter(entry =>
  entry.path === '/app/admin' ? Boolean(organizations?.length) :
  entry.path === '/app/workflow-designer' ? permissions?.permissions.includes('workflow:manage') : true);
return children.length ? { ...domain, path: children[0]!.path, children } : undefined;
```

- [x] 保留公告、个人账号在管理权限失败时可访问，失败提示仍明确；请求生命周期与组织 / 身份变化不沿用旧权限。
- [x] 运行上述测试绿灯及相邻导航 / 标签用例；无权限深链接保留既有 API 拒绝。

### 任务 2：名称、对象层级及工作标签

- [x] 写失败用例：实际流程名与草稿 / 已发布版本层级；侧栏持续选中流程设计，无同级流程编辑；工作标签为实际对象名加动作；页面标题、顶栏、旧 URL 及语言同步。
- [x] 运行红灯：`corepack pnpm --filter @qms/web test src/features/workflows/workflow-designer.test.tsx src/features/navigation/navigation.test.tsx`。
- [x] 在已有流程读取成功处使用实际结果，禁止再由外壳取同一对象；保留冻结、并发、未保存、加载失败保护。例如根据 `result.name` 与 `result.version.status` 展示对象层级并用已有 `openTab` 更新标题。
- [x] 更新问题面板、内部供应商台账、条码页面和语言词条；供应商门户独立名称保持。
- [x] 逐正式路由核查其他详情 / 编辑场景，表中记录“现有对象层级足够 / 本轮整改 / 未实现”及理由，不任意改写领域工作流。
- [x] 绿灯后规格审查，再独立质量审查；阻断项修复后重新审查。

### 任务 3：完整本地验证与记录

- [x] `corepack pnpm --filter @qms/web test --maxWorkers=1`：65 文件 / 355 用例 PASS，新增非平凡权限分支有行为用例。
- [x] `corepack pnpm --filter @qms/web lint`、`corepack pnpm --filter @qms/web build`：退出码 0。
- [x] `corepack pnpm check:governance`、`git diff --check`：PASS。
- [x] 按一次性真实环境执行 A 的多角色允许 / 拒绝、旧深链接、对象层级、未保存、移动菜单、语言和主题回归；未连接保留数据库 `55440`。真实设备未具备项另记第 10 节，不改用 Mock / Skip。
- [x] 记录基线、文件、实现 / 规格 / 质量代理、红绿命令 / 退出码、证据和未覆盖范围。日志、截图、配置及凭据在 `D:/WorkSpace/QMS-2.0-local/` 的本轮新目录，不进入 Git。

## 5. 提交、回归、关闭与回填

- [x] 直接获准后发布并回读四个真实 Issue；建 Issue 与最终 PR 分开。提交 / PR 版本号仍需按负责人 / 计划确认，不能由 REQ 或包版本推断。
- [x] 本地验证与两阶段审查后，依据直接授权按 A～D 拆分提交、推送并创建四个 PR；A 首次包含规划 / 规则文档，后续仅对应单元及增量交付记录。四个真实 URL 已附到本聊天，实际映射如下。
- [x] 获准合并 / 发布后，逐交付单元核验 Foundation、部署完整 SHA、镜像、启动、健康、HTTP 和目标行为；本地独立实现可并行，不跳过任一交付单元门禁。
- [x] 冻结含 A～D 的最终版本，执行设计第 12 节逐需求及联合回归；A 两条和受影响联合项全部 PASS 才关闭 A。
- [x] Issue 先记录真实验收 / 限制 / 回滚 / 复盘，再以 `completed` 关闭并回读。
- [x] 获准飞书写入后分别按真实阶段回填链接、已上线、上线验收完成、已结束和实际完成时间；写前回读，最小更新，写后确认。超时先回读，只接续未完成动作；已关闭但回填失败报告同步未完成，不重复开发或发布。

## 6. 计划内沉淀与当前执行记录

- 拟沉淀：独立子入口权限、前端导航事实与数据库菜单的区分、对象标签从读取事实生成、跨页面层级排查；仅真实实施验证后判断是否形成通用要求。
- 权威目标：公共前端规则进入前端统一规格及 `qms-2.0/docs/FRONTEND-DESIGN.md`；通用交付规则仍在 `DELIVERY-MAINTENANCE-PROCESS.md`，项目规则 / Skill 仅保留入口。A 的名称、数量、ID 和排查结论留在本计划。
- 验证：相关交互与权限用例、独立审查、真实浏览器、来源摘要和治理；没有新可复用规则则记录理由，不把单次修复升级为强制规则。
- 当前：四个单元本地实现、规格 / 质量审查、现有环境的独立门禁已完成；回读 rev 148，创建并回读 Issue #12～#15。证据与限制见第 10 节；四个 PR 已提交并推送，实际映射见第 11 节；未合并、发布或回填飞书。

## 7. 并行任务及共享文件所有权

### 任务 B：工作台与文案（Issue #13）

文件所有权：`qms-2.0/apps/web/src/workbench/Workbench.tsx`、`workbench.css`、新增 `Workbench.test.tsx`。先读取所有正式功能页面，仅按重复标题、重复描述和无效装饰说明判定；排查结论交主代理写入计划。A 拥有的导航、对象标题及语言文件不能同时写；其他业务页面发现确实需要整改时先交主代理安排。

- [x] 增加中英文行为用例：工作台区域中仅一个 `/app/my-tasks` 卡片入口，原顶部按钮不存在，必要未接入提示仍显示。
- [x] 红灯命令：`corepack pnpm --filter @qms/web test src/workbench/Workbench.test.tsx`。
- [x] 删除顶部重复 `Link` 和 `.qms-workbench__primary` 两条 CSS；保留卡片、描述、原路由和真实统计未接入说明。例如：

```tsx
<header className="qms-workbench__heading">
  <div><h1>{t('综合工作台')}</h1><p>{t('从待办开始，推进每一项质量改进。')}</p></div>
</header>
```

- [x] 上述测试绿灯；排查清单覆盖全部正式菜单页面，解释保留的必要提示；规格 / 质量审查后进入共同门禁。

### 任务 C：登录工具栏（Issue #14）

文件所有权：`qms-2.0/apps/web/src/App.tsx`、新增 `features/auth/AuthToolbar.tsx` / `.test.tsx` / `.css`，必要 `theme/AppearanceButton.tsx` 的紧凑入口参数。`Language.tsx`、`shell.css` 与既有 `ui-appearance.spec.ts` 由 A / 主代理所有；需要词条或共享语言参数时提出精确增量，由主代理整合。

- [x] 用共享 LanguageProvider / ThemeProvider 渲染工具栏，失败断言两个可访问入口、无第三个设置按钮、语言菜单键盘与外观抽屉模式 / 主色变化及持久化。
- [x] 红灯命令：`corepack pnpm --filter @qms/web test src/features/auth/AuthToolbar.test.tsx`。
- [x] 用现有控件替换 App 的单独语言定位层，不改认证路由；结构例如：

```tsx
return <div className="qms-auth-toolbar"><LanguageSwitcher /><AppearanceButton /></div>;
```

- [x] 使用语义变量与局部 CSS 实现紧凑按钮和窄屏触控区域，避让原背景 / 表单；不增加新偏好 store 或重复主题按钮。
- [x] 绿灯及原语言 / 主题 / 登录测试；规格 / 质量审查后在真实浏览器检查桌面 / 平板 / 窄屏的布局和键盘。

### 任务 D：需求反馈（Issue #15）

文件所有权：新增 `qms-2.0/apps/web/src/features/feedback/FeedbackButton.tsx` / `.css` / `.test.tsx` 及集中链接常量。`InternalLayout.tsx`、`SupplierLayout.tsx`、`Language.tsx` 挂载和词条由主代理在 A 完成后串行整合。

- [x] 增加指针、键盘、取消、捕获释放、阈值、最近边、坏存储 / 不可用存储、缩放的行为用例；单一固定 URL、窗口隔离参数和拖动后键盘重启用均验证。
- [x] 红灯命令：`corepack pnpm --filter @qms/web test src/features/feedback/FeedbackButton.test.tsx`。
- [x] 使用原生 button 与 Pointer Events，不新增依赖；移动超过 5 px 标记拖动，保存经验证的贴边与有界垂直位置，拖动手势后的指针点击被屏蔽，键盘点击独立允许。例如：

```tsx
onClick={event => {
  if (event.detail !== 0 && suppressPointerClick.current) return;
  window.open(FEEDBACK_FORM_URL, '_blank', 'noopener,noreferrer');
}}
```

- [x] 局部语义变量样式、低于弹窗层级、打印隐藏与减少动态效果；主代理串行挂载双登录后外壳，不挂登录页。
- [x] 绿灯、规格审查、质量审查；真实鼠标 / 触屏各 10 次拖动及其它要求纳入共同浏览器门禁。

并行执行只允许上述独立源码所有权。主代理统一更新计划、治理、共享翻译和外壳挂载，运行整合版本的完整 Web、lint / build、治理、真实浏览器及联合回归；不得把各代理单项 PASS 当作整合验收。

## 8. B 正式页面文案排查（2026-10-09，源码检查）

排查覆盖 34 个正式菜单 / 工作台入口；外壳工作位置与正文标题属于不同导航层次，不作为同一区域重复。以下结论不代表真实页面验收通过。

| 路由 / 页面 | 结论及理由 |
| --- | --- |
| `/app/workbench` | 删除顶部重复待办按钮，保留卡片解释和统计未接入说明，不将缺失数据当成零 |
| `/app/problem-center` | 保留授权组织、检索、个人视图说明与保存视图控件标签；名称由 A 调整 |
| `/app/my-tasks` | 保留任务 / 通知分区、领取资格变化、重试与空状态 |
| `/app/workflow-designer` | 保留草稿 / 历史版本分区和发布前置条件；对象层级由 A 调整 |
| `/app/supplier-quality` | 删除装饰“供应商质量协作”；保留保存后发单、回复冻结、扫描与未提交附件恢复限制 |
| `/app/supplier-incoming` | 保留人工登记 / 版本 / 照片说明、MES 未开放、扫描恢复和正式发单区别 |
| `/app/supplier-concession` | 保留 NG 检验、数量 / 有效期、他人审批和 MES 联调边界 |
| `/app/supplier-admission` | 保留真实附件与扫描版本提交条件、并发冲突说明 |
| `/app/supplier-pcn` | 保留领域路径、变更类型、证据与受控审批，详情状态 / 版本 / 审核轨迹 |
| `/app/supplier-performance` | 保留评分权重、月度唯一、无样本不可评分和历史快照口径 |
| `/app/supplier-audit` | 保留计划 / 记录 / 检查项和按版本提交关闭说明；拒绝与失败不当空数据 |
| `/app/supplier-quality-targets` | 保留配置→审批→发布、偏差、历史实际值与录入分区 |
| `/app/supplier-ppap` | 保留 Level 1～5、扫描证据、缺证据与再鉴定顺延确认 |
| `/app/supplier-asn` | 保留仅一项物料限制及已发布规范 / 已批准 PPAP / 文件版本提交条件 |
| `/app/process-quality` | 保留来源核对、单 / 多记录发单、已发布流程限制、来源版本变化与无证据提示 |
| `/app/customer-quality` | 保留来源与正式分流、Excel 首工作表 / 列名 / 100 条 / 本地解析边界、逐行拒绝信息 |
| `/app/audits` | 保留计划 ID、权限范围、导入逐行复核、按版本提交与流程选择 |
| `/app/audit-standards` | 保留发布版本不可改、审核记录固定版本和待发布 / 生效状态 |
| `/app/new-product-quality` | 保留阶段 / 经验 / 试制范围、他人审批和移交检查 / 归档影响 |
| `/app/quality-data` | 保留无阈值不判红绿、未核实不汇总、时间 / 单位 / 比值口径、辅助分析不改业务状态 |
| `/app/task-statistics` | 删除装饰“系统效率”；保留组织 / 运行中范围和失败待恢复单计口径 |
| `/app/announcements` | 删除装饰“系统协同”；保留主动确认必读、接收人上限与组织范围、发布后锁定说明 |
| `/app/coordinate-inspection` | 删除装饰“检测资源”；保留审批 / 排单 / 进度、权限与版本冲突恢复 |
| `/app/site-scanning` | 删除装饰“现场能力”；A 的页面同名标题调整后去掉重复 Card title；保留规则 / 权限 / 格式失败与重试 |
| `/app/documents` | 暂隐藏入口，保留未实现占位事实与原路由；不删除业务代码和数据 |
| `/app/risk-dashboard` | 保留未接入说明，不能当作已提供风险统计 |
| `/app/account` | 保留资料 / 密码 / 会话分区、MFA、有效期与错误反馈 |
| `/app/admin` | 保留权限加载 / 拒绝、管理组织与切换时放弃草稿提示，内部八标签各有功能用途 |
| `/supplier/inbox` | “我的通知”描述实际内容，保留通知正文、节点 / 时间、关联问题、未读和错误 |
| `/supplier/corrections` | 去掉共用装饰“供应商质量协作”，保留问题与整改、回复冻结、证据与恢复限制 |
| `/supplier/documents` | 当前由外壳占位，保留未接入事实，不能把领域源码当作已接入门户 |
| `/supplier/pcns` | 保留申报 / 表单 / 台账、扫描 / 受控流程、版本和保存后提交条件 |
| `/supplier/performance` | 本企业范围与已发布状态各有含义；保留申诉保存 / 提交及来源快照 |
| `/supplier/account` | 共用账号页，保留企业身份、MFA、密码和会话说明 |

另检查流程编辑、问题工作空间、供应商资料编辑及平台管理八个内部标签：实际对象、状态、只读、未保存、并发、重置凭证不可再显示、配置变量和导出有效期说明均保留。装饰项只作删除，无需新抽象或新业务功能；涉及 A 共有文件由 A 统一编辑，其他三项由主代理串行整改。具体实现和浏览器结果见执行记录。

## 9. A 对象层级排查（2026-10-09，源码检查）

| 路由 / 页面 | 结论及依据 |
| --- | --- |
| `/app/workflow-designer/:definitionId/:versionId` | 本轮整改：系统服务 → 流程设计 → 已读取的真实对象名称 → 实际状态动作与版本；侧栏保持父菜单选中，工作标签使用对象名称与动作 |
| `/app/problem-workspace/:problemId` | 现有层级足够：领域上下文、面板入口 / 返回、真实编号 / 对象标题；不新增独立同级菜单 |
| `/app/supplier-quality/problems/:id` | 现有层级足够：供应商质量上下文、供应商问题台账标题、真实对象标题与台账返回动作 |
| `/app/supplier-quality/profiles`、`/app/supplier-quality/new` | 台账内资料 / 新建动作，不是平铺领域入口；保留实际编辑及未保存保护 |
| 供应商来料、让步、准入、PCN、绩效、审核、目标、PPAP、ASN 页面 | 现有台账内分区、Drawer 或 Modal 显示对象编号 / 名称 / 状态及动作，无独立详情平铺菜单；保留 |
| 不良品台账、客户质量、新品质量、审核管理 / 标准、三坐标检测页面 | 现有台账分区或浮层表达对象信息及实际动作；保留。制程质量一级下叶子名称修为不良品台账 |
| 工作台、我的待办、质量数据、任务统计、公告、个人账号、平台管理 | 非独立对象编辑路由；保留分区层级 |
| `/app/documents`、`/app/risk-dashboard` | 未实现能力，保留 `EmptyDomain` 占位事实；体系文件仅隐藏菜单，不删除元数据与旧 URL |

以上是源码层级排查，不代表每项业务在浏览器中逐一实测。真实回归范围和结果单独记录。

## 10. 本地执行与审查证据（2026-10-09）

本轮按本地接单授权先准备 Issue 底稿及红灯用例；用户纠正顺序后，已创建并回读四个 Issue，再接续四个单元实施。后续以“确认范围 / 授权 → 建 Issue → 实现 → 验证与两阶段审查 → 最终 PR → 合并 / 发布核验 → 最终版本逐项及联合回归 → 关闭 / 回填”为检查点，不用并行开发绕过交付检查点。

证据目录为 Git 外 `D:/WorkSpace/QMS-2.0-local/acceptance/2026-10-09-navigation-repair/`；以下日志文件名均相对此目录。以下是提交前整合工作区的实际验证记录，基线 SHA 为第 1 节所列值；当前提交映射见第 11 节，本地静态资源验证不等于已发布 SHA 验收。

| 单元 / 实现代理 | 红灯与绿灯证据 |
| --- | --- |
| A / `navigation_implementation` | `implementation-red.log`：15 FAIL / 8 PASS；页面名称红灯 2 FAIL / 10 PASS，均 exit 1。`implementation-green-final.log`：8 文件 / 42 PASS；`navigation-access-final.log`：2 文件 / 16 PASS。规格返修 `process-ledger-red.log`：2 FAIL；`process-ledger-green.log`：3 文件 / 24 PASS。质量返修 `workflow-failure-red.log`：5 FAIL；`workflow-failure-green.log`：3 文件 / 29 PASS；绿色均 exit 0 |
| B / `workbench_implementation` | `B-red.log`：2 FAIL / 2 PASS、exit 1；`B-green.log`：4 PASS、exit 0；主代理独立重跑相同 4 项通过。逐页面排查及共有页删除见第 8 节 |
| C / `login_implementation` | `C-red.log`：缺少外观入口的两项有效红灯，另一项 jsdom 键盘布局模拟问题已纠正；`C-green.log`：6 文件 / 24 PASS、exit 0。真实键盘选择复现默认点击重新打开菜单，主代理在共享选择处理先取消默认行为、再沿用关闭 / 焦点返回；真实绿灯见下表 |
| D / `feedback_implementation` | `D-red.log`：20 项因组件缺失 FAIL、exit 1；`D-green.log`：反馈 / 语言 / 主题 3 文件 / 25 PASS、exit 0；共享双外壳挂载和英文词条由主代理整合 |

规格代理 `repair_spec_review` 独立逐单元检查，发现并关闭 A 二级名称、B 门户装饰语两项偏差，补第 9 节明细；A/C 增量静态复查通过。质量代理 `repair_quality_review` 发现并关闭 A 失败详情标签、真实对象名被词条翻译两个 P2；A～D 及 C 键盘取消默认点击增量复查通过。其静态结论不代替真实浏览器与完整门禁。

### 10.1 主代理独立环境与门禁

使用 Node 24.21.0、项目已安装依赖；一次性 Compose 项目 `qms-navigation-20261009`，PostgreSQL 18 / `55449`、MinIO / `19049`、Mailpit、真实 API / `3009`、Worker 和 nginx 网关 / `18099`。数据库使用 tmpfs，迁移、seed、对象存储 bucket 与服务健康已验证；未连接保留预览数据库 `55440`。无 API / DTO / 迁移变更，不宣称附件扫描或完整阶段验收通过。

| 检查 | 实际结果及证据 |
| --- | --- |
| API 构建 | PASS / exit 0，`api-build.log` |
| API 身份 / 流程测试 | `corepack pnpm --filter @qms/api test test/identity test/workflow`，17 文件 / 112 PASS、exit 0；`api-tests.log` |
| 真实 PostgreSQL 集成 | 在 `apps/api/` 执行 Jest `--runInBand`，覆盖 `identity/admin-security-schema.integration-spec.ts`、`workflow/workflow-designer-schema.integration-spec.ts`、`organization/organization-schema.integration-spec.ts`；3 文件 / 93 PASS、exit 0；`postgres-integration.log` |
| 归档隔离 / 契约 | `corepack pnpm check:archive-isolation`、`corepack pnpm contracts:check`，均 PASS / exit 0；生成契约无差异 |
| Compose 配置 | 外部本轮配置 `docker compose ... config --quiet`，PASS / exit 0 |
| Web lint / 构建 | lint PASS / exit 0；最新 `web-build-keyboard.log` PASS / exit 0，保留既有 chunk 大小警告 |
| Web 完整测试 | 首轮实施期间运行 `web-tests.log` 为 FAIL（4 项超时、1 项导航词条未齐），不作为完成证据。`corepack pnpm --filter @qms/web test --maxWorkers=1`：65 文件 / 355 PASS、exit 0，`web-tests-serial.log`。最后键盘增量独立复跑 2 文件 / 7 PASS、exit 0，`keyboard-final-unit.log` |
| 真实整合浏览器 | `login-feedback.spec.ts`、`ui-appearance.spec.ts`、`workflow-designer.spec.ts` 四项，4 PASS / exit 0，`browser-integrated-final.log`；新增知识入口隐藏及旧体系文件 URL 占位检查后，`ui-appearance.spec.ts` 独立复跑 1 PASS / exit 0，`navigation-old-route-final.log` |
| Chrome / Edge / Firefox | 外部 `browser-matrix.config.cjs`，两个登录 / 双门户反馈场景 × 三浏览器，6 PASS / exit 0，`browser-matrix-verified.log`。键盘用原生 Enter / ArrowDown / Enter，等待菜单自身自动聚焦，不以直接 focus 菜单项代替箭头操作 |
| 治理与差异 | `corepack pnpm check:governance` PASS / exit 0，36 文档 / 205 链接 / 18 来源复核 / 115 依赖对 / 阶段五覆盖；`governance-final.log`。项目行尾配置下 `git diff --check` exit 0；12 个未跟踪文件另检查无行尾空白 |

浏览器实际覆盖：1920 / 1366 / 1024 / 390，背景与表单保留、两入口、44 px 窄屏、语言刷新 / 焦点、浅深 × 三主色及跟随系统；双门户各 10 次鼠标拖动，Chrome / Edge / Chromium CDP 各 10 次触屏输入、不误开；原生 Enter / Space / 点击、安全固定 URL、实际无 Referer / opener、贴边 / 缩放 / 坏存储、打印 / 减少动态、浮层遮罩；流程真实创建 / 保存 / 版本、独立权限、对象层级与未保存保护。鼠标 / 模拟触屏与真实硬件明确区分；Firefox 只提供实际鼠标 / 键盘证据。

### 10.2 沉淀与剩余交付边界

本轮通用交付要求已进入 `DELIVERY-MAINTENANCE-PROCESS.md`，`DEVELOPMENT-GOVERNANCE.md`、`AGENTS.md` 与接单 / Superpowers 技能仅保留路由和边界；已运行规则场景复核与治理。前端指导补齐共享工具栏 / 反馈 / 导航事实拥有者的实际复用入口。独立权限、实际对象名称、失败工作页、复用与真实验收沿用现有统一前端规范，不新增另一套 UI 强制规则；具体数量、路由、ID 与结论仅留本专项。

交付前再次按实际 record_id 回读，rev 148，五条仍为“开发中”，批准范围没有变更；快照 `requirements-after-implementation.json`。当时四个 Issue 均已建立，PR / 提交 / 推送尚未执行，未改变飞书状态或链接。随后取得第 1.1 节的直接授权，按单元拆分源码与共享文件的必要 hunk 并核验依赖基线；实际提交及 PR 见第 11 节。

真实触屏硬件尚未验收；最终含 A～D 的主分支部署 SHA、镜像 / 健康 / HTTP、逐需求联合回归、关闭四个 Issue、逐行回填飞书均待对应阶段执行。没有最终发布与真实设备证据时，保持相关检查项未完成，不把本地绿色结果回填为“已上线”“上线验收完成”或“已结束”。

一次性环境已收尾：核对本轮记录的进程身份后停止 API / Worker；仅销毁 `qms-navigation-20261009` 的容器与网络，回读无残留。加密凭据、日志及截图继续保存在 Git 外；没有留下持续预览或接单任务。

## 11. 实际提交与 PR 映射（2026-10-09）

四个交付单元已提交并原子推送至 `origin`，四个 PR 均为开放状态并已附到本线程。主分支未修改；不使用自动关闭语句。

| 单元 / 版本 | Issue | PR | 源码提交 SHA | PR base |
| --- | --- | --- | --- | --- |
| A / V0.0.1 | [#12](https://github.com/JasonShu0722/QMS-2.0/issues/12) | [#16](https://github.com/JasonShu0722/QMS-2.0/pull/16) | `1abf0cf3145f659b3eb90774abac8f1504e2ce6f` | `main` |
| B / V0.0.2 | [#13](https://github.com/JasonShu0722/QMS-2.0/issues/13) | [#17](https://github.com/JasonShu0722/QMS-2.0/pull/17) | `ed0d852a374ad831e7299c589943ab70b210be2b` | `codex/req-0007-0010-navigation` |
| C / V0.0.3 | [#14](https://github.com/JasonShu0722/QMS-2.0/issues/14) | [#18](https://github.com/JasonShu0722/QMS-2.0/pull/18) | `f76da952893b8ceed4fb6da098384e1f447adc4a` | `codex/req-0008-workbench` |
| D / V0.0.4 | [#15](https://github.com/JasonShu0722/QMS-2.0/issues/15) | [#19](https://github.com/JasonShu0722/QMS-2.0/pull/19) | `5d98e1e43d1bebe5c319820e1c513f995bf0fb17` | `codex/req-0006-login-tools` |

提交前在 Node 24.21.0 重新执行 6 文件 / 55 项测试、Web 类型检查、治理及差异检查，均 exit 0；证据在 Git 外本轮目录的 `publication/tests-before-commit.log`、`lint-before-commit.log`、`governance-before-commit.log`。最初一次命令未加载本地运行入口使用 Node 22，测试已主动中止，不作为完成证据；随后在项目规定运行环境复核。

逐单元检查差异文件清单，最终 D 提交树与已验收的 48 文件整合树逐文件一致；相对完整验收快照只增加授权与依赖记录，未修改功能源码。D 后续追加本节、设计当前状态及前端指导的实际交付记录，属于文档增量，功能源码 SHA 仍为上表值。

CI 以最新 PR HEAD 的实际结果为准，创建成功不代表 CI 通过。合并、发布、真实触屏硬件、最终部署版本逐项及联合回归、关闭 Issue、飞书回填仍未完成；按第 5 节检查点继续。

## 12. 主分支发布与当前线上回归（2026-10-09）

授权接续：用户在四个 PR 检查通过后要求“继续推进”，随后多次“继续”，按已有交付计划推进合并、自动部署核验、线上回归及闭环回填。四个 PR 使用普通 merge，前置部署验证完成后才推进下一单元；后续 PR base 依次调整为 `main`，未重写分支历史。第 1.1 节的提交阶段授权和第 11 节开放状态为当时快照，不覆盖本节实际进展。

| 单元 / PR | 主分支合并 SHA | Foundation | 部署 | 实际结果 |
| --- | --- | --- | --- | --- |
| A / #16 | `c751f7650710f6449c89fb39df239406d2229e32` | [#86](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37903250150) | [#16](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37903970417) | success；完整 SHA、镜像、健康及 HTTP 核验，资源指纹更新 |
| B / #17 | `16df3966313e8e7e122e66e64d5fe5e01f15b3e4` | [#87](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37905272706) | [#17](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37905983459) | success；完整 SHA、镜像、服务及 HTTP 核验，资源指纹更新 |
| C / #18 | `5d09514062c5e23fe12c1a912fe4d9fc59933728` | [#88](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37908352387) | [#18](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37909132094) | success；完整 SHA、镜像、健康及 HTTP 核验，资源指纹更新 |
| D / #19 | `acc4c152943fa2bec4df163c91d1b6a0a904fe18` | [#89](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37910622823) | [#19](https://github.com/JasonShu0722/QMS-2.0/actions/runs/37911264832) | success；最终整合版本完整 SHA、镜像、健康及 HTTP 核验 |

最终线上 `/login` 与 `/api/v1/openapi.json` HTTP 200。主 JS 为 `/assets/index-BJgvy3rE.js`，SHA256 `fb6d81e99ebe2a84c25c114d92b39bf1ad82b9ac1f0667fec08f1242f1c592ea`，与本地完整验收构建逐字节一致；无待应用迁移。四个实际 PR 均已回读 merged，活动本地 `main` 已快进到最终 SHA，与 D 已验收源码树一致。上述是部署事实，不代替最终业务验收。

### 12.1 最终线上已读证据与缺项

公开登录页的两个工具入口可见，反馈入口隐藏；C 部署版本已实测原生 Enter / ArrowDown / Enter 语言切换、菜单关闭和焦点返回、外观抽屉，最终版本登录页也实际读取。最终整合版本 Chrome 会话实际读取工作台和供应商台账：内部领域名称符合设计、知识入口隐藏、待办只保留卡片、必要未接入提示保留、供应商问题台账标题 / 顶栏 / 工作标签一致、条码入口归属供应商质量且旧路径 `/app/site-scanning` 保留、内部反馈按钮可见。用户明确当前会话为管理员；不把首屏菜单或用户的管理员声明等同于全部权限场景验证。

首次插件连接阻塞在用户继续后恢复，但读取上述两页后连接再次断开；重置后 Chrome 已不在可用浏览器列表中，未读取或复制会话凭据、未自行修改扩展注册。仍缺管理员系统服务入口 / 流程对象层级 / 未保存保护、其他权限角色与供应商门户、最终语言 / 外观 / 标签 / 弹窗 / 拖动联合回归和真实触屏设备证据。当前为部分线上验证，四个 Issue 保持开放；实际未具备项不写 PASS。

### 12.2 Issue 与飞书实际同步

Issue #12～#15 已追加最终 SHA、真实发布 / 验证证据与待验收项并回读为 open。五条飞书记录按原 record_id 最小回填 `Issue 链接`、`PR 链接`，在 `子任务清单` 末尾追加实际部署记录与批准实现差异；A 两条共用 Issue #12 / PR #16。全部逐条写前核对、写后回读，原方案要点、验收标准、负责人和完成时间未修改；机器人初稿保留可追溯历史，不执行其数据库迁移建议。

飞书 `进度状态` 虽存在“已上线”选项，但 API 返回 `ignored_fields` / `READONLY: select field is a stage field. Ask the user to modify its value manually in the Base web app.`；初次响应即停止重复写该字段。实际状态仍为“开发中”，不能报告阶段已更新。URL 字段回读按 Markdown 链接规范化；首条已写成功后先回读确认，仅接续剩余字段 / 记录，没有重复追加交付段。

原始快照、写入回执、逐行回读结果位于 Git 外 `publication/lark-release-confirmed.json`、`REQ-xxxx-write-response.json`，发布探针与映射位于 `release-probe-<完整 SHA>.json`、`release-status.json`。接续点是恢复浏览器完成最终回归，具备全部对应证据后再关闭 Issue；阶段字段由网页端按真实阶段调整，最终完成时间只在实际闭环时登记。

本次沿用既有交付要求，不新增通用规则；阶段字段只读与浏览器连接中断是本轮操作限制，具体记录留在专项，不扩大成产品或权限修改。本节为本地接续记录，尚未另行提交或推送，不重开已合并 PR。

## 13. 负责人手动最终验收与闭环（2026-10-09）

负责人在本线程要求改为手动确认，收到清单 1～8 后明确回复“都确认完了，没问题”；确认记录时间为 2026-10-09 20:09:54（Asia/Shanghai）。本次以负责人手动最终验收 PASS 记录，覆盖 REQ-0007 / REQ-0010 的名称、条码归属、旧 URL、独立权限与流程对象 / 未保存层级，REQ-0008 的卡片与跨页文案，REQ-0006 的语言 / 外观 / 持久化 / 响应式 / 键盘，REQ-0009 的双门户、鼠标与真实触屏各连续 10 次拖动、防误开、贴边 / 记忆 / 缩放、安全表单跳转、弹窗层级及打印，以及受影响联合交互。

最终部署版本仍是 `acc4c152943fa2bec4df163c91d1b6a0a904fe18`，没有因本轮接续修改功能源码或重新发布。部署、CI、镜像、HTTP 与资源指纹沿用第 12 节同版本实际证据。用户未单独提供浏览器版本、设备型号或截图；如需这些明细，后续补充人工证据，不伪造代理浏览器日志。第 10～12 节的未完成项和连接限制保留为阶段历史，以本节最终确认及实际外部状态为准。

| 需求 | Issue / PR | 最终验收来源 | 实际外部结果 | 完成时间（Asia/Shanghai） |
| --- | --- | --- | --- | --- |
| REQ-0007 | [Issue #12](https://github.com/JasonShu0722/QMS-2.0/issues/12) / [PR #16](https://github.com/JasonShu0722/QMS-2.0/pull/16) | 负责人手动 PASS | Issue completed；飞书已结束、链接与记录回读一致 | 2026-10-09 20:11:06 |
| REQ-0010 | [Issue #12](https://github.com/JasonShu0722/QMS-2.0/issues/12) / [PR #16](https://github.com/JasonShu0722/QMS-2.0/pull/16) | 负责人手动 PASS | Issue completed；飞书已结束、链接与记录回读一致 | 2026-10-09 20:11:06 |
| REQ-0008 | [Issue #13](https://github.com/JasonShu0722/QMS-2.0/issues/13) / [PR #17](https://github.com/JasonShu0722/QMS-2.0/pull/17) | 负责人手动 PASS | Issue completed；飞书已结束、链接与记录回读一致 | 2026-10-09 20:11:12 |
| REQ-0006 | [Issue #14](https://github.com/JasonShu0722/QMS-2.0/issues/14) / [PR #18](https://github.com/JasonShu0722/QMS-2.0/pull/18) | 负责人手动 PASS | Issue completed；飞书已结束、链接与记录回读一致 | 2026-10-09 20:11:17 |
| REQ-0009 | [Issue #15](https://github.com/JasonShu0722/QMS-2.0/issues/15) / [PR #19](https://github.com/JasonShu0722/QMS-2.0/pull/19) | 负责人手动 PASS | Issue completed；飞书已结束、链接与记录回读一致 | 2026-10-09 20:11:28 |

四个 Issue 先补齐实际验收范围、限制、回滚及复盘记录，再以 `completed` 关闭并逐一回读。五条飞书阶段由负责人在网页端从已上线经上线验收完成调整为已结束；写入前已逐条回读确认，未尝试绕过阶段字段 API 只读限制。随后只写入对应 Issue 实际关闭时间及最终验收 / 闭环记录，写后逐条核对阶段、时间、REQ、Issue / PR 链接和原方案 / 验收标准未变；A 两条分别保留记录，共用 Issue 的同一完成时间。

证据在 Git 外本轮 `publication/closed-issues.json`、`lark-closure-confirmed.json`、`REQ-xxxx-closure-before.json`、`REQ-xxxx-closure-response.json`。首次状态回读处于负责人网页操作过程中的上线验收完成，未写入；随后回读五条均已结束后才接续，未覆盖并发修改。日期写入及回读统一采用 Base 的 Asia/Shanghai 时区。

项目交付、规则沉淀和本轮复盘已完成：沿用权威交付流程的分组、最终回归、顺序关闭 / 回填、幂等接续及真实证据要求；没有新增需独立沉淀的通用规则。外部五条需求闭环完成，本轮文档记录增量仅在本地更新，尚未另行提交 / 推送，不创建额外 PR 或更新已合并 PR 的源码。

## 14. 全过程复盘与执行规则完善（V0.0.5）

负责人在五条需求闭环后要求通盘复盘并完善 Skill / AGENTS，强调“什么时候创建 issue、什么时候推 PR 都要明确自觉做起来，不能总是等我提醒”；同时明确“只涉及文档变更不需要 issue 和 PR，版本号可以使用 V0.0.5”。本次仅更新项目 Markdown、Skill / AGENTS 文本和文档索引，保留此前四份未提交结案文档；不重开已结束需求、不新建 Issue / PR、不修改运行代码、契约、依赖、CI、部署或表格权限。

### 14.1 本轮实际过程与改进落点

五条记录按目标拆成四个 Issue / PR，其中 A 合并两条共同导航目标；独立部分并行、共享文件统一整合。真实服务验证、规格与质量审查后拆分提交；C 的 CI 发现附件测试异步竞态，确定性红绿和原分片复验后接续原 PR；A～D 普通合并、逐单元主分支检查及自动部署核验。浏览器连接多次中断后，负责人改用明确清单手动验收；四个 Issue completed，五条台账链接 / 阶段 / 实际完成时间回读一致。

| 实际问题或规则缺口 | 本轮经验及最小要求 | 权威落点 |
| --- | --- | --- |
| Issue 顺序需要负责人纠正，PR 动作曾留到提醒后 | 批准常规修复后先查重 / 建 Issue；验证审查后主动提交 / 推送 / 建 PR。单独状态仅本地、只策划 / 只本地限制、纯文档免 Issue / PR 分开 | [交付流程](../../../qms-2.0/docs/DELIVERY-MAINTENANCE-PROCESS.md)第 1.1～1.2 节；根 / 工程 AGENTS 与接单 / Superpowers / 功能交付 Skill 仅路由 |
| 多个命令进程重复落到 Node 22 | 用于实现 / 验证的新 Windows shell 加载活动入口并核对版本；不能继承另一终端的假设 | [工程工具](../../../qms-2.0/docs/ENGINEERING-TOOLS.md) |
| 整合时曾在源码变化期间跑全量测试；临时索引丢失 sparse 标志产生大量归档删除提示 | 文件所有权覆盖共享 Git 状态；先读状态，冻结验证源码；索引 / 分支 / 合并由主代理串行，稀疏语义与行尾按项目保持 | 工程工具；工程 AGENTS / Superpowers 保留入口 |
| 整合测试和四个分支验证容易混记，堆叠 PR 改 base 后证据不明确 | 核对逐 PR base / head / 归属 / 依赖及检查覆盖；整合快照不冒充全部独立快照；不重复跑无关全量业务验收 | 交付流程第 2.4～2.5 节 |
| 浏览器断连、登录、MFA 与角色权限曾混在一起判断，首屏被误判为普通账号 | 优先正常会话，按工具现态接续；重复失败无新证据换可用会话或人工清单；实际角色允许 / 拒绝另核验，不复制凭据或改扩展安全配置 | 工程工具 |
| 人工最终确认没有通用记录口径 | 绑定批准清单与最终 SHA；代理、CI、人工来源分开，只勾实际覆盖项目；不编造版本 / 设备 / 截图或自动日志 | [开发治理](../../../qms-2.0/docs/DEVELOPMENT-GOVERNANCE.md)证据格式；交付流程第 2.5.1 节 |
| Base 返回总体成功但阶段字段被忽略；URL 包装与日期时区曾被当作写入不一致 | 看字段回执，READONLY 停止重试；网页人工转换后回读，URL / 日期按语义比较，部分成功只补未完成字段，事件时间不等于同步时间 | 交付流程第 2.7 节 |
| 已关闭需求的文档增量仍未提交，导航一处仍写暂未实施 | 分开报告外部闭环与 Git 归档；当前入口同步真实状态，阶段历史保留；纯文档推 main 若触发 CD 仍核对发布授权 | 交付流程完成定义及文档导航 |

附件测试修复已有受控请求红灯、相邻绿灯、原 CI 分片及远端检查，不再新增泛化超时或重复门禁。角色设备及浏览器明细的未提供情况仍按第 13 节人工来源保留，不将新规则追溯为代理执行过的事实。盘符、具体版本、四个交付单元和五条记录仅留专项，不提升为其他项目的通用约束；负责人持续授权仅适用于本项目。

### 14.2 规则验证与提交边界

只读代理 `workflow_skill_baseline` 对旧规则执行四个压力场景，发现先建 Issue 的优先分支、简短“继续”接续、人工验收及 READONLY / URL 语义回读缺少明确口径；其决策部分依靠上层指令推断，不把该规则检查冒充业务测试红灯。`execution_rules_audit` 独立核对共享 Git、进程环境、堆叠 PR、浏览器恢复和人工证据来源，指出五处可复用缺口，也确认既有附件修复与验收口径无需重做。

修订后用全新 `workflow_skill_forward` 上下文检查九个执行 / 停止场景，并由 `execution_rules_audit` 复核实际差异；结构校验使用 skill-creator 的 `quick_validate.py`，文档与来源校验使用 `check:governance` / `git diff --check`。具体最终结果在本节接续记录。验证日志保存在 Git 外 `D:/WorkSpace/QMS-2.0-local/acceptance/2026-10-09-navigation-repair/governance-v005/`，不访问生产系统或新增表格写入。

提交版本使用负责人确认的 V0.0.5，本轮免 Issue / PR。仅验证和本地提交不会更新线上；目标分支推送是否触发自动部署另核对授权，不为文档同步改 CI 来绕过该边界。

最终验证：三个 Skill 的 `quick_validate.py` 均 exit 0；首次本机 Python 默认 GBK 读取 UTF-8 失败不作为成功，使用 UTF-8 模式及既有 PyYAML 依赖重跑通过，未改校验器或新增依赖。全新上下文九个场景 A～I 均正确区分执行、授权、证据和停止条件；这是规则推演，不是业务回归。独立质量代理两轮复核无阻断，环境条款过宽和接单入口措辞两项建议已修正。

`check:governance` PASS / exit 0（36 文档、214 本地链接、18 来源复核、115 模块依赖对）；`test:governance` 48 PASS / exit 0，无 Skip；归档隔离与差异检查 exit 0。七个受影响索引条目按已读内容复核并更新理由 / 来源摘要，未批量刷新无关文档。最终提交仅含 13 份 Markdown / Skill / AGENTS / 文档索引，包含第 12～13 节此前未提交的实际闭环记录，无运行源码或产品配置变更。

本轮按 V0.0.5 做本地提交，不新建 Issue / PR，也不推送触发自动部署的 main。具体提交 SHA 由 Git 记录及会话交付，避免在其自身源码中循环登记；线上最终业务版本仍为第 13 节所列 SHA。日志为 Git 外 `governance.log`、`governance-tests.log`、`review-matrix.json`、`forward-scenarios.json`。纯文档不重跑数据库、Web/API 和真实设备业务验收。
