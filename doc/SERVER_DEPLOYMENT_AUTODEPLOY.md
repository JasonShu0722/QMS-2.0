# 云服务器部署与自动更新方案

这份文档用于规划 QMS 部署到云服务器，并实现：

- 本地修改代码
- 提交并推送到 GitHub
- GitHub 自动触发服务器更新

当前已知条件：

- 域名：`qms.bigshuaibee.cn`
- 子域名解析已完成
- 代码仓库：`https://github.com/JasonShu0722/QMS.git`

## 一、目标方案

建议采用下面这套自动部署链路：

1. 开发者将代码推送到 GitHub
2. GitHub Actions 触发部署工作流
3. GitHub Actions 通过 SSH 登录云服务器
4. 云服务器拉取最新代码
5. 云服务器执行部署脚本
6. Docker Compose 重建并更新服务

## 二、推荐服务器结构

建议服务器目录：

```text
/www/qms
```

建议内容：

```text
/www/qms
├─ QMS/                 # Git 仓库
└─ .env.production.server backup
```

## 三、建议部署模式

建议生产环境使用：

- Docker Compose 跑整套服务
- Nginx 负责域名转发
- PostgreSQL 和 Redis 也放在同一台机器上

如果后期访问量大，再拆数据库和缓存。

## 四、部署前必须确认的事项

### 1. 服务器基础环境

需要安装：

- Docker
- Docker Compose
- Git
- Nginx 或容器内 Nginx 所需端口开放

### 2. 防火墙 / 安全组

至少开放：

- `22`：SSH
- `80`：HTTP
- `443`：HTTPS

如果你已经使用 `Nginx Proxy Manager` 承接公网流量，那么 QMS 自己不需要再单独开放新的公网端口。QMS 容器只需要监听服务器本机回环地址，由 NPM 反向代理过去即可。

### 3. 域名与 Nginx

当前仓库已经改成环境变量驱动：

- `PRIMARY_DOMAIN`
- `PREVIEW_DOMAIN`

Nginx 模板文件为：

- `deployment/nginx/nginx.conf.template`

这意味着：

- 本地开发不会被生产域名写死
- 云服务器可以直接通过 `.env.production` 注入正式域名

这里需要特别注意：

- `.env.production` 负责的是服务器部署参数
- `stable / preview` 负责的是运行入口与发布通道隔离

也就是说，`.env.production` 不会替代项目里原本的双环境设计。正式版和预览版仍然由两套前后端服务、后端 `ENVIRONMENT` 运行标识，以及用户 `allowed_environments` 权限共同决定；登录请求本身不再提交目标环境。

当前默认是 HTTP 内部监听，适合先跑通服务器环境和自动更新链路。
如果你使用的是 `Nginx Proxy Manager`，HTTPS 可以直接在 NPM 上申请和管理，QMS 容器内不需要再单独处理公网 `443`。

## 五、当前仓库还需要调整的地方

在正式部署前，至少还要处理下面几项：

1. 生产环境变量需要在服务器上整理成可用版本
2. 如果走 NPM，需要把代理目标配置为 `qms_nginx:80` 或 `127.0.0.1:${QMS_NGINX_PORT}`

## 六、推荐自动部署流程

### GitHub Actions 触发条件

建议：

- push 到 `main` 分支自动部署正式环境
- 如有 `preview` 分支，可部署预发布环境
- 两个域名都由 NPM 反向代理到 QMS 容器的本地 Nginx 端口

### Actions 核心步骤

1. 检出代码
2. 通过 SSH 连接服务器
3. 进入部署目录
4. 先用本次 workflow 注入的临时仓库令牌做一次引导式 `git fetch` / `git merge --ff-only`
5. 再执行部署脚本，例如：

```bash
cd /www/qms/QMS
bash deployment/auto_deploy.sh main
```

## 七、GitHub 需要的 Secrets

后续配置自动部署时，通常需要这些 GitHub Secrets：

- `SERVER_HOST`
- `SERVER_PORT`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `SERVER_DEPLOY_PATH`

可选：

- `SERVER_KNOWN_HOSTS`

说明：

