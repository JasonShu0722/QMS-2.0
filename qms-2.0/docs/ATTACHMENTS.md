# 附件生命周期与领域接入

P3实现公共附件边界；专业证据关系由领域模块维护。生产默认不注册任何测试资源适配器，未知resourceType拒绝。本文随实现更新，实际验收状态见FOUNDATION，不能以接口存在代替完整阶段二验收。

## API与状态

所有入口使用真实会话，写入要求CSRF；actor、组织和对象键均由服务端决定。

| 入口 | 语义 |
| --- | --- |
| POST /api/v1/files/uploads | resourceType/resourceId、原始名、MIME、大小、声明SHA-256；要求Idempotency-Key，返回稳定fileId、隔离元数据及60秒签名PUT |
| POST /api/v1/files/:id/complete | expectedVersion和Idempotency-Key；真实HEAD核验并固定对象VersionId，返回202，仍隔离，排扫描事件 |
| GET /api/v1/files/:id | 实时领域授权后返回元数据与扫描状态，不返回对象存储凭据或内部VersionId |
| POST /api/v1/files/:id/download | 实时授权、AVAILABLE且有完整CLEAN证据后签60秒固定版本GET，强制attachment/octet-stream |
| POST /api/v1/files/:id/delete | expectedVersion CAS逻辑删除；保留对象及历史，不绕过COMPLIANCE |

初始化不论内部还是供应商账号都为QUARANTINED/WAITING_UPLOAD，上传预留有效15分钟；每个资源默认至多10个、累计25MiB，未过期预留也计入配额。签名PUT绑定Content-Type与If-None-Match，不能覆盖同键；声明不当作扫描证据。支持PDF、JPEG、PNG、UTF-8纯文本、DOCX与XLSX，由后端核验实际类型。

完成后为PENDING；Worker读取固定VersionId，在事务外计算真实长度/哈希、执行ClamAV扫描及实际类型识别。只有完整匹配且明确CLEAN才转AVAILABLE。病毒、加密或内容不符保持隔离；基础设施失败有限重试，缺配置、超时、未知响应均不放行。扫描租约120秒，过期结果或删除后的迟到结果不能发布文件。

已签发下载URL在60秒期限内可能继续有效；撤权/删除会立即阻止新签发，不能撤回已发出的短期签名。前端不缓存或持久化签名URL，下载时重新授权。

## 领域适配器

`FILE_RESOURCE_ADAPTERS`由领域Nest模块显式提供，resourceType精确唯一。`authorizeAndLock(transaction, actor, resource, action)`返回真实organizationId和资源版本；action为upload/complete/read/delete/attach。适配器必须核验自身资源、用途、组织关系及当前业务状态，供应商跨组织仍被平台拒绝。组合工作空间/报告读取中，领域 `authorizeRead` 与文件资源 `action=read` 若锁定同一领域记录，必须使用一致顺序和兼容的共享锁，禁止先 `FOR SHARE` 再升级 `FOR UPDATE`；upload/complete/delete/attach 仍按统一业务锁顺序使用排他锁。所有业务锁等待结束后重新校验会话、功能权限和领域用途授权，不能以死锁捕获重试代替正确锁序，也不能让公共读取统一持有排他锁。

业务锁顺序与runtime一致：先problem/instance/task及领域记录，再resource配额advisory锁、按ID排序的文件锁、会话复验。领域不能先锁用户再等待另一个问题资源；不得将跨资源fileId作为授权范围扩展依据。

领域提交在自己的ReadCommitted事务中调用 `FileLifecycleService.assertAttachable(tx, actor, resource, fileIds)`，再写真实专业关系及流程动作。该方法重验精确资源/组织/用途和AVAILABLE扫描证据。UI显示“扫描通过”只是当前快照，不能代替事务内复验。

