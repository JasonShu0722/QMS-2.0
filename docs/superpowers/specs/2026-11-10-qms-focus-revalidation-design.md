# 切回窗口时的静默验证设计

## 批准与问题

负责人提供整页空白和细长验证框截图，已认可普通切回后台检查、合并重复事件、网络轻提示、真正身份失效才阻断的方案，明确“修复这一项体验”。关联Issue105，V0.0.43；当前main/生产d9d2a92。该后续要求覆盖原普通focus/visible立即showModal阻断的交互；明确安全信号与首次验证边界保留。

## 最小方案

1. 在既有session-invalidation模块内，将普通窗口resume通知与现有invalidate/revalidate安全通知区分。新增小型本地订阅subscribeWindowResume，不扩BroadcastChannel/storage协议；focus与visible合并一个短事件窗口，最后订阅移除时清理timer/listeners，不新增轮询、授权缓存或依赖。明确安全通知仍同步执行，不被延迟/去重吞掉。
2. AuthenticatedRoute、ConsoleLayout、ConsoleEntry消费resume，已有同scope请求在途则合并；首次/主动路由组织变化仍走原验证。已验证同身份/范围页面保留，resume不设置全屏loading、不showModal、不清现有输入。Context相同能力仅替换必要事实，不更换页面key；不抢焦点、不回置滚动。
3. resume网络失败保留现有画面/草稿，以非阻断Alert及重试呈现；重试为同类后台检查，成功清提示。正在检查时页面可读可编辑，写请求继续按原服务端鉴权/CSRF/近期认证/幂等独立验证，不新增凭借旧前端权限放行路径。
4. 真实会话401/403、账号变化、BroadcastChannel/storage invalidate、明确权限revalidate、session store ABA沿现有清敏/中止/重验机制立即执行。正在进行的resume结果必须绑定scope和generation/controller，任何后发安全事件、路由变化、卸载后都不可复活旧页面/账号。Console context能力变化按原capabilityKey失效子树，不能保留不再授权的内容。
5. 普通resume不使管理入口按钮消失重建；同账号恢复context仍重查其可见资格。其它仅处理安全信号的观测/业务订阅不误把resume当失权。公告计数保留原刷新职责，不建设新通用数据刷新服务。
6. SessionVerificationGate只用于原必要阻断场景，明确可用宽度，避免固有宽度塌成细框；正常resume不显示该dialog或backdrop。网络轻提示不使用旧全屏错误容器占据整个页面。

## 验收与非目标

真实浏览器覆盖业务页面及控制台已打开Modal、输入、滚动和焦点，在延迟真实session/context响应期间无open会话dialog/白屏、可继续输入；结果相同不重挂载/重拉无关页面；同次focus+visible只一检查。网络失败轻提示/重试成功保持；真实退出/权限信号立即清敏、迟到成功不恢复，拒绝及ABA单元回归保持。首次验证/主动换组织/路由、明确服务端拒绝、csrf/reauth不降级。

不修改API/DTO/数据库/鉴权后端，不引入轮询、缓存有效期或管理员开关；不把页面继续显示当成已确认授权。用户截图无法单凭图片证明浏览器实际帧根因，CSS不透明backdrop与缺width有源码证据，真实验收验证最后行为。
