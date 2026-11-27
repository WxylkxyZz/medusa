# Storefront 可复用建站基座架构

> 状态：设计记录与目标架构，不表示所有生产能力已经实现。
>
> 记录日期：2026-11-27

## 1. 目标

当前项目的长期目标不是为一个站点制作一次性 Storefront，而是建立一个可重复用于多个 B2C 站点的前端基座：

- 每个站点在不同服务器部署自己的 Medusa Backend 实例。
- 每个站点拥有独立的 PostgreSQL、Redis、对象存储、密钥、业务数据和域名配置。
- 所有站点复用同一套 Backend 源码版本和 Storefront Adapter 代码。
- 每个站点只替换 Next.js 前端的 Theme、shadcn/ui 组件、页面 View、品牌配置和站点文案。
- UI 更新只重新构建并部署对应站点的 Storefront 镜像，不修改该站点的 Backend 源码、数据库结构或 Medusa Store API。

这里的“重复利用 Backend”指复用 Backend 的代码和镜像模板，并为每个站点运行独立实例；不是让多个站点共享同一个正在运行的 Backend、数据库或购物车数据。

## 2. 关键概念

### Medusa Backend

Medusa Backend 是每个站点独立运行的 Commerce 后端，负责商品、价格、库存、购物车、配送、订单、通知和外部 provider。不同站点可以运行同一版本的 Backend 镜像，但必须使用独立的运行时配置和数据资源。

### Storefront

Storefront 是一个完整的 Next.js 应用，包含：

```text
Next.js 运行时
+ React 页面和组件
+ Tailwind / shadcn/ui
+ Medusa Storefront Adapter
+ 站点 Theme
```

当前的 `apps/storefront` 就是这种应用。它不是只有 UI 的静态包，也不是一个独立的 Medusa 官方插件。

### Storefront Adapter

Storefront Adapter 是运行在 Next.js 服务端边界内的一组前端代码，不是当前单独运行的容器。它负责：

- 调用 Medusa Store API。
- 读取和解析 Region、Sales Channel 和 publishable key。
- 投影商品、变体、购物车和 Checkout 的公开模型。
- 处理 HttpOnly 购物车 Cookie、Origin 校验和安全错误。
- 为 Server Components、Route Handlers 和客户端变更控件提供稳定接口。

如果以后将 Adapter 抽成独立 npm workspace package，它在生产构建时仍然会被编译进各个站点的 Next.js Storefront 镜像。

### Theme / View

Theme / View 是站点差异的主要来源，包括：

- 页面布局。
- Header、Footer 和导航。
- 商品卡片、商品详情和规格选择器。
- 购物车和 Checkout 的视觉表现。
- Tailwind v4 CSS variables。
- shadcn/ui 组件组合。
- Logo、字体、色彩、间距、动画和站点文案。

## 3. 目标运行拓扑

```text
站点 A
浏览器
  -> Storefront A（Next.js + Adapter + Theme A）
  -> Medusa Backend A
  -> PostgreSQL A / Redis A / Object Storage A

站点 B
浏览器
  -> Storefront B（Next.js + Adapter + Theme B）
  -> Medusa Backend B
  -> PostgreSQL B / Redis B / Object Storage B
```

每个 Storefront 只连接自己站点的 Backend。站点之间不共享购物车 Cookie、数据库、publishable key、销售渠道或业务数据。

## 4. 当前仓库中的对应关系

当前 Storefront 的主要平台层位于：

- [`src/lib/medusa-http.ts`](../apps/storefront/src/lib/medusa-http.ts)：共享 Medusa HTTP transport。
- [`src/lib/store-api.ts`](../apps/storefront/src/lib/store-api.ts)：Region、商品和变体 API，以及公开商品模型投影。
- [`src/lib/store.ts`](../apps/storefront/src/lib/store.ts)：server-only 运行时环境读取和 Store API 入口。
- [`src/lib/catalog.ts`](../apps/storefront/src/lib/catalog.ts)：`Product`、`Variant`、`Price` 等可序列化公开模型。
- [`src/lib/cart-*`](../apps/storefront/src/lib)：购物车 Cookie、校验、服务和 Medusa API 适配。
- [`src/lib/checkout-*`](../apps/storefront/src/lib)：地址、配送方式和 Checkout 服务。
- [`src/app/api/cart/route.ts`](../apps/storefront/src/app/api/cart/route.ts)：同源购物车写入边界。
- [`src/app/api/checkout/route.ts`](../apps/storefront/src/app/api/checkout/route.ts)：同源 Checkout 写入边界。

这些平台层代码不应因为更换品牌视觉而被重写。UI 组件应只接收经过 Adapter 过滤的 `Product`、`Variant`、`Cart`、`Checkout` 等模型，不应直接接收任意 Medusa 原始响应。

## 5. 不可变平台层与可替换展示层

### 平台层：默认冻结

```text
src/lib/medusa-http.ts
src/lib/store-api.ts
src/lib/store.ts
src/lib/catalog.ts
src/lib/cart-*
src/lib/checkout-*
src/app/api/cart/route.ts
src/app/api/checkout/route.ts
```

平台层负责协议、安全和业务边界，主要变更原因应是 Medusa API 契约或平台能力升级，而不是换站点设计。

### 展示层：每个站点可以替换

```text
src/app/globals.css
src/components/ui/
src/components/storefront/
src/themes/
src/app/store/ 页面 View
src/app/cart/ 页面 View
src/app/checkout/ 页面 View
```

推荐把页面整理成 Controller + View：