共享React `AttachmentPanel`接收已授权resource、关联fileIds及readOnly，只有新上传文件实际AVAILABLE/CLEAN后才调用onReady。上传失败保留内存中的幂等键和完成阶段，可显式重试；放弃重试不物理删除对象，未完成占位按期限过期。领域负责保存或移除专业证据关系。

## 对象与扫描配置

### 本人头像资源

`IdentityModule` 注册 `ACCOUNT_AVATAR`，只允许当前会话本人作为资源；资源级上传校验将格式缩小为 JPEG/PNG、最大 2 MiB，不改变其他领域的通用附件格式和上限。头像设置再次执行 `assertAttachable` 和资源级限制，不能把公共上传路由当作绕过入口。头像移除不物理删除对象，现有版本及保留保护不变。

头像适配器的活动配额只统计当前引用及待上传、待扫描、扫描错误文件；历史非当前 CLEAN 文件保持 AVAILABLE，不导致账号终身只能更换 10 次。过滤条件始终 AND 到原组织、资源、删除及上传期限约束，未完成上传仍受 10 个及通用总大小限制；其他领域不实现该可选钩子时保持原配额语义。

浏览器头像显示沿已授权固定版本下载，再在当前会话内形成 Blob，`/me` 不下发签名 URL。对象服务必须为实际应用 Origin 允许 GET（以及既有上传 PUT）；Node 下载成功不能证明浏览器 CORS。签名最长 60 秒，退出后阻止新签发，但不能撤回已发出的短期签名或用户已下载的照片。界面效果和生产浏览器 CORS 按本轮决定部署后人工确认，未确认前不记浏览器 PASS。

对象配置沿用QMS_OBJECT_STORAGE_*，私有桶必须先启用版本与保留保护，见DATA-PROTECTION。浏览器直传需对象服务允许实际应用Origin的CORS PUT及content-type/if-none-match头；生产按应用域配置，不能把开发网关地址照搬。

Worker必需 `QMS_FILE_SCANNER_HOST`、`QMS_FILE_SCANNER_PORT`；可选 `QMS_FILE_SCANNER_TIMEOUT_MS`，默认30000。私有ClamD使用INSTREAM协议，客户端有总截止和响应长度上限；协议异常不当作CLEAN。MIME识别运行在独立线程，限时5秒；对象读取限30秒和25MiB。

组合开发Compose：

```powershell
docker compose -f deployment/docker-compose.foundation.yml -f deployment/docker-compose.scanning.yml config --quiet
```

扫描服务不发布主机端口，仅Worker加入内部file-scanning网络；配置只读、无额外能力、4GiB内存、2CPU，扫描超限/加密均报警。固定镜像已实测引擎1.5.4、签名库28122（2026-09-13），用于可复现开发验收。此固定签名库不代表生产自动更新完成；生产须在隔离环境验证更新镜像/签名、健康与拒绝路径后受控替换。COMPOSE配置验证不等于生产容器发布。

## 迁移与恢复

旧AVAILABLE没有真实扫描证据时迁为QUARANTINED/EXPIRED，旧sha256只作声明，不猜测资源归属，不自动放行。数据库CHECK要求AVAILABLE有完整实测哈希/大小/类型、固定对象版本、CLEAN时间/引擎及有效资源引用，显式拒绝NULL证据。

备份QMSB2按固定版本保存、校验并在恢复后重映射新VersionId，保留隔离、等待上传和逻辑删除事实。详细命令、格式边界、部分恢复限制见DATA-PROTECTION。

## 验证边界

真实验收使用临时PG55448、私有MinIO19048、ClamAV13348；不使用保留预览55440。标准EICAR无害测试签名在内存构造；加密无害样本与依赖、日志、扫描库均在Git外。缺真实服务不跳过。

`test/file-management/file-browser-server.mjs`仅接受明确临时qms_file_browser_*库、loopback端口和Git外夹具文件，在测试AppModule覆盖中只允许本次创建的中性资源。Web `playwright/fixtures/attachments.html`仅作为测试入口，不进入生产页面构建；生产AppModule不导入这些测试模块。
