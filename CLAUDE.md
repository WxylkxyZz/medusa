# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 当前项目边界

- `/home/ubuntu/Medusa` 是当前唯一工作区；旧版 `/home/ubuntu/B2Csite` 不属于本项目，也不是实现或配置的来源。
- 当前开发目标是本机 Linux。InstaBox、云端测试机及相关连接器均为历史背景，不应作为开发、测试、部署或故障排查依赖；不要为它们恢复代码、凭据或流程。
- 当前目录已经初始化为 Git 仓库（`main` 尚无提交，GitHub `origin` 已配置，本轮未 commit/push），并已有本地 Backend/Storefront monorepo、Docker/Compose、Resend/通知模板/订阅器和业务 bootstrap。Storefront 商品列表/详情已实现并完成真实本地 HTTP/SSR 验证；R2 通用文件 provider 已完成先前真实 smoke test，商品媒体业务集成尚未验证。Stripe 明确暂缓，CI/GHCR 和 staging/production 仍未实现。不要把交接文档的历史状态当成本地现状。
- GitHub 源码管理可以从通过质量门禁和秘密扫描的稳定基线开始，不必等全部业务功能或最终 UI 完成；正式发布准备度另行判断。没有明确请求时不 commit/push。
- `B2C 独立站架构图.html` 是可直接打开的单文件架构说明：CSS、SVG 图和交互 JavaScript 都内嵌其中，外部只引用 Google Fonts（断网时使用字体回退）。
- `B2C-Medusa-交接文档.md` 是架构决策和历史交接资料，不是当前源码。当前副本已脱敏并由项目 `.gitignore` 保持本地-only；只提取架构结论，不复制、回显或提交其中的凭据，也不要依赖其中的历史机器路径。

## 常用命令

根 workspace、Backend 和 Storefront 的质量命令已经可用；Resend 本地真实投递、业务 bootstrap 和 R2 通用文件 smoke test 已验证。Storefront 商品浏览已通过离线测试、production build 和真实本地 HTTP/SSR 联调；浏览器交互与商品媒体上传/关联尚未验证，Stripe 暂缓，生产外部服务未完成。运行时配置和验证边界见 `docs/local-development.md`。

```bash
# 安装锁定依赖
npm ci

# 质量检查
npm run lint
npm run typecheck
npm test

# 构建（Storefront 使用占位公开变量）
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000 \
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_build_placeholder \
NEXT_PUBLIC_DEFAULT_REGION=us \
NEXT_PUBLIC_BASE_URL=http://localhost:8000 \
npm run build

# 运行 Backend 的单元测试；新增测试后可指定单个 suite
npm run test:unit --workspace=@b2c/backend -- --runTestsByPath <path-to-test>

# 单独运行 Storefront 离线测试
npm test --workspace=@b2c/storefront

# 本地已有管理员后执行幂等业务 bootstrap（不是生产脚本）
npm run bootstrap:local --workspace=@b2c/backend

# 校验并启动本地 PostgreSQL、Redis、Backend、Worker、Storefront
npm run compose:config
npm run dev

# 单独预览静态架构图
python3 -m http.server 8000 --directory .
```

当前 `npm test` 已包含 Backend 20 个和 Storefront 44 个离线测试，根 lint/typecheck/tests 已通过；新增业务代码必须补充真实测试。Storefront production build 已在占位公开配置和不可达 Backend 下通过，商品路由为动态；构建值不能当作运行时可用 key。Backend 仍保留无测试文件可通过的配置，不代表可以省略测试。单独启动上面的静态服务器后，打开 `http://127.0.0.1:8000/B2C%20独立站架构图.html` 操作五个页签及 SVG 节点；该端口与 Storefront 冲突，不要同时启动。

## Storefront 商品功能与验证边界

