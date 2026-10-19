# 交接、验收证据与 QMS 专用 Skill

本页承接[开发治理](DEVELOPMENT-GOVERNANCE.md)与[文档复核](DOCUMENTATION-MAINTENANCE.md)。命令均从 `qms-2.0/` 执行，Windows 先加载仓库外 `Enter-Qms.ps1`。输出目录的父目录必须已存在，输出目录本身必须是 Git 外的新目录；工具拒绝覆盖旧证据。

## 执行起点与共享状态

- 每个用于实现 / 验证的新 Windows shell、子代理 shell 或恢复会话先加载 `D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`，核对实际 Node / pnpm 与工程要求；未继承已核验环境的子进程另行核对，不能假定另一终端的环境会继承。版本不符先停止，实现和验证命令不以 engine warning 下的运行作为有效证据。
- 启动实现或验证前先核对分支、HEAD、工作区、暂存区及进行中的 merge / rebase / cherry-pick。状态核对不能与依赖该状态的测试启动并行；中断后接续正在进行的步骤，不凭上一条摘要推定工作区干净或切换已完成。
- 共享活动 checkout 的文件所有权也覆盖 Git 索引与分支状态：暂存、提交、切换、合并、sparse 配置及索引操作由主代理串行执行，子代理只修改分配文件。冻结覆盖源码后再运行整合验证，运行中不同时写这些文件或切换分支。
- sparse checkout 操作前记录稀疏规则及索引状态。使用临时索引、`read-tree` 等底层操作时保持 skip-worktree / 稀疏语义，结束后核对状态和归档隔离；大量归档删除提示先视为索引异常排查，不能直接暂存或扩大 checkout。不要为压低差异修改项目行尾配置。
- 多单元拆分提交时核对各自 base、head、文件 / hunk 归属、无缺失依赖及最终整合树。相关源码未变的证据可按影响分析复用；不同分支或基线的证据不能混记。正常 Git 命令优先，底层拆分只有必要且能核验共享状态时使用；不为纯文档或简单改动重建全套业务服务。

## 任务交接

```powershell
corepack pnpm task:handoff --output D:/WorkSpace/QMS-2.0-local/handoff-p2-01 --plan ../docs/superpowers/plans/2026-09-22-qms-engineering-p2.md
```

生成 `handoff.md` 和 `handoff.json`：源码 HEAD、分支、未提交及未跟踪的改动路径、源码指纹、规则入口、知识入口和选定计划中的未勾选项。省略 `--plan` 时明确显示未选择计划；不能把没有待办行理解为已完成。

适用规则根据当前改动目录筛选，同时保留完整规则清单。任务若将进入未修改目录，必须再读取那个目录的 AGENTS。计划内容是接续资料，不自动授予新操作权限。工具会根据开放维护台账的来源文件列出直接关联的 `MAINT-*`，但间接影响仍须在任务影响分析中人工补充；事项关闭必须更新台账并提供真实证据。工具不会把历史 PASS 复制为新的验收结论。

## 验收汇总

```powershell
corepack pnpm evidence:collect --profile governance --output D:/WorkSpace/QMS-2.0-local/evidence-p2-01
```

| 组合 | 实际执行 | 不能据此声称 |
| --- | --- | --- |
| `governance` | 治理检查、治理工具专项测试、归档隔离 | 业务功能或阶段验收完成 |
| `unit` | 治理检查、现有默认 `test` | PostgreSQL、浏览器主链或生产恢复通过 |
| `phase-1` | 原 `acceptance:phase-1` | 未包含在原入口中的容器生命周期或生产放行 |
| `phase-2` | 原 `acceptance:phase-2` | 供应商阶段三主链或生产放行 |

阶段组合必须先按原验收要求准备一次性服务。工具不创建、清理或切换数据库，不降低前置条件，不连接保留预览库。缺少 npm_execpath 或运行时不满足 `package.json` 时，报告失败且步骤保持未执行；应通过上面的 pnpm script 入口运行。

生成 `evidence.md` 和 `evidence.json`，记录实际 Node/pnpm、选择组合、起止源码指纹、命令、退出码、耗时和执行状态：

