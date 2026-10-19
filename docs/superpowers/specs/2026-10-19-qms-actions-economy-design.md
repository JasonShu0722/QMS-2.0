# QMS Actions 触发与重复范围优化设计

## 批准、目标与边界

负责人在本聊天要求“重点检讨优化触发频率以及重复范围的情况”，阅读复盘和两步方案后要求“继续”。本次执行第一步，Issue [#52](https://github.com/JasonShu0722/QMS-2.0/issues/52)，版本 V0.0.20；本地、Issue、提交及 PR 使用既有授权，合并和生产操作另核对授权。REQ-0017～0021 原分支和发布阻断独立保留，不关闭原 Issue、不写飞书。

目标是减少没有新增业务证据的运行和同次重复构建；不减少业务变更的 PR/main 门禁，不绕过账单失败。基线为 main `395acc27ef0e1bd28cf032ba8096dd38f509350c`，实现只在活动 checkout `D:/WorkSpace/QMS-2.0` 的 `codex/actions-trigger-economy` 分支。

## 现状及方案选择

已有 Git 外用量复盘记录：2026-10-17～18 触发 Foundation 57 次、deploy 18 次，包含跳过、取消和未启动项；6 个成功完整检查的 job 累计占用约 27～32 分钟/次。该占用不是账单分钟，不能承诺节省比例。

选择保守两类分流：已知纯 Markdown 文档走文档/治理，其他走完整 Foundation。相比直接 paths-ignore，此方案保留稳定的必需汇总检查，能证明计划跳过；相比按所有业务模块细分，本阶段无需重建跨模块依赖图。现有 `validation-impact.json` 的 documentation 规则只作为白名单来源，仍需 `.md` 后缀，其中脚本等可执行文件不得按文档跳过。

## 变更判定

- PR 使用事件 base/head 的 merge-base 到 head 完整差异，不能只看最新提交；base 变化后重新计算。
- main push 使用事件 before/after 的完整差异，覆盖多提交 push；不以 `HEAD^` 代替。
- 使用真实 Git `--name-only -z --no-renames`，重命名同时检查旧、新路径，避免代码移入文档目录被误判。
- 空差异、未知事件、无效 SHA、缺少历史或 Git 比较失败均走完整检查。checkout 保留完整历史。
- 文件必须同时符合既有 documentation 路径规则和 Markdown 后缀，混合变化走完整；未知路径走完整。
- 此判定只决定本次 CI 范围，不能复用旧 PR 的 PASS，也不证明任何线上业务验收。

## Foundation 与部署

新增 scope job 输出 `documentation` 或 `full`。checks 始终运行归档隔离、开发治理以及 CI 分流自身测试；文档模式补跑治理测试，完整模式保留契约和 workspace/contracts 测试。

Web 4 分片、API 单测和真实 integration 仅在 full 执行。foundation 汇总必须同时验证 scope/checks 成功，并校验 full 时业务 job 全部 success、documentation 时全部 skipped；缺失或混合结果必须失败。文档计划跳过记录明确原因，不将 skipped 写为业务 PASS。

deploy 原有同仓库 main push/成功运行约束不变。进入 SSH 前，通过 Actions API 读取**来源运行的指定 attempt** 的完整分页 job 结果，验证 scope/checks/foundation 和业务 job：full 必须有四个 Web 分片/API/integration 完整成功才可部署；documentation 识别条件判断早于矩阵展开产生的未展开 Web 跳过记录，且 API/integration 同样计划跳过，仅输出无需部署。缺项、失败、重复 job、混合结果或 API 错误均失败。访问权限仅增加 `actions: read`。不读取其他 run 或旧 attempt 来拼凑通过；若定向重跑未包含此前成功 job，则不能据此放行部署，需取得完整来源 attempt。

不创建跨运行缓存或复用制品，不更改部署脚本、镜像、迁移、加密快照或健康检查。纯文档仍可能产生一个轻量 deploy 判定 job，但不会执行 SSH、镜像构建、迁移或重启。CI 构建与生产镜像构建用途不同，本次不合并它们。

## 同次构建与执行纪律

integration 已执行 recursive build，Worker 测试应直接运行对应测试，不再构建 API。保留独立 `test:worker-process` 自动构建行为，新增明确的已构建入口供同次 CI 调用；测试验证默认入口仍构建、CI 使用已构建入口。

本地定向红绿灯和审查结束后集中推送一次；失败后按实际根因修复，不为更新状态文档反复推送。账单阻断没有外部恢复证据时只读查询，不自动重跑。后续模块分流、PR/main 证据复用、Web 分片数及 Copilot 触发策略不在本次实现范围。

## 验收、风险与回滚

用真实临时 Git 仓库覆盖纯文档、混合、重命名、多提交 push、业务 PR 追加文档、缺失历史和空差异；临时仓库销毁。结果判定测试覆盖完整通过、文档跳过、失败、取消、缺失、重复和混合状态，以及指定 attempt 和分页读取。工作流接线验证稳定汇总、真实 integration 保留、SSH 条件及 Worker 入口。

本地至少执行定向测试、治理、归档隔离、契约检查、API/Web 测试、构建、真实一次性 PostgreSQL/Worker 测试及 Compose 检查；无法具备的真实前置明确记阻断，不能替代。最新 PR CI 是独立证据，不把本地测试或历史 PASS 写成最新 CI 通过。

风险在于误分类和部署误放行，所以默认完整、部署结果严格匹配；测试不覆盖的真实 GitHub 调度保留待 CI 验证。回滚为还原本 PR，恢复原全量触发和 Worker 构建，不影响数据库结构或数据。合并后用真实每个交付单元的 runner 累计占用、无效重跑数和重复构建数衡量收益。
