# 部署目录规则

## 作用范围

本文件适用于 `qms-2.0/deployment/`。

## 权威入口

- 部署说明：`../README.md`
- 数据保护：`../docs/DATA-PROTECTION.md`
- Foundation Compose 验收：`docker-compose.foundation.yml` 与 `../docs/FOUNDATION.md`

## 必须遵守

- Docker 构建上下文必须留在 `qms-2.0/` 内。
- API 与 Worker 共用镜像但使用不同启动命令；不得引入持久化预览环境。
- 密钥、证书、环境文件、上传文件、日志和备份不得进入 Git。
- Compose 配置检查不等于镜像构建、部署成功或生产验收。
- CI 只使用一次性资源，并在成功或失败后销毁。

## 验证命令

```powershell
docker compose -f deployment/docker-compose.foundation.yml config --quiet
docker compose -f deployment/docker-compose.foundation.yml -f deployment/docker-compose.scanning.yml config --quiet
```
