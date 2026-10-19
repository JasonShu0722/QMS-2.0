# QMS Actions 触发与重复范围优化实现计划

## 当前摘要（2026-10-19，Asia/Taipei）

- 批准与规格：负责人在复盘后要求“继续”，执行[第一步设计](../specs/2026-10-19-qms-actions-economy-design.md)；不执行第二步模块分流或 PR/main PASS 复用。
- 授权：负责人后续要求推进合并上线，并在仓库再次公开后明确“继续”，覆盖本项原PR53的CI、检查通过后的合并及部署；Issue关闭和台账写入仍未授权。早期仅本地/PR范围保留为历史，不作为当前阻断。
- 映射：本聊天直接工程维护需求，无飞书 REQ/record_id；[Issue #52](https://github.com/JasonShu0722/QMS-2.0/issues/52) → `codex/actions-trigger-economy` → 同 Issue 关联的唯一草稿 PR。版本 V0.0.20，已查开放 PR 无同版本；实际 PR URL、完整 head 和最新 CI 在 Git 外 `D:/WorkSpace/QMS-2.0-local/actions-economy-release-checkpoint.json` 接续，不为回填编号额外推送。
- 基线：原始main `395acc27ef0e1bd28cf032ba8096dd38f509350c`；当前本地已接入D合并main `a8871e4829cb2d1a44f57687ccaa52e168e797ab`，该版本实际部署及HTTP联合核验已通过，随后集中推送；活动 checkout 起始干净，仅在原位功能分支隔离，不使用 C/E 回退目录或新增外部 worktree。原 D 分支 `codex/req-0020-audit` 保留。
- 分别状态：原PR53 head326b4cc已合并为main c7dc86b，PR CI39205068129、main CI39207200414和Deploy39207880874全部PASS；生产镜像/快照/迁移/健康及HTTP已核验。早期本地中断/账单失败保留历史，不冒称本地全量PASS。
- 证据与限制：Node 24.21.0 / pnpm 11.19.0；用量证据 `D:/WorkSpace/QMS-2.0-local/req17-21-actions-usage-review-20261019.json`，占用非账单分钟。早期账单失败已由公开仓库运行恢复，保留历史，不因它重复触发。
- 下一动作：本项代码、完整云端CI、合并部署和full模式实际门禁已完成。仓库已私有，不为状态同步触发CI；documentation真实调度与长期节省效果未实测，待后续实际文档交付/用量数据观察，Issue52保持开放。

> 面向执行代理：使用项目 QMS Superpowers 和 subagent-driven-development；只修改明确文件范围，Git 由主代理串行执行。

**目标：** 纯文档轻量检查且不执行生产操作，同次 integration 只构建一次 API。

**架构：** 新增无第三方依赖的 CI 范围及结果判定脚本，复用既有 validation-impact documentation 规则。保留业务全套门禁和 foundation 稳定汇总；deploy 读取原始运行指定 attempt 的 job 结果后再决定是否 SSH。

**技术栈：** Node.js 标准库、node:test、Git、GitHub Actions。

## 文件范围与责任

| 所有者 | 文件 | 职责 |
| --- | --- | --- |
| 实现子代理 | `qms-2.0/scripts/ci-validation-scope.mjs` | Git 差异分类、结果判定、来源 attempt job 查询 CLI |
| 实现子代理 | `qms-2.0/test/ci-validation-scope.test.mjs` | 真实 Git、允许/拒绝、工作流接线及 Worker 入口测试 |
| 实现子代理 | `.github/workflows/qms-2-foundation.yml`、`qms-2-deploy.yml` | 分类、分流、稳定汇总及部署前门禁 |
| 实现子代理 | `qms-2.0/apps/api/package.json` | 独立自动构建入口、同次已构建入口 |
| 主代理 | 本设计/计划、`qms-2.0/package.json` | 纳入默认测试、接续状态 |
| 主代理 | `qms-2.0/docs/DELIVERY-MAINTENANCE-PROCESS.md`、`ENGINEERING-TOOLS.md`、`FOUNDATION.md`、`governance/documentation-index.json` | 推送/重跑纪律、命令说明、实际验证、来源摘要 |

## 任务与验证步骤

### 任务 1：实现与单元验证

- [x] 建立上述测试文件，使用临时真实 Git 仓库构造 root → 业务提交 → 文档提交，验证 PR 整体仍 full，push 多提交差异仍 full；重命名代码到 docs 必须 full。
- [x] 先执行 `node --test test/ci-validation-scope.test.mjs`，确认新行为尚不存在而失败，保留 Git 外日志。
- [x] 实现文档分类：`paths.length > 0 && paths.every(path => path.endsWith('.md') && matchesDocumentationRule(path))`；异常和空差异返回 full。
- [x] Foundation 增加 scope；业务 job 使用 `needs.scope.outputs.scope == 'full'`，汇总使用 `if: always()`，检验预期结果组合。
- [x] deploy 查询 `workflow_run.id` 和 `workflow_run.run_attempt` 对应的 job 列表；检查唯一名称与所有预期结果，拒绝缺失/重复/失败/混合，只有 full 执行 SSH。
- [x] 保留 `test:worker-process` 构建语义；CI 已构建入口直接运行 `worker-process-schema.integration-spec.ts`。
- [x] 定向测试绿灯，子代理报告改动、红绿灯、未覆盖风险，不提交/推送。

### 任务 2：主代理整合、审查与最终验证

- [x] 默认 workspace 测试加入新的 `ci-validation-scope.test.mjs`；权威交付文档增加集中推送/同根因不重跑纪律，工程工具说明分流和已构建入口，不改 Skill。
- [x] 更新来源摘要，执行治理、workspace 全部 71 项（覆盖治理子集）、归档和串行契约检查；实际命令/失败前置/成功结果在 Git 外日志与下节记录，不重复跑治理子集。
- [x] 独立规格审查后质量审查，发现实际问题返修并复审；主代理确认 diff 和最新结果。
- [x] 执行 API/Web、构建、真实 PG/Worker 与 Compose 并保留部分覆盖和失败：见顶部及下节，不将全量 PG/未执行 Web 记 PASS；预览 55440 未使用，四个本任务一次性容器及卷和临时秘密已清理。
- [x] 本地记录最新完整CI/部署/HTTP结果与历史限制，治理和diff按本次文档复验。

### 任务 3：提交与接续

- [x] 固定版本和head/base，向原PR53集中推送并完成合并。
- [x] 最新PR与main完整检查通过，未改账单、额度、凭据或检查规则。
- [x] 报告最新PR/main CI和部署实际结果；不以旧PASS替代。
- [ ] full真实调度及生产门禁已核验；documentation真实调度和长期节省效果保留待观察，Issue关闭待相应授权。

## 规则沉淀与非目标

推送/重跑纪律只维护在交付流程；操作方式维护在 ENGINEERING-TOOLS；分流专项算法在本设计和源码。保持单一权威来源。无 UI/API/数据库/权限业务变更，不要求真实登录页面验收；真实 GitHub 调度未执行时仍列限制。API/Web/真实资源测试用于保护 CI 接线，不新增业务能力声明。

## 执行中的验证范围调整

- 实现、独立规格与质量审查已完成。规格审查发现提前跳过矩阵时显式 name 表达式不求值；实现者先取得两项红灯再删除显式 name，documentation 精确匹配默认 `web-tests`，full 仍要求四片；规格复审与质量审查均 PASS。子代理 `01a15185-f138-70e0-ba2f-512db4d452cc` 实现，`01a1518d-178f-76a1-bfbd-1bc5e1d108c5` 规格审查，`01a15194-766d-70f0-a1f8-b229141fe226` 质量审查。
- 主代理 API 全单测 50 suites / 557 tests PASS；Web 第一分片 22 files / 135 tests PASS，耗时 803 秒。因本轮不修改任何 API/Web 业务源码，后续本地 Web 第二分片主动中断、第三/四分片未执行，改为优先完成真实 Worker/PG、构建及 CI 判定本身的验证。中断不计 PASS，不将该选择解释为全量 Web 已通过；云端四分片完整保留，仍是业务发布前置。
- 本机 pnpm 自动依赖检查遇到加密 `.cmd` shim 无法执行，改用已安装官方 `pnpm.mjs` 的同版本入口，并执行 frozen-lockfile 安装；未修改依赖、锁文件或企业加密设置。另一次嵌套 Node spawn UNKNOWN 及并行契约检查 Prisma `VirtualAlloc failed` 发生在 Windows 可提交内存约 1 GB 时，失败日志保留，后续串行验证；不将环境失败改为业务 PASS 或修改生成契约。
- 治理与工作区命令已执行，工作区 71/71（含新 CI 13 项）PASS；其覆盖既有 `test:governance` 的文件，因此不额外重复运行同一子集。最新失败与成功分别保存在 Git 外 `actions-economy-static-validation.json`、`actions-economy-validation.json` 和具名日志，最终结果在顶部摘要接续。
- 全量 PG 只观察到头像连续替换场景 5000 ms 超时，执行进程随后不可接续且日志没有完整结束摘要，因此记 FAIL/中断，不推断其余套件成功。新建空库 `qms_actions_economy_worker`（同一任务容器/55040）迁移与 seed 后，原样头像套件 8/8 PASS，未增加 timeout；编译后 Worker 8/8 PASS，`worker.js` 执行前后时间戳和 SHA-256 不变，确认本次入口未二次构建。Compose 两组合 PASS。清理服务释放内存后，原契约脚本 `node scripts/check-openapi-sync.mjs` 串行 PASS，未改生成文件。
- `actions-economy-cleanup.json` 记录四个本任务容器及卷和临时环境秘密文件已删除；日志与摘要保留。两份 workflow 的 actionlint v1.7.12 PASS，下载资产摘要匹配 GitHub release。保护规则只读 API 返回当前私有仓库方案不支持的 403，本次未改变规则，工作流中的汇总不冒称已配置平台强制保护。


## D主线接续准备（2026-10-19）

D PR51当前fix6完整CI39202592968全部8jobs通过（API590项、真实PG81套872项、Worker8项），已合并main a8871e4，main完整CI39203301651亦通过；部署39203879250已核验PASS：完整源码/镜像SHA a8871e4、迁移前加密快照先于迁移、API/Web健康及Worker启动完整；线上HTTP/契约/资源联合核验通过。本项随后集中推送整合候选。

只读独立接续审查01a1528c-2c10-7652-afd7-5813d8e348e6确认D新增App与审计测试不会使scope/部署结果门禁/Worker复用失效；三方预测仅FOUNDATION冲突，实际一致。活动checkout仅使用 `D:/WorkSpace/QMS-2.0`；报告中的其他映射路径不作为执行入口。

本地整合后workspace71/71、治理、OpenAPI同步、API/Web类型及生产构建、归档隔离与Compose foundation/scanning解析均PASS，原大包告警保留。业务源码及生成契约相对D main无差异，workflow/CI脚本与原PR53已双审版本无差异，不重复执行同一完整业务子集；最新完整Web/API/PG/Worker由更新后的PR53 CI提供，不能拿D的PASS替代。此前全量PG中断与不完整Web结果均保留历史。

规格复核记录：原Actions第一步范围及D保留PASS；唯一P3为当前未完成清单仍写“无合并授权”，主代理已按负责人现有授权修正，不降低完整CI与部署门禁。


## 最终上线事实（2026-10-19）

PR53已合并V0.0.20 `c7dc86b21ba6bb72cea3c3ccfabda1955e26de90`；CI39205068129、main39207200414与部署39207880874成功。full实际门禁已执行SSH并完成部署；documentation模式仅有本地测试证据，未伪造真实调度PASS。
审查评论4310642935认为jobs不存在run_attempt；现场指定attempt接口返回9个job，字段均存在，已在原评论下解释并保留响应。原校验保留、13项scope测试复验通过，无对应源码修复；不重复触发CI。整合质量复核未签发最终PASS的事实保留，不能写成该轴完成。