- `PASS`：该步骤真实退出 0；总体 PASS 还要求所有步骤执行成功、源码前后相同且没有被安全策略排除的清单文件。
- `FAIL`：步骤失败、进程启动失败、运行时不匹配、源码发生变化或报告取得失败。
- `NOT_RUN`：前置条件或前一步失败导致未执行，不是通过或跳过验收。
- `RUNNING`：进程尚未结束或被强制中断；工具每步前后更新文件，不把不完整证据标为成功。

原始子进程输出只显示在终端，不复制进报告。报告不采集环境变量、命令输出正文或差异正文。失败后不自动重试；先查看终端与失败步骤，再使用新的输出目录重跑。

## Actions 范围与同次构建

Foundation 使用 `scripts/ci-validation-scope.mjs`，仅将既有 `governance/validation-impact.json` 的 documentation 路径规则内的 Markdown 变更判为纯文档。PR 比较完整 base/head 分支差异，main 比较整次 push before/after；空差异、无法取得历史、未知路径及混合变更走完整业务检查。设计及验收矩阵见[Actions 优化设计](../../docs/superpowers/specs/2026-10-19-qms-actions-economy-design.md)。

纯文档运行归档隔离、治理与文档测试，业务 job 记为计划跳过；稳定的 foundation 汇总校验预期状态，跳过不代表业务 PASS。deploy 在 SSH 前查询来源运行指定 attempt 的完整 job 结果，仅完整业务检查成功才执行生产操作；文档结果只记录无需部署。缺项、重复、混合或失败均停止，API 不可用同样不能部署。

integration 构建完成后使用 `corepack pnpm --filter @qms/api test:worker-process:built` 复用本次产物。独立本地运行仍用 `corepack pnpm --filter @qms/api test:worker-process`，该入口先构建；不要从另一个源码版本或工作目录借用 dist。业务 PR/main 全套门禁和 Web 分片数本轮保留。

专项定向验证：`node --test test/ci-validation-scope.test.mjs`；默认 workspace 测试也包含该项。执行频率与重跑纪律依[交付流程](DELIVERY-MAINTENANCE-PROCESS.md)，运行占用按 job 分钟累计，不把并行缩短的等待时间当成计费节省。

## 源码指纹与限制

Git 清单覆盖活动 `qms-2.0/`、根 `docs/superpowers/`、根 AGENTS/README 和 `.github/workflows/`。对覆盖文件内容计算 SHA-256，文本统一 CRLF/LF；包括未跟踪的非忽略源码及受控生成契约。删除文件保留空摘要。报告不会读取归档和已忽略文件；清单内秘密文件、证书、备份、运行产物或符号链接被排除并计数，不能据此生成完整 PASS。

该指纹不是 Git 提交，不包含仓库外环境、数据库状态或依赖安装树；短暂修改后恢复原内容也不能仅凭首尾快照识别。验收期间应冻结源码写入，后续变更需重新评估证据覆盖。报告生成后也可能过期，接续时比较指纹与来源，不把旧报告当作当前状态。

## 浏览器验收与接续

按当前可用浏览器工具及其实际返回的接口文档操作，先确认目标标签、登录会话和页面状态；工具能力、连接、登录 / MFA、角色授权分别诊断。管理员身份或某个菜单可见不能推导拥有所有业务权限；断言以实际页面 / 接口允许和拒绝行为为准。

断连或标签失效后重新读取浏览器清单，绑定本次清单中的目标标签；没有新的观察证据时不反复重试同一路径，不把连接错误报告为产品缺陷或验收 PASS。恢复工具失败时说明具体阻塞，选择可用且获准的另一验收会话，或提供[交付流程](DELIVERY-MAINTENANCE-PROCESS.md)中的人工清单，不停在重复要求用户重新连接。

负责人已选择此类连接故障按交付流程转人工验收，不将自动工具恢复作为继续开发的前置；提供版本、角色 / 环境、步骤、预期与反馈方式，保留待人工验收状态。只有用户另行要求恢复自动化或出现新的有效诊断依据时，再处理工具专项，不因工具故障反复中断其他已授权工作。

已有用户登录会话优先使用正常工具控制；不读取、复制 cookie、令牌、会话文件或绕过 MFA，不自行修改扩展注册 / 安全配置。需要用户登录或验证时保留明确的交接页面，等待实际验证后再确认身份和可操作范围；不能把收到“已连接”当作工具已连接或业务已登录。结束时恢复临时视口等验收设置，保留用户原有标签和未保存内容。