- 最终 UI/品牌视觉是单独的设计工作；当前为中性响应式功能界面，不声称设计已定稿。
- `/store` 展示真实已发布且渠道可见的商品，每页 12 件，有界分页和空页提示；`/store/[handle]` 展示纯文本描述、图片/无图占位、区域价格、规格/变体、SKU、库存/缺货/允许预订状态。Medusa v2 金额为主单位，不除以 100，不编造数据。
- `src/lib/store.ts`（相对 `apps/storefront/`）是 server-only 运行时环境边界，用 `Reflect.get` 防止 Next.js 固化构建占位值；优先 `MEDUSA_BACKEND_URL_INTERNAL`，否则 `NEXT_PUBLIC_MEDUSA_BACKEND_URL`，发送 publishable key。`NEXT_PUBLIC_DEFAULT_REGION` 是国家代码，需解析真实 Region 并传 `region_id`/`country_code`。多渠道 key 需 `MEDUSA_SALES_CHANNEL_ID`；当前 Compose 未透传此可选变量，需另行配置服务环境。宿主机开发不要启用 Docker-only 内部地址。
- key 由本地 bootstrap 写入进程所在容器的受保护文件，默认 `/tmp/local-publishable-key`；不打印真实值，通过受保护流程注入运行时 `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`，Compose 需重新创建 Storefront 才接收新值。bootstrap 要求已存在的本地管理员，可用 `LOCAL_ADMIN_EMAIL` 匹配。具体操作见 `docs/local-development.md`，不能用占位 key 验业务。
- 商品路由动态渲染、请求不缓存；成功查询为空才 404。配置、缺失 Region 和上游故障分别显示安全提示。仅向客户端传白名单公开模型，HTTP(S) 图片由浏览器直载，不设置通配服务端图片代理。
- 已观察真实本地 production Storefront HTTP/SSR：测试商品 USD 10、库存 10、SKU `TEST-001`、`One Size`、无图片，列表/详情 200、正确价格/初始规格；空页、无效页回退、缺失商品 404/noindex、Backend 停止后的安全提示均已验证。响应和客户端 bundle 检查未见实际 key、构建占位 key 或内部主机名泄漏。本轮禁用外部邮件/R2，未上传或支付。
- 浏览器不可用，未验证规格切换事件、hydration、视觉响应式、图片加载/失败和控制台。404 初始 HTML 是 Next.js 错误壳，自定义文案只确认存在于 hydration payload，不能声称最终视觉已验证。无图商品也不覆盖 R2 商品媒体业务链路。
- 前序运行验证已停止进程/服务并保留数据卷；删除容器被拒绝，五个退出的容器及网络残留，bootstrap key 文件仍在停止的 Backend 容器内。清理需获准，不输出文件值、不删除数据卷；详情见本地开发文档。
- 购物车、结账、订单店面行为及其测试未实现；Stripe 明确暂缓，不增加搜索。通知模板/订阅器已实现不代表下单闭环完成。

## 当前基线

- Medusa Backend 已按 `2.23.0` 创建 workspace manifest，核心 `@medusajs/*` 包保持同一版本；React 使用 `19.3.1`。
- 本机 Node 为 `24.21.0`，Medusa `2.23.0` 的引擎要求为 `>=22.22.0`，因此根 `.nvmrc` 固定 `24.21.0`，Docker 基线也使用 Node 24；如后续切换 Node 22，必须重新跑完整质量门禁。
- Storefront 基线使用 Next.js `15.5.29`、React `19.3.1` 和 Medusa JS SDK `2.23.0`。
- 本地 Compose 目前对外暴露 Backend `127.0.0.1:9000`（容器内 9000）、Storefront `127.0.0.1:8000`、PostgreSQL `55432` 和 Redis `56379`；本地 PostgreSQL URL 使用 `sslmode=disable`，生产不得照搬。
- 根 `package-lock.json` 已由 npm 生成。依赖安装报告存在上游依赖审计告警，不能直接运行 `npm audit fix --force` 降级 Medusa；升级或例外处理要单独评估。

## 目标架构（设计，不代表已实现）

交接资料和架构图描述的是一个以后在本工作区重建的 B2C 系统：

- 后端目标为干净的 Medusa v2 应用；店面目标为独立的 Next.js 应用，UI 采用 shadcn/ui 与 Tailwind CSS。两者应作为同一仓库中的独立应用维护，店面不打进后端镜像。
- Resend 没有官方 `@medusajs/notification-resend` 包；当前已在 `apps/backend/src/modules/resend/` 实现自定义 provider，用 `ModuleProvider(Modules.NOTIFICATION, ...)` 注册，service 继承 `AbstractNotificationProviderService`，支持模板/内容、附件、幂等键和可控重试。订单确认、发货、密码重置的本地模板和事件订阅器位于 `apps/backend/src/notifications/` 与 `apps/backend/src/subscribers/`；Server 与 Worker 共用配置，通知由 Worker 异步发送；离线测试和一次真实测试邮件均已完成。
- `REDIS_URL` 已配置供 Caching、Event Bus、Workflow Engine、Locking 四个 Medusa concern 共用。文件存储已通过 `@medusajs/medusa/file-s3` 接入 R2，先前在配置 `R2_FILE_URL` 的环境完成上传、公开 URL 访问、File Module 读取、删除和删除后拒绝访问的真实 smoke test；商品媒体上传/关联/店面实际图片显示尚未验证。文件 bucket 与 PostgreSQL 备份 bucket 必须分开，备份工具和备份 bucket 流程仍未实现。
- 运行时请求链路是浏览器 → Next.js 店面 → Caddy → Medusa Server。Worker 与 Server 使用同一后端镜像但以独立进程运行。
- 业务数据放托管 PostgreSQL，缓存、事件总线、工作流和锁放托管 Redis；上传文件放对象存储。VPS 只运行应用容器，不运行业务数据库容器，也不把业务数据写入镜像或容器本地盘。
- 支付、邮件和对象存储是可插拔的外部 provider。搜索不是当前阶段的默认能力，不要在没有明确需求时添加搜索服务或店面搜索框。
- 生产更新的设计顺序是：构建不可变镜像 → staging 彩排和业务验证 → 备份 → 单独执行数据库迁移 → 启动 Server/Worker → 健康检查。迁移流程不能依赖多人同时启动时的隐式竞态。
- PostgreSQL 备份应远程导出并异地保存；Redis 可重建，不与 PostgreSQL 采用同一备份策略。文件 bucket 与备份 bucket 要分离。
- 所有环境地址和密钥都应由运行环境注入。当前工作区只能保留不含真实值的配置模板；创建外部服务、域名、支付/邮件账号、GitHub/GHCR、VPS 或 staging 资源属于后续需要用户账号或外部授权的工作。