```text
Next.js page / route
  -> 读取平台层数据并处理安全错误
  -> 生成稳定的页面 View Model
  -> 渲染可替换的 Theme View
```

一次性的前端整理可以让 `src/app` 中的页面只负责数据协调，而将实际 JSX 视觉结构放到 `components/storefront` 和 `themes` 中。完成后，创建新站点主要只需要替换展示层。

目标目录可以逐步演化为：

```text
apps/storefront/src/
├── app/                         # 稳定路由和页面 controller
├── lib/                         # 稳定 Medusa Adapter
├── components/
│   ├── ui/                      # shadcn/ui 基础组件
│   └── storefront/              # 站点页面 View 和业务展示组件
├── themes/
│   ├── default/
│   ├── site-a/
│   └── site-b/
└── app/globals.css              # Tailwind v4 与主题 token
```

不要求立即按这个目录移动所有文件；先建立依赖边界比立即大规模重命名更重要。

## 6. 每个站点的运行时配置

不同站点使用不同值，但保持同一套变量契约：

```env
MEDUSA_BACKEND_URL_INTERNAL=http://backend-server:9000
NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://api.example.com
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_replace_at_deploy_time
MEDUSA_SALES_CHANNEL_ID=sc_replace_at_deploy_time
NEXT_PUBLIC_DEFAULT_REGION=us
NEXT_PUBLIC_BASE_URL=https://shop.example.com
```

约束：

- `NEXT_PUBLIC_DEFAULT_REGION` 是两位国家代码，不是 Medusa Region ID。
- 每个站点使用自己的 publishable key 和 Sales Channel。
- `MEDUSA_BACKEND_URL_INTERNAL` 只给 Next.js 服务端使用。
- `NEXT_PUBLIC_BASE_URL` 必须与站点公开 origin 一致。
- 后端 `STORE_CORS` 必须允许对应 Storefront origin。
- 真实凭据只能由部署环境注入，不能写入 Theme、源码、镜像层或普通文档。
- 如果多个站点使用同一个 Backend 代码版本，也仍然应使用不同的数据资源和密钥。

## 7. 镜像和版本策略

当前 [`apps/storefront/Dockerfile`](../apps/storefront/Dockerfile) 将 Next.js 应用、Adapter 和 UI 一起构建为 Storefront 镜像。GHCR 发布流程见 [`publish.yml`](../.github/workflows/publish.yml)。

概念上的站点镜像可以是：

```text
ghcr.io/wxylkxyzz/medusa-storefront:theme-a-v1.0.0
ghcr.io/wxylkxyzz/medusa-storefront:theme-b-v1.0.0
```

当前发布流程已经使用 `main` 和 `sha-<commit>` 标签。生产部署优先使用不可变的 SHA 标签或 digest；`main` 只适合开发或明确允许自动跟随的环境。后续可以增加站点 Theme 的语义化 tag，但 tag 必须对应确定的源码构建。

### 只修改 UI 时

```text
更新 Theme / shadcn / 页面 View
  -> 构建新的 Storefront 镜像
  -> 更新目标站点的 Storefront tag
  -> Backend、数据库和迁移保持不变
```

### 修改 Adapter 时

如果只是 Adapter 仍兼容现有 Medusa Store API，可以只发布新的 Storefront 镜像。如果需要 Backend 新 API、模块、数据库字段或 provider 能力，则需要为 Backend 和 Storefront 建立兼容版本，并按受控迁移流程发布。

## 8. 新站点的标准流程

```text
1. 选定 Backend 版本和 Storefront Adapter 版本。
2. 为站点准备独立的数据库、Redis、对象存储和密钥。
3. 初始化该站点的 Store、Region、Sales Channel 和 publishable key。
4. 选择或创建 Theme、shadcn 组件和页面 View。
5. 使用站点环境变量构建 Storefront 镜像。
6. 运行 lint、typecheck、离线测试和 production build。
7. 使用真实站点 Backend 做 Storefront HTTP / 浏览器验收。
8. 部署不可变的 Backend 和 Storefront 镜像 tag。
9. 后续 UI 更新只替换 Storefront 镜像。
```

## 9. 适用边界

只替换 UI 的前提是站点共享当前的业务契约：

- 商品列表和详情。
- 变体和规格选择。
- 区域价格和库存状态。
- 访客购物车。
- 地址和配送基础流程。
- 当前已实现的 Checkout 边界。

如果某个站点需要会员、积分、订阅、B2B 报价、特殊订单字段、客户账户或新的支付能力，则可能需要扩展 Adapter、Backend 或外部服务。UI 不能替代不存在的后端业务能力。

当前项目的 Stripe、payment session、订单完成和最终购买流程仍未实现；新的 Theme 只能改变这些状态的展示，不能把未实现能力标记为已完成。

## 10. 一次性整理任务

为了让未来站点真正做到 UI-only，当前 Storefront 需要逐步完成以下一次性整理：

1. 冻结 Medusa Adapter 的输入输出和安全边界。
2. 统一 `Product`、`Variant`、`Cart`、`Checkout` 等公开 View Model。
3. 将页面中的数据协调和视觉 JSX 分成 Controller + View。
4. 将当前中性 UI 整理为默认 Theme。
5. 引入 Next.js 16、React 19、Tailwind v4 和 shadcn/ui。
6. 为 Theme 和页面 View 增加独立的离线/组件验证。
7. 扩展 CI，使 Storefront 可以生成可追踪、不可变的站点镜像 tag。
8. 不修改 `apps/backend` 业务代码，除非未来业务需求确实超出当前 Medusa API 契约。