鼠标、CDP 模拟触屏与真实硬件证据分别记账；实际未提供的设备 / 角色按对应来源记录，不以模拟输入补造真实设备结论。具体恢复命令遵循所用浏览器 Skill，不在项目规则复制第三方安装或底层操作手册。

## 专用 Skill

| 入口 | 触发场景 |
| --- | --- |
| [功能交付](../.agents/skills/qms-feature-delivery/SKILL.md) | 按当前摘要推进领域 / 缺陷交付检查点，交付实际产物与下一动作 |
| [权限审查](../.agents/skills/qms-permission-review/SKILL.md) | 账号、组织/供应商、节点和附件授权的专项复核 |
| [故障诊断](../.agents/skills/qms-incident-diagnosis/SKILL.md) | 依据现象逐层查证，修复后验证防复发 |
| [QMS Superpowers 工作流](../.agents/skills/qms-superpowers-zh/SKILL.md) | 设计、计划、隔离、TDD、子代理、审查和验证的工程方法路由 |
| [飞书需求启动与接续](../.agents/skills/qms-start-development/SKILL.md) | 只读盘点、授权核验、机器人初稿评审与当前检查点定位 |

上述入口引用权威规则，不自行授予部署或生产修改权限。它们位于工程内 `.agents/skills/`；从工程 AGENTS 可直接定位。客户端扫描该工程目录后才可能加入自动发现列表，不修改全局 Skill 配置，不声称文件更新等于客户端已热加载。

### 通用技能协作边界

- 项目入口确定范围、授权和当前检查点；Superpowers 执行工程方法，Matt 技能补充具体设计、测试或审查方法。同一任务只组织一条设计 / TDD / 审查流程，已确认事实不重复访谈。
- `finishing-a-development-branch` 先复用交付流程中的有效决定；已授权 PR 或仅本地的情形直接接续，菜单只用于真实未决动作，不扩大合并、发布或删除权限。
- `code-review` 组织完整范围与规格 / 质量两轴；仓库 `code-reviewer` 仅为质量参考，被委派时只做指定维度。QMS 保留先规格后质量与独立上下文；`qms-permission-review` 提供权限专项证据，不再反向启动完整审查。
- 正式 Web 的权威依据与技术栈仍为前端目录 AGENTS 和设计规范。`frontend-design`、`design-taste-frontend`、Tailwind 等仅提供适用参考，保留既有 Ant Design、共享主题和 lucide-react，不因通用默认值新增框架、字体、图标或动画。
- 技能文件存在、可经 AGENTS 找到、客户端自动发现、工具连接、真实业务验收分别核验。Codex 的[仓库发现范围](https://learn.chatgpt.com/docs/build-skills)从会话工作目录向上扫描；根目录会话不会仅因工程内存在 `.agents/skills/` 就向下发现其入口，沿既有 AGENTS 路径读取即可，不复制第二套权威技能。新独立上下文的路由演练不冒充客户端新聊天或热加载成功。
- 浏览器正常初始化失败时保留原始错误和未执行范围；遇协议 / 信任等安全拒绝时停止该动作，不改安全策略、不换通道实现被拒绝的结果。人工证据可按已批准验收清单补充，不能据此声明自动工具已恢复。

流程与授权由[交付流程](DELIVERY-MAINTENANCE-PROCESS.md)维护，摘要与证据由开发治理维护；OpenClaw 的源码只读分析与五字段输出由[协作说明](OPENCLAW-OPS-HANDOFF.md)维护。`task:handoff` 是源码与计划快照，不自动更新顶部摘要或验证外部状态；接续时仍须人工 / 代理核对摘要和来源，不为本轮文档整合修改工具实现。

## 治理补强

文档检查自动发现活动工程内的 AGENTS 并与索引核对，排除依赖、生成物、测试产物、归档和本地原型目录；目录作用范围必须与真实路径一致。模块边界检查复用已有 TypeScript 编译器，读取语法树和 API tsconfig，检查静态导入、再导出、字面量动态导入和 require；无扩展名 Controller 同样禁止，无法静态判定的动态导入明确失败。

检查不证明数据库访问都经过公开服务，也不证明权限或事务正确；仍按[变更影响分析](CHANGE-IMPACT.md)进行对应测试和审查。本轮范围、验证与后续候选见[P2 实施计划](../../docs/superpowers/plans/2026-09-22-qms-engineering-p2.md)。
