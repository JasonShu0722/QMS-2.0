---
name: qms-feature-delivery
description: Use when implementing QMS 2.0 features, bug fixes or cross-layer maintenance. Ordinary questions and text-only edits do not require the full feature workflow.
---

# QMS 功能交付

从活动工程 `qms-2.0/` 工作。先读该目录与目标目录的 AGENTS，再按[变更影响分析](../../../docs/CHANGE-IMPACT.md)确认本次事实拥有者、消费者和验收范围；术语或平台能力不清时才读相应领域交接。

依[交付流程](../../../docs/DELIVERY-MAINTENANCE-PROCESS.md)判断常规修复、仅本地与纯文档分支。常规修复按负责人持续授权先关联 / 建 Issue，验证与审查通过后主动提交 / 推送 / 建 PR；已有明确限制优先，不把本 Skill 当作合并或发布授权。纯文档免 Issue / PR，使用相关复核和治理，不执行无关业务验收。

接续任务可运行 `corepack pnpm task:handoff --output <Git外新目录> --plan <阶段计划路径>`，参数和覆盖限制见[工程工具](../../../docs/ENGINEERING-TOOLS.md)。交接只描述当前源码和选定计划，不证明业务完成，也不改变用户授权。

根据任务选择公开平台服务；API DTO 变化遵守原生成契约流程。不要把目录名相似当作领域可以共享专业字段的理由。新领域接入分别证明功能权限、组织/企业范围及节点授权，而非仅复制已有页面。

依[开发治理](../../../docs/DEVELOPMENT-GOVERNANCE.md)选择门禁。治理或单元测试组合只能形成该范围的证据；数据库、Worker、附件和真实登录的要求仍由阶段计划决定。可运行 `corepack pnpm evidence:collect --profile <组合> --output <Git外新目录>` 保存结果；读取总体状态和未执行项后再写交付结论。

| 实际请求 | 应采取的范围 |
| --- | --- |
| 扩展供应商正式回复 | 查供应商交接，列出不可变修订、证据、节点权限与事务影响；运行对应真实服务验收 |
| 修改工程交接脚本 | 验证源码指纹、敏感信息排除、输出路径和失败行为；不无故执行数据库迁移 |
| 只改按钮文字 | 遵循前端目录规则和相关页面验证；不创建新的领域架构 |

完成后明确实现、代理 / CI / 人工验收、发布、关闭回填和 Git 同步的各自状态，附实际覆盖、计划及证据位置。授权来源是用户而非 Skill；已有授权主动推进，部署或生产数据操作另行核对。
