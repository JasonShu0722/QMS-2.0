# QMS 2.0 附件生命周期实施计划

**目标：** 在已验收的私有对象签名与版本保护上实现真实上传完成、资源授权、隔离扫描、下载/删除和联合恢复，作为P3平台能力供领域接入。

**架构：** Nest/Prisma短事务保存状态与审计，S3固定对象版本，ClamAV INSTREAM在事务外扫描；领域注册资源授权适配器，未知类型默认拒绝。不提供生产中性业务创建接口，不接触供应商专业模型或其他任务。

## 设计依据与已核实依赖

原规格附件条款要求类型/大小/数量限制、随机对象键、哈希/归属/上传人/版本/审计、隔离扫描、逻辑删除/保留和对象版本保护。旧FileLifecycleService只是底座边界：内部初始化直接AVAILABLE、调用者传bytes与clean并非真实验收证据。已交付ObjectStorage的60秒签名PUT及If-None-Match必须保留。

扫描使用官方[ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html)与[ClamD协议](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)。本机已获取并固定镜像 `clamav/clamav@sha256:9cb27d7660bdf66e9878c832cb433dd8aa152cfbe16f3c2c0084c80b04ae22b4`，实际引擎1.5.4、数据库28122（2026-09-13）。隔离容器 `qms2-main-integration-clamav` 仅发布127.0.0.1:13348，配置4GiB内存、扫描大小/递归/时间限制、AlertExceedsMax和AlertEncrypted。真实TCP探针已获得clean=OK和标准EICAR测试签名=FOUND；这是扫描环境证据，不是附件生命周期实现验收。配置/探针/原始日志在Git外。

## 文件职责

- `apps/api/src/modules/file-management/file-resource-access.ts`：资源类型注册与授权接口，动作upload/complete/read/delete/attach，由领域返回真实organizationId、版本及受控策略；空注册表与未知资源拒绝。
- `file-lifecycle.service.ts`：初始化、完成、查询、授权下载、逻辑删除、事务内assertAttachable，替换无actor占位接口。
- `file.dto.ts`、`file.controller.ts`：会话/CSRF、严格输入及Swagger。客户端不指定组织/上传人/对象键/扫描结果。
- `object-storage.service.ts`：保留PUT，新增真实HEAD、固定VersionId GET与签名GET；网络超时/大小上限，不把ETag当SHA256。
- `file-verification.service.ts`、`file-scanner.service.ts`：实测长度/哈希/类型与窄ClamAV INSTREAM客户端；总截止/响应上限/完整结束帧，只有完整OK才通过。
- `file-scan-worker.service.ts`：独立类型过滤的外部I/O消费、租约与有限重试；短事务确认扫描结果与审计，不能把S3/扫描置于数据库长事务。
- `apps/api/src/worker.ts`：接入附件扫描与过期占位维护，保持现有流程和找回邮件消费。
- `schema.prisma`和`20260919200000_attachment_lifecycle`迁移：上传期限、声明哈希/实测哈希、对象版本、扫描状态/时间/引擎/安全原因码、删除人/时间/保留期、附件幂等回执及索引/约束。
- `outbox-administration.service.ts`：受支持FileObject扫描事件的真实归属和载荷引用核验、受控重试，不外泄对象签名或原始扫描输出。
- `scripts/data-protection.mjs`与操作测试：待上传记录不强制存在对象；已固定记录校验exact version；恢复后重映射VersionId并校验内容。
- `deployment/clamd.conf`与扫描Compose覆盖文件：固定已验收镜像、私有连接、健康检查和病毒库更新说明；不用未配置扫描器冒充成功。
- `test/file-management/`：仅测试使用的中性资源适配器、真实PG+MinIO+ClamAV纵向与授权/并发/故障测试。

## 固定行为

1. 初始化只接受资源引用、原始名、声明MIME/大小/SHA256。所有账号QUARANTINED；事务内认证、领域授权、资源范围配额锁、幂等、元数据和审计。总配额包含未过期上传预留，默认25MiB/10个；同键不同载荷409。回执存稳定ID，不保存签名URL；有效期限内重试重新签名且先重验授权。
2. 完成先重新认证/授权，真实HEAD核验存在/长度/MIME并取得非空VersionId。短事务再次检查资源版本/权限/会话、CAS固定版本并排唯一FILE_SCAN_REQUESTED；返回202且仍不可下载。拒绝已过期/删除/损坏对象。
3. 扫描按固定VersionId GET，流式限制字节/截止，计算服务端哈希并识别实际MIME；声明与实测全部一致，ClamAV明确CLEAN后才AVAILABLE。容器内样本同样扫描；加密、超限、引擎错误、超时、无配置均不放行。失效租约结果不得发布；删除竞态不得复活。
4. 每次查询/下载/删除由服务端资源适配器实时授权。仅AVAILABLE且有完整扫描证据可下载，签名GET固定版本、60秒、attachment disposition；已发URL在期限内的可访问边界写清楚。逻辑删除CAS和审计原子，保留对象版本，不绕过COMPLIANCE。
5. 领域提交通过`assertAttachable(tx, actor, resourceRef, fileIds)`复验状态/精确归属/用途，与领域关联和流程动作在同一事务。平台不发明领域专业字段或跨企业关系。
6. 旧AVAILABLE缺乏真实扫描证据时迁移为隔离，旧哈希仅声明值；不发明旧空资源归属。AVAILABLE必须具备实测哈希、固定版本、CLEAN及扫描时间的数据库约束。
7. 待上传/过期记录的备份保留其明确状态；固定版本及保留期内删除对象仍需备份。恢复上传产生新VersionId，按旧key+version→新version更新恢复库后比对真实字节、DB引用和迁移信息。禁止仅校验latest。

## 执行与验证

- [ ] 先以真实PG夹具证明旧实现不能满足全员隔离、未知资源拒绝、未上传完成拒绝与扫描证据约束；缺扫描/对象/PG环境必须FAIL。
- [ ] 实现资源注册表、状态/迁移和初始化/完成短事务，验证同键回放、配额并发、撤权/停用/会话撤销/流程变化和审计回滚。
- [ ] 扩展对象adapter、真实校验和ClamAV扫描消费者，验证真实清洁与EICAR/ZIP样本、MIME/哈希/大小不匹配、引擎不可用/超时/超限/加密、双Worker/租约过期/删除竞态。
- [ ] 实现授权下载/删除/领域事务引用，验证企业A/B、未知类型、隔离/删除拒绝、latest被替换后仍只读已扫描版本。
- [ ] 同步失败运维、备份恢复版本映射及真实演练；测试域只在测试Nest module override注册，生产AppModule对同类型拒绝。
- [ ] Swagger生成、API/Web/PG/真实扫描/构建/Compose/归档/浏览器验证，独立规格与质量审查，记录FOUNDATION后进入P4。

扫描样本、病毒库、证书、备份和日志不进入Git；使用当前临时55448资源，禁止55440。扫描器固定签名库的开发验收不等同于生产病毒库更新运维放行。
