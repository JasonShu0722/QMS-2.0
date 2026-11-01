# REQ-0034 表单、台账与清单统一设计

日期：2026-10-31。负责人已在本聊天批准方案、独立台账样式和正式策划实施；设计认可、源码实现、工程验证、发布及人工验收分别记录。

## 1. 来源与目标

- 需求：[REQ-0034](https://larkcommunity.feishu.cn/record/FSsRrSqvieF2wBcPm5lcHM6Lngf)，`reczz28TwMc1lDEg`；user提交九业务字段并回读rev344一致，实际状态待评估，开发依据当前聊天直接授权，不代设状态。
- [Issue89](https://github.com/JasonShu0722/QMS-2.0/issues/89)；执行与证据见[实施计划](../plans/2026-10-31-qms-business-pages.md)。
- 复用[前端统一规范](2026-09-21-qms-frontend-design-standard.md)、[实施指南](../../../qms-2.0/docs/FRONTEND-DESIGN.md)及现有业务规格；21st.dev仅为列宽与视觉参考，不复制员工模型或引入授权不明源码。
- 用户认可对话内独立台账的轻边框、紧凑层次和清晰工具栏，追加列宽、拖列、本地记忆和每页条数；目标是全正式页面的统一使用习惯，不是所有页面套同一巨型组件。

## 2. 四类模式与边界

| 模式 | 结构与统一项 | 保留的业务事实 |
| --- | --- | --- |
| 查询台账 | 快捷视图/筛选、工具栏、结果与选择、表格、分页；轻边框、清晰列边界 | 真实权限、服务端筛选排序、选择来源及版本、记录深链 |
| 对象表单 | 标签/字段组、就近校验、条件帮助、主次操作、失败恢复 | 领域字段、保存粒度、CAS/幂等、busy/dirty及未知回执 |
| 可编辑明细 | 有身份的重复行、增删、行字段校验、局部滚动 | 随整单或逐行保存的原事务；零、缺失与原文不互换 |
| 检查清单 | 分组要求、判定/实测、说明与证据、真实完成情况 | PASS/NG/NA等原枚举、证据资格、部分成功/离线与正式提交边界 |

简单表单优先单列，相关短字段可同行；复杂对象按信息关联分区，仅真实线性任务分步。弹窗和抽屉按任务上下文选用，不把所有操作移动到同一页脚。共享布局/主题，不新建通用保存器或schema引擎。

## 3. 列操作与状态

1. 主台账使用Ant Design Table的受控列与header cell扩展。宽度分隔线与换列手柄分开；点击排序不触发拖动，拖宽不触发排序。
   拖宽命中区域必须以实际th单元格边界为基准，不能按内层标题/padding/sorter容器定位；表头与行的细边界只保留一处，抑制同处重复的装饰短线。固定sticky、ellipsis、横滚和键盘焦点均须真实验证，不把CSS变量或单测通过充几何证据。
2. 各列声明稳定`key`和合理默认/最小宽度；不得用翻译后的标题或数组位置持久化。表头和行保持一致，宽表只在容器横滚。
3. 指针拖宽结束才持久化；取消拖动恢复原宽度。支持键盘微调、单列恢复与设置面板数值输入，不能只有鼠标入口。
4. 拖动排列提供落位提示；列设置中可上移下移，触屏有非拖动替代。固定列在固定区内排列；选择、展开、必要编号和操作列按调用方规则锁定，不隐藏必需业务入口。
   展开明细模式在当前无可展开记录时不留无用途首占位列；有可展开记录时保留明确标题、紧凑控件及原明细，调用方显式配置与树表语义优先。专业非Ledger表也按同一无空占位原则检查，不为修复空列强行迁移台账。
5. 列设置同入口管理显隐、顺序、宽度及允许固定状态；恢复默认只作用当前台账/视图的列，不删服务器视图、不重置筛选/排序/页长。
6. 缓存只存schema、稳定列标识/宽度/顺序/显隐/固定及合法页长，不存行、选择、正文、附件、凭据、请求身份或筛选草稿。
7. 命名空间包含真实用户/会话身份、实际资源组织、业务/供应商/管理宿主、台账；列配置进一步按视图隔离。组织来源必须与实际请求拥有者一致：home请求不能仅因URL带target参数就把配置记入target键。控制台使用经验证的`resourceOrganization`：`TARGET`取目标组织、不得误用home；`SESSION_HOME`则仍取会话home组织，不将所有管理页面强行改成target范围。
8. 无可信身份时不持久化；缓存只从当前权限生成的列中解析，不恢复当前未授权列。新增列补默认、删除/未知列忽略、重复/异常宽度归一；损坏、容量/禁用异常退回可用内存配置。
9. 切换用户/组织时在呈现和写入前更换有效范围，禁止把A配置写入B键；不通过重挂业务页清配置而丢草稿。

## 4. 服务端保存视图共存

`ProblemSavedViewConfigurationDto`当前保存filters/sort/visibleColumns/columnOrder，不含width/fixed。本轮不扩DTO或数据库。

- 显式应用命名视图时，视图的显隐/顺序为权威；共享表格支持受控显隐/顺序回调，调用方仍负责保存按钮、版本冲突和API。
- 未应用命名视图的默认布局仍须记住本人列序/显隐，不能因调用方使用受控props而退化成内存状态。问题中心复用既有偏好模型的`default-layout`布局键只保存order/visible；子表原default/view键拥有width/fixed，避免两个hook把同键旧快照互相覆盖。保存视图body始终取当前实际布局，仅选择视图不暗中应用，显式应用不改写默认缓存。
- 宽度/固定及页长作为本地偏好补充；旧本地顺序不能在视图应用后反向覆盖服务器配置。
- 动态客诉ALL/ZERO_KM/AFTER_SALES使用稳定列全集标识，当前可用列以视图与权限为准；不缓存业务来源或重建编辑器。

## 5. 分页

- 普通台账默认20条，候选10/20/50/100；按领域DTO实际最大值裁剪，200/500不开放。每页条数按本人/目标组织/门户/台账记忆，不随快捷视图随意重置。
- 改条数时回第一页或offset0，游标列表清空旧cursor链；保留当前筛选排序，选择是否保留沿原业务规则，不重新生成旧来源版本。
- 页脚、请求、响应校验和服务端上限一致。禁止只改Table分页器而请求仍固定20/50/100，也不把已加载一页当全量本地分页。
- 窄屏保留页长可操作入口。Ant Design在`max-width:576px`默认隐藏分页options，本轮在业务/控制台正文宿主恢复已有options并允许换行，同时覆盖Table内置和独立Pagination；不凭空给明确关闭页长的专业详情添加入口。
- 有total才显示普通总数/页码；审计cursor、供应商加载更多、问题待配置扫描和来源协作扫描保留各自语义，不由scannedCount伪造问题总数。
- 详情、导入预览、一次性凭据结果、编辑矩阵不默认添加完整台账工具栏。安全会话、修订历史等真实专属上限保留。

## 6. 实际盘点与实施集合

2026-10-31以主线`478c325`正式src为基线，排除prototypes、interaction-preview及测试：74处AntD Table/50文件、5处原生table/4文件、19处AntD List/10文件；这是源码盘点，不是浏览器验收。

| 组别 | 核心入口（相对`qms-2.0/apps/web/src/`） | 决定 |
| --- | --- | --- |
| 核心问题与来源 | `features/problem-center/ProblemCenterPage.tsx`、`customer-quality/CustomerQualityPage.tsx`、`process-quality/ProcessDefectLedgerPage.tsx` | 接共享列操作与真实分页；ProblemCenter覆盖综合及三域跟进，保留命名视图和跨页来源 |
| 供应商主台账 | `supplier-quality/SupplierQualityPage.tsx`、`SupplierProfilesPage.tsx`，`supplier-incoming`、`supplier-concession`、`supplier-pcn`、`supplier-performance`、`supplier-quality-targets`各正式Page | 内部/门户隔离，保留资格、草稿及详情子表，逐分页拥有者接入 |
| 当前首屏截断 | `ProcessShipmentReportPanel.tsx`、`SupplierAdmissionPage.tsx`、`SupplierAsnPage.tsx`、`SupplierPpapPage.tsx` | 主列表必须同时接真实page/total，不用本地页脚掩盖首请求截断 |
| 检验与审核 | `CoordinateInspectionPage.tsx`、`SupplierAuditPage.tsx`、`AuditManagementPage.tsx`、`AuditStandardsPage.tsx` | 计划/记录独立页长；专业检查项不强制台账化，补动态字段标签 |
| 管理与主数据 | `admin/UserAdministration.tsx`、`RoleAdministration.tsx`、`AdminSupplierAccounts.tsx`、`governance/StructureAdministration.tsx`、`ConfigurationAdministration.tsx`、`ComponentProjectAdministration.tsx`、`material-master/MaterialMasterPage.tsx` | 数组真实本地分页，传目标组织；岗位/任职/权限矩阵保留语义 |
| 控制台观测 | `console/ApiMonitoringPage.tsx`、`DataExchangePage.tsx` | 请求和响应limit校验一起修改，中性主题/资格独立保持 |
| 游标与扫描 | `AuditAdministration.tsx`、`OutboxAdministration.tsx`、`AdministrativeReconfiguration.tsx`、`AdministrativeProblemReconfiguration.tsx`、`tasks/*Inbox.tsx` | 列操作按用途接入；游标/扫描不改成虚假total分页 |
| 原生列表及其他清单 | `workflows/WorkflowListPage.tsx`、`AnnouncementsPage.tsx`、`SupplierNotificationsPage.tsx`、`MyTasksPage.tsx`、`CustomerLegacyQualityPage.tsx` | 正式可达不遗漏；列表/内容不为统一而改成表格，适用分页由原拥有者处理 |
| 专业明细及安全例外 | `EightDDocumentEditor.tsx`及两域日期矩阵、`MasterDataImport.tsx`、`UserBatchCreate.tsx`、`AccountSessionHistory.tsx`、各详情与来源picker | 统一密度/标签/滚动/操作呈现，不持久化明细/秘密，不改变独立专属上限 |
| 指标分析窗口 | `quality-data/QualityDataPage.tsx`的综合看板与期间事实 | 看板为有界分析快照，趋势明示最近最多50条事实并与同批图表对应；保持事实表10条本地展示，不把分析窗口改成声称全量的普通业务台账 |

表单布局复用`ThemeProvider`、`theme.css`、`qms-dialog-actions`与`UnsavedChanges`。重点收拢8D、客诉/制程、IQC/三坐标字段容器密度；移动审核逐项离线同步、供应商审核整清单保存、PPAP逐项证据、8D建议行/null三态各自保留。质量目标JSON指标输入作为当前协议例外保留，不新增指标编辑器。

## 7. 验收与闭环

- 新公共逻辑先红灯测试再实现；各任务独立SPEC后QUALITY；主代理冻结源码后整合复验。
- 模型/组件覆盖坏存储、身份/组织/门户隔离、受控视图优先级、权限列过滤、拖宽/换列/固定/恢复、页长与请求一致、空态/末页及不丢业务选择/草稿。
- 1440/1024/390、窄Drawer、六业务主题与控制台现行主题、中英文、焦点/键盘和触控替代；真实鼠标、模拟触屏、真实硬件分别记录。
- Web受影响及全量测试、lint/build、契约检查、治理/归档；Foundation适用完整门禁。真实业务链需要的一次性服务不得连接55440，不以Mock/Skip或演示数据代替。
- 本地工程、PR/CI、生产部署、人工验收、Issue关闭及Base回填分别记账；当前授权不自行扩大为生产操作/最终验收。
- 先写证据，再按独立授权合并发布/最终回归/关闭回填并回读。沉淀目标为统一前端规范、实施指南、能力状态与文档索引；回滚为Web/样式差异，不删除业务数据。
