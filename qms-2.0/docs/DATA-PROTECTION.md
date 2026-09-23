# TLS、密钥与数据保护

本轮交付可执行的开发治理工具和真实隔离演练。工具不会部署生产环境，也不是大容量在线备份系统。原始日志、证书、密钥和备份必须保存在 Git 外；验收禁止使用保留预览数据库 55440。

## TLS 终止

组合 `deployment/docker-compose.foundation.yml` 与 `deployment/docker-compose.tls.yml`。外部 `QMS_TLS_DIRECTORY` 提供 `fullchain.pem` 和 `privkey.pem`，`HTTPS_PORT` 默认 8443。HTTP 308 跳转保留路径及公开 HTTPS 端口。Nginx 只启用 TLS 1.2/1.3，设置 HSTS、nosniff、no-referrer，并覆写代理头；API 使用生产 Secure/HttpOnly/SameSite=Lax 会话 cookie，`QMS_TRUST_PROXY_HOPS=1` 仅适用于此单层可信代理拓扑。

```powershell
docker compose -f deployment/docker-compose.foundation.yml -f deployment/docker-compose.tls.yml config --quiet
```

生产还须配置真实域名和受信任证书、证书续期、密钥权限及实际代理拓扑。开发演练使用临时自签 CA 并显式验证该 CA，没有关闭证书验证。对象存储生产访问要求 HTTPS；基础 Compose 的本地 MinIO HTTP 默认值须按部署环境替换。

## 应用密钥轮换

`QMS_SECURITY_KEYRING` 是 key id 到 base64 编码 32 字节密钥的 JSON 映射；`QMS_SECURITY_CURRENT_KEY_ID` 指定新写入密钥。配置不进入数据库、源码或日志。MFA 当前/待确认秘密、导出内容、待发送邮件使用 AES-256-GCM，并绑定各自资源上下文作为 AAD。

1. 给所有 API/Worker/运维进程提供新旧密钥，切换 current id，新写入开始使用新密钥。
2. 构建 API 后运行 `pnpm --filter @qms/api security:reencrypt`。按 100 条批次重加密现存密文；MFA 持用户锁，导出/邮件使用密文 CAS 防止覆盖并发消费。邮件同时更新 key id。
3. 确认命令退出 0、`SECURITY_KEYS_REENCRYPTED` 成功审计及实际读取验证。任意不可解密数据返回非零；早前批次可能已完成，保留新旧密钥后可重跑。
4. 不要立即删除旧密钥。管理幂等回执只保存请求摘要，无法反向重算；旧密钥必须保留至这些回执受控到期/清理。当前未实现回执自动过期，因而本轮不能直接移除仍有回执的旧密钥。历史 legacy 摘要的秘密由 `QMS_ADMIN_LEGACY_DIGEST_SECRET` 保留，默认使用原 `QMS_RATE_LIMIT_SECRET`。

备份密钥 `QMS_BACKUP_KEY` 独立于应用 keyring。旧备份始终需要创建它时的备份密钥，须由外部密钥管理记录对应关系；上述命令不重加密历史备份。

## 对象保护与数据库恢复

配置 `QMS_OBJECT_STORAGE_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY`，可选 `REGION`（默认 us-east-1）及 `PROVIDER=s3`。运行 `pnpm --filter @qms/api data:protect init-storage`：启用版本管理、Object Lock、默认 COMPLIANCE 保留和显式删除拒绝策略；AWS S3 同时设置 Block Public Access。`QMS_OBJECT_RETENTION_DAYS` 默认 7，范围 1–3650。COMPLIANCE 期间版本无法删除，初始化前须确定目标桶和保留政策。

上传适配器生成 UUID 对象键，使用 60 秒签名 URL，签名绑定 Content-Type 和 `If-None-Match: *`，阻止同键覆盖。桶匿名读取被拒绝。此处仅说明对象保护边界；P3 已交付的资源级授权、上传完成校验、扫描及下载行为见[附件生命周期](ATTACHMENTS.md)，具体领域证据接入仍须单独验收。