## 目标部署与运维约束（设计，不代表已实现）

- 生产部署必须先由单独、受控的一次性迁移完成，再启动 Server 和 Worker；迁移后执行幂等的管理员 bootstrap。首次部署的业务 bootstrap 另行完成：创建 USD 的 Store/Region 并启用 Stripe、Sales Channel、Publishable API Key。迁移只建 schema，不会生成这些业务记录。
- 本地 HTTP 开发需关闭 session cookie 的 Secure 行为；生产使用 HTTPS 和 production 设置。Admin 是静态 bundle，依赖 `MEDUSA_BACKEND_URL` / `admin.backendUrl`，并要求后端地址与访问来源出现在匹配的 CORS 配置中。
- 容器连接 Supabase 时，按当前环境验证服务商的 pooled endpoint，不要照搬历史直连地址。PostgreSQL 备份目标为每日保留 30 天、每月保留 3 个月，并每季度做一次恢复演练；Redis 可重建，不沿用 PostgreSQL 备份策略。

## 初始化后的目录边界

应用骨架创建后，保持以下职责分离：

- `apps/backend/`：Medusa 配置、Provider/模块、API、Workflow、订阅器和 Backend 测试；已有基础 manifest、配置、Dockerfile、Resend/通知模板/订阅器、R2 file-s3 配置、bootstrap 和测试；商品媒体业务集成仍待验证，Stripe 和业务订单闭环仍待实现。
- `apps/storefront/`：独立 Next.js 顾客店面，不打进 Backend 镜像；已有首页、商品列表/详情、服务端 Store API 边界、规格客户端组件、44 个离线测试、构建配置和环境模板；购物车/结账/支付、浏览器 QA 和最终 UI 仍待完成。
- `infra/local/`：本地 Linux 的 Compose 和示例环境模板；当前已包含本地 PostgreSQL/Redis/Backend/Worker/Storefront Compose。
- `infra/staging/`：隔离的 staging 配置和验证材料。
- `infra/production/`：生产 Compose、Caddy、迁移/发布和备份脚本。
- `docs/`：实现与运维说明；`.github/workflows/`：质量检查和镜像发布。

这些目录的生产/staging 脚本、Stripe Provider、CI/GHCR 和备份工具仍未创建；R2 通用文件配置已实现并验证，商品媒体业务集成尚未验证。本地 bootstrap 位于 `apps/backend/src/scripts/bootstrap-local.ts`；新增文件后以实际 manifests 和脚本为准补充命令。

## 架构图文件的维护方式

- 该 HTML 是架构说明的单文件可交互展示，与 Storefront 商品界面分离。视图分别描述运行架构、构建与部署、版本更新、数据与备份、答疑。
- SVG 节点通过 `data-key` 与脚本中的 `DETAILS` 对象关联；新增或重命名节点时要同步更新节点键、详情对象和默认选中逻辑，并保留键盘可操作性。
- 样式使用 CSS 自定义属性，同时支持浅色/深色系统主题和窄屏布局。修改视觉样式时不要破坏 `prefers-color-scheme`、响应式布局或可访问的 tab/node 语义。
- 架构图中的“已配置/已就位”描述可能来自历史交接，不等于当前工作区已有文件。实现新功能前先检查本目录的实际文件，而不是直接照搬历史路径或测试机步骤。

## 安全与初始化约束

- 不从历史交接文档复制真实账号、密码、API key、token、数据库连接串或个人信息到 `CLAUDE.md`、源码、示例配置、日志或提交中。
- 可以立即在本机创建的内容包括：应用目录骨架、README/架构文档、`.gitignore`、不含真实值的 `.env.example`、Docker/Compose 模板、迁移/备份脚本接口、以及使用占位符的 CI 草稿。
- 需要外部账号或密钥后才能完成的内容包括：真实数据库/Redis/R2 连接、支付和邮件 provider、域名与 HTTPS、GitHub/GHCR 权限、VPS/staging 部署、线上备份恢复和真实下单验证。没有这些输入时只创建显式失败或占位配置，不要猜测值。
- 在应用代码真正初始化前，把架构图和交接资料视为设计/历史资料，不要把其中的历史状态当作已验证行为；当前应用已建立本地基线，新增实现必须放在本工作区，并明确区分“设计目标”和“已验证行为”。
