# QMS 2.0

QMS 2.0 是面向内部质量团队与供应商的质量管理系统。内部端按供应商、制程、客户、新品、审核等业务域组织工作；供应商端提供独立入口。账号、组织权限、受控流程、问题索引、待办通知、审计和附件扫描由共享平台提供。

当前只开发 `qms-2.0/`。`archive/qms-1.0/` 是只读历史快照，不参与构建和部署。`qms.bigshuaibee.cn` 是当前版本的单人云端联调环境；网站可访问不代表外部系统、所有业务链或正式生产发布均已验收。各领域进度和限制以[能力状态总账](qms-2.0/docs/CAPABILITY-STATUS.md)为准。

## 项目功能

| 领域 | 当前实现概要 |
| --- | --- |
| 身份与平台 | 内部/供应商账号分流、服务端会话、MFA、组织/角色权限、审计、配置、Outbox 和 Worker |
| 问题与流程 | 跨领域问题索引、问题工作空间、受控流程设计/版本/运行、待办与通知 |
| 质量业务 | 供应商质量、制程质量、客户质量、新品质量、审核管理、质量指标；交付状态因领域而异 |
| 文件证据 | 私有对象存储、签名上传/下载、对象版本、ClamAV 扫描、资源级授权 |

## 技术方案

| 层次 | 技术选型 |
| --- | --- |
| Web | React 19、Ant Design 6；Nginx 提供静态页面并代理 `/api/` |
| API / Worker | Node.js 24、NestJS 11 模块化单体；共用镜像、不同启动命令 |
| 数据与文件 | PostgreSQL 18、Prisma 7、RustFS S3 兼容存储、ClamAV |
| 边缘入口 | 同机 Nginx Proxy Manager（NPM）管理 HTTPS 证书、续期和反向代理 |
| 工程 | pnpm 11 workspace、Docker Compose；Nest Swagger 是 Web API 契约唯一来源 |

## 项目结构

```text
QMS-2.0/
├─ qms-2.0/
│  ├─ apps/api/             NestJS API、Worker、Prisma 迁移
│  ├─ apps/web/             React 页面与浏览器测试
│  ├─ packages/contracts/  Swagger 生成的前端契约
│  ├─ deployment/           Dockerfile、Compose、Nginx 配置
│  ├─ docs/                 能力状态、领域、验收和运维文档
│  └─ governance/           文档与工程治理索引
├─ docs/superpowers/        设计规格与实施计划
├─ archive/qms-1.0/        只读归档（sparse checkout 中可能不出现）
└─ README.md
```

本地开发入口是 [`qms-2.0/README.md`](qms-2.0/README.md)，完整文档见[导航](qms-2.0/docs/README.md)。以下是以 **OpenCloudOS 9、同机 NPM、域名 `qms.bigshuaibee.cn`** 为例的新 Linux 云服务器部署顺序。换域名时还要同步修改生产 Compose 的域名映射、NPM 和对象存储地址。

## 新机部署要求

- 域名已解析，NPM 已在同机运行、可在服务器重启后恢复，并管理 HTTPS 证书。80/443 由 NPM 接入；不需要 `/opt/qms2/tls/fullchain.pem` 或 `/opt/qms2/tls/privkey.pem`。
- 安装 Git、Python 3、Docker Engine 和 Compose 插件。已验证服务器为 Docker 28.4.0、Compose 2.39.2、Git 2.43.7；服务器不需单独安装项目 Node/pnpm，构建在镜像内执行。
- 检查 `free -h`、`df -h`；ClamAV Compose 设置了 4 GiB 内存上限，PostgreSQL、RustFS 和镜像构建也需要资源。
- GitHub 私有仓库使用只读 [Deploy Key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)。GitHub 不接受账号密码进行 HTTPS Git 克隆。
- 以下命令以 `root`、Bash 和尚未部署 QMS 的服务器为例；旧机器迁移数据时须保留原数据库、对象和加密密钥，不能生成新密钥后直接接旧数据。

### 1. 创建目录并克隆仓库

```bash
install -d -m 755 /opt/qms2/repo
install -d -m 700 /opt/qms2/secrets /opt/qms2/backups /root/.ssh
ssh-keygen -t ed25519 -f /root/.ssh/qms2_deploy -N '' -C 'qms2-cloud-readonly'
cat /root/.ssh/qms2_deploy.pub
```

