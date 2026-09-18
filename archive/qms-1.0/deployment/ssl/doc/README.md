# SSL Certificate Configuration Guide

## 证书文件说明

本目录用于存放 SSL/TLS 证书文件，用于 HTTPS 加密通信。

### 所需文件

1. **fullchain.pem** - 完整证书链（包含服务器证书和中间证书）
2. **privkey.pem** - 私钥文件
3. **dhparam.pem** - Diffie-Hellman 参数文件（可选，用于增强安全性）

### 证书获取方式

#### 方式一：Let's Encrypt 免费证书（推荐）

```bash
# 安装 certbot
sudo apt-get update
sudo apt-get install certbot

# 获取证书（需要域名已解析到服务器）
sudo certbot certonly --standalone -d qms.company.com -d preview.company.com

# 证书文件位置
# /etc/letsencrypt/live/qms.company.com/fullchain.pem
# /etc/letsencrypt/live/qms.company.com/privkey.pem

# 复制到本目录
sudo cp /etc/letsencrypt/live/qms.company.com/fullchain.pem ./fullchain.pem
sudo cp /etc/letsencrypt/live/qms.company.com/privkey.pem ./privkey.pem

# 设置自动续期（Let's Encrypt 证书有效期 90 天）
sudo certbot renew --dry-run
```

#### 方式二：购买商业证书

从证书颁发机构（CA）购买证书后，将以下文件放置到本目录：
- 服务器证书 + 中间证书合并为 `fullchain.pem`
- 私钥文件命名为 `privkey.pem`

#### 方式三：自签名证书（仅用于测试环境）

```bash
# 生成自签名证书（不推荐用于生产环境）
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout privkey.pem \
  -out fullchain.pem \
  -subj "/C=CN/ST=Shanghai/L=Shanghai/O=Company/CN=qms.company.com"
```

### 生成 DH 参数文件（增强安全性）

```bash
# 生成 2048 位 DH 参数（需要几分钟）
openssl dhparam -out dhparam.pem 2048

# 或生成 4096 位（更安全但更慢，需要更长时间）
openssl dhparam -out dhparam.pem 4096
```

### 文件权限设置

```bash
# 设置正确的文件权限
chmod 644 fullchain.pem
chmod 600 privkey.pem
chmod 644 dhparam.pem
```

### 证书验证

```bash
# 验证证书有效性
openssl x509 -in fullchain.pem -text -noout

# 检查证书过期时间
openssl x509 -in fullchain.pem -noout -dates

# 验证私钥和证书是否匹配
openssl x509 -noout -modulus -in fullchain.pem | openssl md5
openssl rsa -noout -modulus -in privkey.pem | openssl md5
# 两个 MD5 值应该相同
```

### 证书续期提醒

- Let's Encrypt 证书有效期：90 天
- 建议在到期前 30 天续期
- 可设置 cron 任务自动续期：

```bash
# 编辑 crontab
sudo crontab -e

# 添加自动续期任务（每天凌晨 2:30 检查）
30 2 * * * certbot renew --quiet --post-hook "docker compose restart nginx"
```

### 安全注意事项

⚠️ **重要提醒**：
1. **私钥文件 (privkey.pem) 必须严格保密**，不要提交到版本控制系统
2. 本目录已在 `.gitignore` 中排除
3. 定期检查证书有效期，避免过期导致服务中断
4. 使用强加密算法（TLS 1.2+）
5. 定期更新 DH 参数文件

### 故障排查

#### 问题：Nginx 启动失败，提示证书文件不存在

```bash
# 检查文件是否存在
ls -la deployment/ssl/

# 检查 Nginx 配置中的证书路径
grep ssl_certificate deployment/nginx/nginx.conf
```

#### 问题：浏览器提示证书不受信任

- 检查证书链是否完整（fullchain.pem 应包含中间证书）
- 检查域名是否匹配
- 自签名证书会触发此警告（正常现象）

#### 问题：证书过期

```bash
# 手动续期 Let's Encrypt 证书
sudo certbot renew --force-renewal

# 重启 Nginx
docker compose restart nginx
```

## 参考资料

- [Let's Encrypt 官方文档](https://letsencrypt.org/docs/)
- [Nginx SSL 配置最佳实践](https://ssl-config.mozilla.org/)
- [SSL Labs 服务器测试](https://www.ssllabs.com/ssltest/)
