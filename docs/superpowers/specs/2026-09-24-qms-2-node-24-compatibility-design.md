# QMS 2.0 Node 24 兼容性设计

## 目标

将 QMS 2.0 的唯一支持 Node.js 运行时从 Node 22.22.0 切换到 Node 24.21.0，并让本地工程、CI、Docker 构建和阶段验收使用同一版本策略。

## 范围

本次变更只处理运行时和构建链兼容性：

- workspace、API、Web 和 contracts 的 `engines.node` 统一为 `>=24.21.0 <25`。
- GitHub Actions 使用 Node `24.21.0`。
- API 和 Web Dockerfile 使用 `node:24.21.0-bookworm-slim`。
- API 的 `@types/node` 对齐到 24 系列，刷新 `pnpm-lock.yaml`。
- phase-1 验收的运行时断言和版本夹具改为 Node 24。
- 运维入口文档增加当前 Node 24 要求和验证命令。
- workspace 递归脚本通过 `corepack pnpm` 解析锁定的 pnpm，避免子进程从 PATH 选中其他 Node/pnpm。

历史验收文档中已经记录的 Node 22 环境属于冻结事实，不回写、不改述为 Node 24 证据。

## 方案

以 Node 24.21.0 作为当前 24.x 的固定验证版本，同时允许 24.x 后续补丁版本通过 `engines` 的下限约束。`packageManager` 继续使用 pnpm 11.19.0，其他生产和开发依赖保持现状，避免把运行时迁移扩大成工具链大版本升级。

版本入口必须保持一致：

```text
package.json engines  ─┐
apps/api engines      ─┼─> Node >=24.21.0 <25
apps/web engines      ─┘
CI setup-node         ───> Node 24.21.0
Docker base images    ───> node:24.21.0-bookworm-slim
phase-1 assertion     ───> process.version v24.x
```

## 验证和失败行为

- 错误 Node 版本在 frozen install 或递归脚本中产生 engine failure，不能用 warning 或跳过替代。
- phase-1 入口在非 Node 24 环境立即返回非零退出码，并明确要求 `>=24.21.0 <25`。
- `@types/node` 24 系列必须通过 API 类型检查、单元测试和构建。
- 变更完成后运行 `check:governance`、`contracts:check`、API/Web 测试、API/Web 构建和两个 Compose `config --quiet` 检查。
- 不修改 API DTO、生成契约、数据库迁移、权限、业务流程或历史验收结果。

## 风险和回滚

Node 24 可能暴露原先被 Node 22 隐藏的类型或依赖行为差异。若出现失败，先通过失败命令定位到具体包，再在当前兼容性范围内修复；不通过升级无关依赖掩盖问题。回滚边界是恢复运行时入口、`@types/node` 和锁文件到 Node 22 基线，业务代码不需要回滚。

## 完成标准

所有受控版本入口都指向 Node 24，锁文件可 frozen install，phase-1 运行时断言在 Node 24 通过，治理/契约/测试/构建/Compose 验证有退出码为 0 的新鲜证据，且历史 Node 22 验收记录仍保持可追溯。