将输出的**公钥**加入 GitHub 仓库 `JasonShu0722/QMS-2.0` 的 Deploy keys，保持只读。在 `/root/.ssh/config` 中加入下列配置；若文件已存在，合并而非覆盖：

```text
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/qms2_deploy
  IdentitiesOnly yes
```

```bash
chmod 600 /root/.ssh/config /root/.ssh/qms2_deploy
ssh -T git@github.com
git clone --depth 1 --sparse --branch main git@github.com:JasonShu0722/QMS-2.0.git /opt/qms2/repo/QMS-2.0
git -C /opt/qms2/repo/QMS-2.0 sparse-checkout set qms-2.0 docs/superpowers
cd /opt/qms2/repo/QMS-2.0/qms-2.0
git -C .. log -1 --oneline
docker --version
docker compose version
```

`ssh -T` 出现“successfully authenticated, but GitHub does not provide shell access”即认证成功。Linux 路径大小写敏感：外层 `QMS-2.0`、应用目录 `qms-2.0`。Docker 构建上下文只在内层目录。

### 2. 连接 NPM 网络与 HTTPS 路由

```bash
docker network inspect qms_network >/dev/null 2>&1 || docker network create qms_network
docker network inspect qms_network --format '{{range .Containers}}{{println .Name}}{{end}}'
```

确认 NPM 容器在 `qms_network` 上；若不在，执行 `docker network connect qms_network <NPM容器名>`。生产 Compose 给 Web 配置别名 `qms_nginx`，给 RustFS 配置别名 `qms_rustfs`。NPM Proxy Host 设为 `qms.bigshuaibee.cn` → `http://qms_nginx:80`，启用 WebSocket 和由 NPM 管理的 SSL/强制 HTTPS。

对象请求也走此域名：确保 `/qms-foundation` 及其子路径转发到 `http://qms_rustfs:9000`，保留 Host、原始路径、查询参数和请求头，不改写签名 URL。后续 `init-storage` 验证服务端签名请求，浏览器上传/下载仍需实际联调。

### 3. 在 Git 外创建环境文件

下例只在文件不存在时生成独立随机密钥，不向终端打印密钥。部署前确认域名、桶名和网络名适合目标机器。

```bash
umask 077
python3 - <<'PY'
from pathlib import Path
from base64 import b64encode
from secrets import token_bytes, token_hex
import json

path = Path('/opt/qms2/secrets/qms.env')
access_key, secret_key = token_hex(10), token_hex(20)
values = {
    'NODE_ENV': 'production',
    'POSTGRES_USER': 'qms', 'POSTGRES_DB': 'qms2',
    'POSTGRES_PASSWORD': token_hex(24),
    'QMS_RATE_LIMIT_SECRET': token_hex(32),
    'QMS_SECURITY_CURRENT_KEY_ID': 'initial',
    'QMS_SECURITY_KEYRING': json.dumps({'initial': b64encode(token_bytes(32)).decode()}, separators=(',', ':')),
    'QMS_BACKUP_KEY': b64encode(token_bytes(32)).decode(),
    'QMS_OBJECT_STORAGE_PROVIDER': 'rustfs',
    'QMS_OBJECT_STORAGE_ENDPOINT': 'https://qms.bigshuaibee.cn',
    'QMS_OBJECT_STORAGE_BUCKET': 'qms-foundation',
    'QMS_OBJECT_STORAGE_ACCESS_KEY': access_key,
    'QMS_OBJECT_STORAGE_SECRET_KEY': secret_key,
    'RUSTFS_ACCESS_KEY': access_key, 'RUSTFS_SECRET_KEY': secret_key,
    'NPM_DOCKER_NETWORK': 'qms_network',
    'WEB_PORT': '18080',
    'QMS_RECOVERY_MAIL_ENABLED': 'false',
}
with path.open('x', encoding='utf-8') as output:
    output.write(''.join(f'{key}={value}\n' for key, value in values.items()))
PY
chmod 600 /opt/qms2/secrets/qms.env
```

