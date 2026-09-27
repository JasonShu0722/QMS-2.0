# QMS 1.0 下线与 2.0 域名切换实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 停止并清理云服务器上的 QMS 1.0 调试部署，将 `qms.bigshuaibee.cn` 切换到通过测试/预生产验收的 QMS 2.0。

**架构：** 云服务器上的 QMS 1.0 仅用于基础调试，不保留其运行数据、卷或回滚副本；仓库中的 `archive/qms-1.0/` 仍保持只读归档。QMS 2.0 使用独立 PostgreSQL、对象存储、ClamAV、邮件接收/SMTP 和 API/Worker/Web 容器；公网 TLS 在服务器边缘网关终止，边缘网关转发到 QMS 2.0 Web 容器，Web 容器再把 `/api/` 转发到 API。

**技术栈：** Linux 云服务器、Docker Compose、PostgreSQL 18、MinIO/S3、ClamAV、Mailpit（仅测试）、Node.js 目标版本由独立兼容性变更确定、外部 Nginx 或 Caddy TLS 网关。

---

## 文件清单

本计划阶段只创建本文件，不修改归档代码、不连接远程服务器、不执行 DNS 或生产命令。执行计划时涉及的文件如下：

- 创建：`qms-2.0/deployment/docker-compose.production.yml`，生产专用 Compose 覆盖层，固定服务名、镜像标签、健康检查、重启策略和不暴露数据库/对象存储公网端口的约束。
- 修改：`qms-2.0/deployment/nginx.conf`，确认生产 Web 容器只监听内部 HTTP，并保留 `/api/` 的正确转发头；公网 TLS 和域名由主机边缘网关负责。
- 创建：`qms-2.0/deployment/edge/qms.bigshuaibee.cn.conf`，主机边缘网关的 HTTPS、HTTP→HTTPS、证书、上游、超时和安全响应头配置模板，不包含证书私钥。
- 创建：`qms-2.0/deployment/runbooks/qms-domain-cutover.md`，服务器操作、验证、2.0 回滚和旧版清理手册。
- 修改：`qms-2.0/docs/PHASE-4.md`，仅在真实测试/预生产证据完成后记录部署试点结果和未完成的生产门槛。
- 修改：`qms-2.0/docs/CAPABILITY-STATUS.md`，同步阶段四和生产准备状态，禁止把本地或预生产 PASS 写成生产已上线。
- 修改：`qms-2.0/governance/documentation-index.json`，登记新增运行手册和边缘网关模板。

## 任务 1：确认并清理 QMS 1.0 调试资产

**文件：** 无代码文件；证据保存在仓库外的部署验收目录。

- [ ] **步骤 1：记录当前公网拓扑**

  从服务器运维记录核对 `qms.bigshuaibee.cn` 的 A/AAAA 记录、TTL、证书签发方、边缘网关类型、监听端口、当前上游和容器 Compose project；不读取或复制任何密钥内容。

- [ ] **步骤 2：确认服务器仅有调试数据**

  列出 1.0 的容器、数据库容器/卷、上传卷、定时任务和反向代理上游，确认没有业务数据、正式用户、生产备份或需要迁移的上传文件；发现非调试数据时立即停止清理并重新评估，不在 `archive/qms-1.0/` 中构建、测试或启动任何内容。

- [ ] **步骤 3：停止 QMS 1.0 调试服务**

  在维护窗口停止 1.0 Compose project、定时任务和相关后台进程；不制作数据库、上传文件或卷备份，因为该环境被确认只包含可丢弃的调试数据。

- [ ] **步骤 4：定向删除 QMS 1.0 资源**

  只删除已确认属于 1.0 调试环境的容器、网络、数据库卷、上传卷、镜像、定时任务和旧代理上游；禁止执行无范围的 `docker system prune`，不得删除 QMS 2.0 资源或仓库归档。

## 任务 2：建立 QMS 2.0 生产部署边界

**文件：** `qms-2.0/deployment/docker-compose.production.yml`、`qms-2.0/deployment/nginx.conf`、`qms-2.0/deployment/edge/qms.bigshuaibee.cn.conf`。

- [ ] **步骤 1：定义独立资源命名**

  为 QMS 2.0 使用独立 Compose project、PostgreSQL 数据库/卷、对象存储 bucket、上传前缀、日志目录和备份目录；禁止引用 QMS 1.0 的数据库连接、上传卷或旧迁移链。

- [ ] **步骤 2：锁定生产服务边界**

  生产 Compose 只允许 Web/API/Worker 对外通过边缘网关访问；PostgreSQL、MinIO 管理端口、ClamAV 和内部 Worker 网络不绑定公网地址。API 与 Worker 使用同一镜像、不同命令，Worker 健康失败必须触发重启和告警。

- [ ] **步骤 3：准备公网 TLS 网关**

  边缘网关为 `qms.bigshuaibee.cn` 配置 443、HTTP→HTTPS、TLS 1.2/1.3、证书自动续期、`X-Forwarded-Proto`/`X-Forwarded-For`/`Host` 转发和 WebSocket/长请求超时；上游只指向 QMS 2.0 Web 的本机监听端口。