- 当前自动部署不需要额外新增 GitHub PAT Secret。
- workflow 会把本次运行的 `GITHUB_TOKEN` 临时注入远端 shell，先完成一次引导式更新，再供 [deployment/auto_deploy.sh](/E:/WorkSpace/QMS/deployment/auto_deploy.sh) 拉取私有仓库代码使用。
- 因此服务器上的仓库可以继续保持 `https://github.com/...` 形式的 `origin`，不需要手工保存 GitHub 用户名密码。

你当前服务器建议这样填写：

- `SERVER_HOST`: 你的云服务器公网 IP 或 SSH 域名
- `SERVER_PORT`: `22`
- `SERVER_USER`: `root`
- `SERVER_SSH_KEY`: 用于登录服务器的私钥内容
- `SERVER_DEPLOY_PATH`: `/www/qms/QMS`

仓库里已经新增自动部署工作流：

- [.github/workflows/deploy-production.yml](/E:/WorkSpace/QMS/.github/workflows/deploy-production.yml)

它会在 `main` 分支收到 push 时自动执行，并在服务器上调用：

- [deployment/auto_deploy.sh](/E:/WorkSpace/QMS/deployment/auto_deploy.sh)

这个脚本会先备份服务器本地的 `.env.production`，再用 workflow 注入的临时令牌执行拉取和快进合并，最后恢复该文件，避免生产配置被仓库模板覆盖。

## 八、推荐的服务器部署目录初始化

首次部署可按这个思路：

```bash
mkdir -p /www/qms
cd /www/qms
git clone https://github.com/JasonShu0722/QMS.git
cd QMS
cp .env.example .env.production
```

如果你是在服务器上手工执行 [deployment/auto_deploy.sh](/E:/WorkSpace/QMS/deployment/auto_deploy.sh)，而仓库又是私有仓库，则需要满足下面任一条件：

- 服务器上的 `origin` 已经改成可直接访问的 SSH remote
- 先导出 `DEPLOY_REMOTE_URL`，例如带 token 的只读 HTTPS 地址
- 或者改用 GitHub Actions 触发自动部署，由 workflow 临时注入访问令牌

然后根据服务器实际情况补齐：

- 数据库密码
- Redis 密码
- JWT 密钥
- 域名
- 本地监听端口

推荐和你当前服务器兼容的值：

```env
QMS_BIND_IP=127.0.0.1
QMS_NGINX_PORT=8081
BACKEND_STABLE_PORT=8000
BACKEND_PREVIEW_PORT=8001
```

### Nginx Proxy Manager 配置方式

在 NPM 中新增代理主机：

1. `qms.bigshuaibee.cn`
2. 转发到 `127.0.0.1`
3. 转发端口填 `8081`
4. `Scheme` 选 `http`

如果你要同时启用预览版，再新增一个代理主机：

1. `preview.qms.bigshuaibee.cn`
2. 转发到 `127.0.0.1`
3. 转发端口同样填 `8081`
4. `Scheme` 选 `http`

这样两个子域名都会先进入 QMS 自己的 Nginx，再由它按 `Host` 分流到正式版和预览版前后端服务。

如果你的 `Nginx Proxy Manager` 本身也是 Docker 容器，更推荐让它加入 `qms_network`，然后直接代理到容器名：

1. 转发主机名 / IP：`qms_nginx`
2. 转发端口：`80`

这样比写 `127.0.0.1:8081` 更稳定。

如果需要先理解几份环境文件的分工，建议先看：

- [ENV_CONFIGURATION.md](/E:/WorkSpace/QMS/doc/ENV_CONFIGURATION.md)

## 九、下一步落地建议

建议按这个顺序推进：

1. 先整理生产部署配置
2. 准备服务器 `.env.production`
3. 手动完成一次服务器部署
4. 确认网站可通过域名访问
5. 再接入 GitHub Actions 自动部署

## 十、我建议的下一步

下一轮可以直接开始做这几件实事：

1. 在 GitHub 仓库里配置 Secrets
2. 手动触发一次 `Deploy Production` workflow
3. 确认服务器自动拉取并完成重建
4. 如需要，再补 `preview` 分支的自动部署

先手动部署跑通，再接自动更新，是最稳的路径。