`WEB_PORT` 只供本机回环访问；NPM 走 Docker 网络。当前服务器的 8080 被其他程序占用，因此使用 18080。SMTP 未配置时保持找回邮件关闭；启用前按[邮件恢复](qms-2.0/docs/EMAIL-RECOVERY.md)提供真实 SMTP。`QMS_BACKUP_KEY` 要保留，但 Compose 不会自动执行备份。[对象保留和备份限制](qms-2.0/docs/DATA-PROTECTION.md)。

### 4. 按需配置同机出站代理

没有代理且下载正常时跳过。若同机代理监听 HTTP `7890`、SOCKS5 `7891`，Docker **镜像拉取**使用 daemon 代理，Dockerfile **构建过程**使用 CLI 构建代理，两者须分别配置。[Docker daemon](https://docs.docker.com/engine/daemon/proxy/) / [Docker CLI](https://docs.docker.com/engine/cli/proxy/) 官方说明。

- Daemon 的 HTTP/HTTPS 代理指向宿主机 `http://127.0.0.1:7890`。在 `/etc/systemd/system/docker.service.d/http-proxy.conf` 中配置后重启 Docker，用 `docker info | grep -i proxy` 核验；先确保代理容器能在 Docker 重启后恢复。
- `/root/.docker/config.json` 中 `proxies.default.httpProxy`、`httpsProxy` 指向 `http://<服务器内网IP>:7890`，供新建构建容器访问；容器内 `127.0.0.1` 不是宿主机。已有 JSON 要合并，不能覆盖凭据。
- Git SSH 的 SOCKS5 代理需单独配置，Docker 代理不会替 Git 生效。

### 5. 构建、迁移并初始化对象存储

以下数组只在当前 Bash 会话有效；重登后重新定义。三个 Compose 文件分别提供基础服务、NPM 网络和附件扫描。

```bash
cd /opt/qms2/repo/QMS-2.0/qms-2.0
QMS_COMPOSE=(docker compose --env-file /opt/qms2/secrets/qms.env \
  -f deployment/docker-compose.foundation.yml \
  -f deployment/docker-compose.production.yml \
  -f deployment/docker-compose.scanning.yml)

"${QMS_COMPOSE[@]}" config --quiet
"${QMS_COMPOSE[@]}" build api
"${QMS_COMPOSE[@]}" build web
"${QMS_COMPOSE[@]}" up -d --no-build postgres rustfs
"${QMS_COMPOSE[@]}" ps postgres rustfs
"${QMS_COMPOSE[@]}" run --rm api node node_modules/prisma/build/index.js migrate deploy
"${QMS_COMPOSE[@]}" run --rm api node scripts/data-protection.mjs init-storage
```

迁移应显示 `All migrations have been successfully applied`，对象初始化应显示 `STORAGE_PROTECTION_PASS`。对象桶会启用版本管理、Object Lock 和默认 **7 天 COMPLIANCE 保留**；修改保留期需在初始化前确认，并在 `run` 命令显式传入 `-e QMS_OBJECT_RETENTION_DAYS=<天数>`。不要运行开发用 `db seed`，它拒绝生产环境。

### 6. 启动并联调

```bash
"${QMS_COMPOSE[@]}" up -d --no-build clamav api worker web
"${QMS_COMPOSE[@]}" ps
curl -fsS -o /dev/null -w 'Web: %{http_code}\n' https://qms.bigshuaibee.cn/login
curl -fsS -o /dev/null -w 'API: %{http_code}\n' https://qms.bigshuaibee.cn/api/v1/openapi.json
```

首次空数据库还需创建内部管理员；使用[应用 README 的一次性管理员初始化命令](qms-2.0/README.md#生产管理员初始化)，不要使用仅供开发的 seed。初次登录按页面引导完成 MFA 注册并妥善保存恢复码。随后验证实际附件签名 PUT/GET、Worker 扫描、下载与权限拒绝；**Web/API 返回 200 只证明入口连通**。

## 推送后自动部署

仓库的 Foundation CI 对推送执行真实资源验证；CI 对 `main` 的某个提交成功后，CD 工作流才通过 SSH 将该提交部署到服务器。服务器再次确认它仍是远端 `main` 的最新提交，顺序构建 API/Web、执行迁移、更新容器，并检查 Worker 就绪信号和 HTTPS 入口。并发发布串行化；构建、迁移或健康检查失败时工作流标红，不自动回滚数据库。

首次启用还需在服务器和 GitHub 各做一次配置。**GitHub Actions → 服务器**使用独立 SSH 密钥，不复用服务器现有的**服务器 → GitHub**只读 Deploy Key。在服务器执行：

```bash
umask 077
ssh-keygen -t ed25519 -f /opt/qms2/secrets/qms-actions-ssh -N '' -C 'qms2-github-actions'
printf 'restrict %s\n' "$(cat /opt/qms2/secrets/qms-actions-ssh.pub)" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys /opt/qms2/secrets/qms-actions-ssh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
read -r -p '供 GitHub Actions 连接的公网 IP/域名：' QMS_DEPLOY_HOST
printf '%s %s\n' "$QMS_DEPLOY_HOST" "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
```

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加三个 Repository secrets：`QMS_DEPLOY_HOST` 是刚输入的公网 IP/域名；`QMS_DEPLOY_SSH_KEY` 是 `/opt/qms2/secrets/qms-actions-ssh` 的**完整私钥内容**；`QMS_DEPLOY_KNOWN_HOSTS` 是上一命令输出的整行主机公钥记录。私钥只填 GitHub Secret，不贴入聊天或 Git；核对服务器主机指纹后再保存。服务器需允许 GitHub Actions 从公网连接 SSH `root:22`。[GitHub Secrets 官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

启用前先检查服务器仓库 `git status --short`。首台服务器曾临时修改 Dockerfile/pnpm 配置以解决依赖下载超时；将这些改动与本仓库同步的版本逐项核对并整理到干净工作树，保留需要的差异，**不要用 `git reset --hard` 擦除未知内容**。随后把本地经验证的部署工作流和构建配置推送到 `main`，在 GitHub Actions 观察 Foundation 与 CD 两个运行结果；若首次因服务器工作树未清理而失败，处理后重跑失败的 CD 作业。CD 的成功只说明入口连通且 Worker 完成启动，附件、实际扫描与权限仍按发布检查清单联调。

## 手动更新、重启与恢复

手动更新前先确认提交、工作树、备份和迁移影响；新机直接克隆应是干净工作树。

```bash
cd /opt/qms2/repo/QMS-2.0
git status --short
git fetch origin main
# 确认工作树干净、目标提交的 Foundation CI 已通过后：
target=$(git rev-parse origin/main)
bash qms-2.0/deployment/deploy.sh "$target"
```

生产 Compose 给 QMS 服务配置 `unless-stopped`，Docker 重启后会自动恢复；NPM 自身的重启策略单独检查。服务器重启后先查看服务状态，若需手动恢复，从上次成功发布记录读取镜像标签；首次部署尚无记录时使用默认标签：

```bash
cd /opt/qms2/repo/QMS-2.0/qms-2.0
QMS_COMPOSE=(docker compose --env-file /opt/qms2/secrets/qms.env \
  -f deployment/docker-compose.foundation.yml \
  -f deployment/docker-compose.production.yml \
  -f deployment/docker-compose.scanning.yml)
if [[ -s /opt/qms2/deployed-sha ]]; then
  export QMS_IMAGE_TAG=$(cat /opt/qms2/deployed-sha)
fi
"${QMS_COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180 postgres rustfs clamav api worker web
"${QMS_COMPOSE[@]}" ps
```

不要对保留数据执行 `docker compose down --volumes`。备份/恢复的实际限制见[数据保护](qms-2.0/docs/DATA-PROTECTION.md)，发布与故障处理见[运维手册](qms-2.0/docs/OPERATIONS-RUNBOOK.md)。

## 开发与文档入口

- [QMS 2.0 本地开发与验证](qms-2.0/README.md)
- [能力状态与未完成范围](qms-2.0/docs/CAPABILITY-STATUS.md)
- [开发治理与验收要求](qms-2.0/docs/DEVELOPMENT-GOVERNANCE.md)
- [文档导航](qms-2.0/docs/README.md)
- [总体设计](docs/superpowers/specs/2026-09-18-qms-2.0-redesign-design.md)

所有实现、测试和 Docker 构建从 `qms-2.0/` 执行；秘密、环境文件、上传文件、日志和备份均留在 Git 外。API DTO 变化应重新生成并检查 Swagger 契约；阶段验收使用一次性真实资源，结果记录在对应阶段文档。