- [ ] **步骤 4：验证 Cookie 和代理信任链**

  保持 `QMS_TRUST_PROXY_HOPS=1` 与单层边缘代理拓扑一致；通过 HTTPS 检查 `qms_session` 的 `Secure`、`HttpOnly`、`SameSite=Lax` 和 CSRF Cookie，禁止把会话令牌写入 URL、LocalStorage 或日志。

## 任务 3：在独立测试/预生产环境部署 QMS 2.0

**文件：** `qms-2.0/deployment/docker-compose.production.yml`、`qms-2.0/deployment/runbooks/qms-domain-cutover.md`。

- [ ] **步骤 1：构建并固定发布物**

  使用目标 Node 版本构建 API/Worker/Web 镜像，记录每个镜像 digest；执行冻结安装、API/Web 构建、contracts、governance、Compose 配置检查，禁止在服务器临时修改代码或锁文件。

- [ ] **步骤 2：初始化一次性预生产资源**

  使用独立数据库和 bucket，运行 `prisma migrate deploy`，初始化生产所需安全密钥、对象存储版本保护、SMTP、ClamAV 和备份策略；不得运行开发 seed 或使用保留预览数据库 `55440`。

- [ ] **步骤 3：执行真实验收**

  通过临时预生产 URL 验证登录、退出、CSRF、账号/MFA、四阶段业务主链、附件上传/扫描/下载、Worker 消费、邮件恢复、审计、备份恢复和 HTTPS Cookie；浏览器/API 缺少真实依赖时必须 FAIL，不能以 Mock 或 Skip 代替。

- [ ] **步骤 4：完成试点观察**

  观察至少一个完整业务周期的 API 错误率、Worker 延迟、数据库连接、对象存储容量、扫描失败队列、邮件投递和备份结果；将命令、环境、镜像 digest、PASS/FAIL 和限制写入仓库外验收日志。

## 任务 4：执行 `qms.bigshuaibee.cn` 切换

**文件：** `qms-2.0/deployment/runbooks/qms-domain-cutover.md`。

- [ ] **步骤 1：宣布维护窗口并停止 1.0 写入**

  通知用户停止操作，确认 1.0 无后台任务和定时写入，保存最后访问/写入时间；域名在切换完成前仍指向 1.0，避免半切换状态。

- [ ] **步骤 2：确认旧版已清理**

  确认 1.0 容器、网络、卷、定时任务和旧代理上游均已移除；不执行 1.0 数据备份，也不保留 1.0 运行回滚副本。

- [ ] **步骤 3：启动 QMS 2.0 并执行迁移**

  启动生产 Compose，等待 PostgreSQL、对象存储、API、Worker、Web 健康检查通过，再运行迁移；迁移失败立即停止 2.0，不把失败状态暴露给公网。

- [ ] **步骤 4：切换边缘上游或 DNS**

  如果服务器未变，只更新边缘网关上游并 reload；如果服务器改变，先降低 TTL，再更新 A/AAAA，确认公网解析、证书 SAN、443、HSTS 和 IPv4/IPv6 均指向 2.0。DNS 传播未完成前不宣布上线完成。

- [ ] **步骤 5：执行公网冒烟和放行判断**

  从外部网络访问 `https://qms.bigshuaibee.cn`，验证登录、退出、CSRF、API、Web、Worker、附件和审计最小主链；只有全部通过、监控无异常且回滚命令已验证，才结束维护窗口。

## 任务 5：保留 2.0 回滚与完成域名切换

**文件：** `qms-2.0/deployment/runbooks/qms-domain-cutover.md`、`qms-2.0/docs/PHASE-4.md`、`qms-2.0/docs/CAPABILITY-STATUS.md`。

- [ ] **步骤 1：定义触发条件**

  出现数据库迁移失败、API/Web 健康检查失败、登录/CSRF 失败、附件扫描不可用、Worker 持续积压、数据完整性异常或错误率超阈值时，停止 2.0 放量并进入回滚。

- [ ] **步骤 2：执行 2.0 版本回滚**

  将边缘上游切回上一个通过验收的 QMS 2.0 镜像和配置，停止当前 2.0 入口但保留 2.0 数据库和日志供诊断；不回退到已清理的 QMS 1.0。

- [ ] **步骤 3：确认 1.0 退役完成**

  撤销 1.0 部署凭据，关闭旧端口和定时任务，确认服务器只剩 QMS 2.0 资源；不得删除归档源码或把 1.0 重新接回活跃 CI。

- [ ] **步骤 4：更新状态与证据**

  只把实际完成的 DNS、TLS、部署、迁移、浏览器、监控和回滚证据写入阶段文档；生产上线前仍保留未完成项，不使用本地或预生产结果替代公网证据。

## 验证命令

执行阶段至少保留以下命令及退出码：

```powershell
corepack pnpm --dir qms-2.0 check:governance
corepack pnpm --dir qms-2.0 contracts:check
docker compose -f qms-2.0/deployment/docker-compose.production.yml config --quiet
```

服务器侧必须额外记录：

```bash
docker compose -p qms2-production ps
docker compose -p qms2-production logs --since=10m api worker web
docker image inspect qms2-api:production --format '{{.RepoDigests}}'
curl --fail-with-body --silent --show-error https://qms.bigshuaibee.cn/api/v1/openapi.json
```

计划不包含生产执行授权；实际停服、DNS 变更、证书申请、调试卷删除和旧版退役必须在切换窗口由具备服务器权限的运维人员执行并留存操作记录。