备份/恢复使用本地 Docker 中的 PostgreSQL 工具，要求 `QMS_BACKUP_POSTGRES_CONTAINER` 对应 `DATABASE_URL` 的 **同一精确 loopback 地址及端口**。只接受 127.0.0.1 或 [::1]，拒绝歧义 localhost、URL 查询参数/fragment 和 55440。检查在连接与对象写入前完成。

```powershell
pnpm --filter @qms/api data:protect backup D:/QmsProtected/backup.qmsb
pnpm --filter @qms/api data:protect verify D:/QmsProtected/backup.qmsb
pnpm --filter @qms/api data:protect restore D:/QmsProtected/backup.qmsb
```

- 备份前停下 API/Worker 及其他写入者，设置 `QMS_BACKUP_QUIESCED=yes`。工具要求显式声明，不能独立证明所有外部写入已停止。
- `QMS_BACKUP_KEY` 必须为 32 字节 base64 密钥。输出路径必须绝对且解析后的父目录在 checkout 外，文件使用独占创建，不覆盖已有备份。
- 使用 PostgreSQL 导出一致快照生成 custom dump，记录成功迁移名称/校验和、全部文件引用及对象版本/摘要。P3起按数据库固定objectVersionId校验，latest改变不影响已扫描证据；可用文件必须匹配实测大小/SHA-256。未上传占位可以没有对象；隔离/扫描拒绝内容按实际对象摘要保存，不要求错误的声明哈希匹配，也不因此提升状态。存在删除标记时明确失败，先进行业务核对。
- 当前工具内存有界：dump 与对象累计分别最多 256 MiB，序列化包最多 512 MiB。超过上限失败；大容量、增量备份和持续恢复需另行设计，不默默截断。
- 恢复时显式改 `DATABASE_URL` 和 bucket，目标库名必须为 `qms_restore_` 加小写字母/数字/下划线，并设置 `QMS_RESTORE_CONFIRM` 等于该库名。拒绝原数据库、原桶、非空 public schema，以及包含任何历史版本/删除标记的桶。
- 先校验密文完整性，再恢复对象版本和数据库，逐项核对迁移、文件引用与实际对象。对象保留原字节和历史顺序，并保留尚未到期的COMPLIANCE期限/法律保留。提供者分配新版本ID后，按旧key+version映射到新版本，在隔离恢复库中原子更新引用再核验；原逻辑版本、扫描/隔离/删除事实保持不变。失败退出非零，可能留下一部分受保护对象；不要将部分恢复目标切换为业务环境，改用新的空目标重试。
- P3备份包为QMSB2/AES-GCM，包含固定版本与完整生命周期引用。历史QMSB1文件原样保留，新工具明确拒绝旧格式；恢复旧包须使用其匹配的历史工具在隔离环境恢复，再执行P3迁移及真实复核，不能将旧“AVAILABLE”直接视为已扫描。

## 可复跑验收

从 `apps/api` 执行 `node --test test/operations/data-protection-objects.test.mjs`、`data-protection.acceptance.mjs`、`key-rotation.acceptance.mjs`、`tls.acceptance.mjs`。对象与密钥轮换演练要求 `QMS_ACCEPTANCE_DISPOSABLE_DATABASE=true`、临时loopback PostgreSQL（拒绝55440）；对象演练还要求匹配容器、本任务MinIO、外部 `QMS_ACCEPTANCE_ARTIFACT_DIRECTORY` 和备份配置。主目录使用55448，密钥轮换在该实例中新建并清理随机数据库。TLS演练要求 `QMS_ACCEPTANCE_TLS_URL`、`QMS_ACCEPTANCE_TLS_HTTP_URL`、`QMS_ACCEPTANCE_TLS_CA` 及供应商seed密码。证书/凭据缺失明确失败。

真实命令、结果和资源清理状态以 [FOUNDATION](FOUNDATION.md) 最新 D–H 记录为准。生产域名、真实邮件投递信誉、云 IAM 权限与实际生产灾备恢复不包含在开发验收结论中。
