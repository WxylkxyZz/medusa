# 项目详细进度快照

记录时间：2026-11-26（UTC）。本文件是当前未提交工作区的只读状态快照，不代表已提交或已发布状态。

## 1. 版本管理与工作区

- 仓库：`/home/ubuntu/Medusa`；当前分支 `main`，HEAD `07bf1a9`。
- 本轮没有 commit 或 push；当前工作区包含根许可证/NOTICE、应用代码、测试和状态/本地开发文档的未提交改动。本次 subtotal/结账验收文档更新同样不 commit/push。
- 结账基础流程、shipping fixture、SEO/政策页面和相关测试均属于当前未提交工作区；其他未提交应用改动一并保留，未回退。
- `LICENSE` 为本项目 MIT License，版权年份为 2026、版权方为 `WxylkxyZz`。
- `NOTICE` 说明有限改编 `medusajs/dtc-starter`（MIT，参考提交 `edd0c1c1`）的 shipping seed data shape、sitemap/robots、product structured data 和 region policy model；这些概念已按本项目 Next.js 15 与本地约定修改，不是 wholesale copy。

## 2. 当前质量状态

最近一次质量门禁通过：

- `npm run lint`：通过
- `npm run typecheck`：通过
- `npm test`：通过，Backend 27 个、Storefront 135 个，共 162 个测试
- `npm run compose:config`：通过
- 占位公开配置下的 Backend/Admin/Storefront build：通过
- 最新 checkout/storefront 质量门禁：lint、typecheck、production build 和 diff-check 均通过；本次文档更新没有重跑测试、服务或这些命令。
- `git diff --check`：通过

这些是离线/构建验证，不是完整浏览器 E2E。当前未独立验证 checkout hydration、点击交互、响应式视觉、Console、图片失败/恢复或生产 HTTPS cookie 行为；本轮最新 Storefront 测试已覆盖 subtotal/配送金额投影。

## 3. Shipping fixture 与运行时验收

源码 fixture 位于 `apps/backend/src/scripts/shipping-fixture.ts`，bootstrap 位于 `apps/backend/src/scripts/bootstrap-local.ts`，批准的本地业务值保持不变：

- Fulfillment set：`US Warehouse Shipping`，type `shipping`
- Service zone：United States，country `us`
- Shipping profile：`Local Test Product Shipping`
- Shipping option：`Standard Shipping`，label/code `Standard`/`standard`
- 说明：`5-7 day transit`
- 价格：USD `5.00` flat
- 税：not tax inclusive

运行验收已成功完成受控迁移，重建并启动当前 Backend/Worker，并连续运行本地 bootstrap 两次。两次均成功，且确认持久化记录幂等存在：1 个 fulfillment set、1 个 `us` service zone、1 个 `manual_manual` provider 关联、1 个 `Standard Shipping` option 和 1 个本地 profile。

真实 Storefront 验收已通过：一次性 Cart 写入 US 地址后，Store API 返回 1 个 Standard Shipping（USD 5.00、5-7 day transit、非含税）；通过 Checkout 选择后 shipping method 持久化，subtotal 修复后 Storefront 投影 `item_subtotal`，页面以 **Items subtotal (before tax)**、**Shipping**、**Estimated total reported by store** 显示 USD 10.00、USD 5.00、USD 15.00，刷新/复用 cookie 后保持。`cart.subtotal` 是 Medusa 含配送的 subtotal（USD 15.00），不能替代 Items subtotal；非法 option ID 被拒绝且已选配送方式与金额不变。

## 4. Storefront、SEO 与公开政策

已实现并有离线测试/构建及本地 HTTP 观察：

- `/robots.txt`：允许公开目录，禁止 `/cart`、`/checkout`、`/api/`。
- `/sitemap.xml`：动态列出公开路由和当前可见商品；Backend 不可用时保留安全的静态公开路由。
- 商品详情：canonical、JSON-LD、Open Graph 价格/币种/availability 使用投影后的真实目录数据，不生成虚假 offer。
- `/shipping`：公开政策值为 USD 5.00 flat、Standard、5-7 days、tax not inclusive；无效或未发布 metadata 不猜测，显示 not published。
- `/returns`：没有已发布 return metadata 时显示 not published。
- 本地运行报告确认 `/robots.txt`、`/sitemap.xml`、`/shipping`、`/returns`、商品列表和详情返回 HTTP 200，并确认商品 JSON-LD/Open Graph 价格元数据。

以上路由未完成浏览器逐项视觉、hydration 和 Console 验证。

## 5. Checkout 与明确边界

结账基础流程已实现：HttpOnly cart cookie、地址收集/更新、真实 shipping option 查询、服务端归属校验和 shipping method 写入逻辑，以及安全错误状态。支付区域仅显示不可用。

明确未实现且本轮不扩大范围：

- Stripe 或其他支付采集
- payment collection / payment session
- cart complete、订单提交、订单页面和最终购买
- 搜索、账号体系
- Admin HTTP multipart 图片上传验证
- 最终品牌视觉设计

运行验收没有调用 payment、Stripe、order completion、Resend 或 R2；通知模板/订阅器不代表订单闭环已打通。

## 6. 基础设施留存

本轮运行结束后，仅停止本轮启动的服务；PostgreSQL/Redis 数据卷、既有容器与网络按项目约束保留，未执行 `down -v`、`rm`、`prune` 或卷删除。临时 cart 已按精确目标软删除（逻辑删除，非物理清除），受保护 key/恢复材料不在本文输出。

后续重点转为：结账浏览器交互验收、Admin multipart 上传验证、订单/支付方案决策及 staging/production 基础设施；支付、Stripe、订单完成和浏览器 E2E 仍未完成。
