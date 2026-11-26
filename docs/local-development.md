# Local development

当前本地验证基线使用 Node.js `24.21.0`、npm `11.19.0` 和 Medusa `2.23.0`。所有命令从仓库根目录执行。

## Quality checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run compose:config
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000 \
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_build_placeholder \
NEXT_PUBLIC_DEFAULT_REGION=us \
NEXT_PUBLIC_BASE_URL=http://localhost:8000 \
npm run build
```

- 购物车实现/复核及运行报告记录根 lint、typecheck 和 tests 通过：Backend 20 个、Storefront 102 个离线测试。单独执行店面测试可用 `npm test --workspace=@b2c/storefront`；新增购物车及回归测试共 58 个，原商品测试 44 个。
- Storefront 测试覆盖原商品/区域/API 边界，以及购物车金额、数量、行归属、cookie/Origin、国家/Region/渠道一致性、失效与上游错误区分、写入不重试、Web Locks 协调和 Medusa 2.23.0 离线 validator 合约。这些不是 React 事件、浏览器交互或 E2E 测试。
- 复核报告记录完整根 `npm run build` 在占位公开配置、不可达 Backend 下通过，包含 Backend、Admin 和 Storefront；未观察到 Backend 构建失败。运行报告另记录 fresh Storefront production build 通过。`/store`、`/store/[handle]`、`/cart`、`/api/cart` 动态执行，构建不依赖真实 Backend。编译检查确认服务端运行时读取保留；运行报告检查响应及 22 个客户端 JS 未见测试的 key/Backend 配置标记，不构成穷尽安全证明。
- 现有非失败警告包括 Node 原生 TypeScript 测试的 module-type 警告、Backend 的实验 VM/Jest force-exit 提示。不能把通过测试等同于已无运行时风险。

Backend 已包含 Resend Provider、订单确认/发货/密码重置模板和订阅器；本地 Store/Region/Sales Channel/Publishable API Key/测试商品 bootstrap 已验证。R2 通用文件能力已完成先前真实 smoke test；本轮受控 File workflow 上传、公开读取及商品图片关联/SSR 已验证，宿主机手动验收按用户报告通过（非代理浏览器实测或逐项证明），Admin HTTP multipart 认证上传接口仍未验证。Stripe 明确暂缓。

**商品媒体轮人工验收与清理已完成（2026-11-25，历史状态）。** 受保护记录为 `cleanup-complete`，该次重试无新的权限拒绝；当时独立只读确认预览/proxy 停止、四个服务容器退出、8000/9000/55432/56379 无监听，保留容器、网络和卷。媒体恢复、QA 商品/对象精确删除及业务不变的保存证据仍有效，见下文历史留存记录。后续购物车联调曾重新启动原服务和 production 预览；**购物车轮清理重试现已完成：两个空测试 cart 精确软删除（非物理清除），Windows 转发由用户手动移除并经只读注册表确认不存在，预览、forwarder 与服务均停止，数据库卷和原有业务数据保留**。无待重试的上述清理项，详见[购物车运行证据与验收状态](#购物车运行证据与验收状态)。本次独立复核只读检查进程/端口、Docker、Windows 注册表和保存证据并更新文档，未重启服务、重跑质量命令、查询实时数据库、访问 R2、执行购物车写入或重复删除。

以下命令为一般开发说明，不要求现在重启、重建或删除保留资源；当前没有运行中的预览入口，历史验收链接不代表服务可用。

## Local Compose

```bash
docker compose -f infra/local/compose.yaml up --build -d
docker compose -f infra/local/compose.yaml ps
curl -fsS http://127.0.0.1:9000/health
# 运行时 publishable key 配好后再验商品页，不能只看 HTTP 200。
curl -fsS http://127.0.0.1:8000/store
curl -fsS http://127.0.0.1:8000/store/test-product
docker compose -f infra/local/compose.yaml stop
```

服务端口：

- Backend/Admin/API：`127.0.0.1:9000` → 容器 `9000`
- Storefront：`127.0.0.1:8000`
- PostgreSQL：`127.0.0.1:55432`
- Redis：`127.0.0.1:56379`

Compose 会先运行一次性 `migrate` 服务，成功后才启动 Backend Server、Worker 和 Storefront。PostgreSQL 与 Redis 使用本地命名卷；停止服务时不要使用 `docker compose down -v`。迁移只创建 schema，不会自动创建管理员和业务数据。当前 Storefront Dockerfile 执行 `next dev`，不代表生产启动或生产镜像流水线已建立。

本地 PostgreSQL URL 使用 `sslmode=disable`，只适用于本地明文开发容器。托管 PostgreSQL/staging/production 必须按实际服务商要求配置 TLS 和 pooled endpoint。

### 本地 bootstrap 与运行时配置

1. 确认迁移成功、Backend 健康，先用本地 Admin 初始化流程创建管理员。`bootstrap-local.ts` 要求该管理员已存在；它按 `LOCAL_ADMIN_EMAIL` 查找，未设置时使用代码中的本地测试默认邮箱。自定义管理员时，需向 bootstrap 进程显式传入匹配的 `LOCAL_ADMIN_EMAIL`，不要把真实邮箱或密码写入命令示例/源码。
2. 对现有本地管理员及默认本地配置，执行已存在的 workspace 脚本（仅限本地测试数据库）：

   ```bash
   docker compose -f infra/local/compose.yaml exec -T backend-server \
     npm run bootstrap:local --workspace=@b2c/backend
   ```

   脚本幂等创建/复用 USD Store、含 `us` 的 Region、Sales Channel、库存位置、渠道关联的 Publishable API Key 和已发布测试商品。新建测试商品为 USD 10、SKU `TEST-001`、Size `One Size`、库存 10；复用现有商品/库存时不会强制重置为这些初始值。该脚本不启用 Stripe，也不是生产初始化脚本。
3. key 不打印到日志，而是写入执行进程所在容器的受保护文件，默认 `/tmp/local-publishable-key`（可用 `LOCAL_PUBLISHABLE_KEY_FILE` 改路径）。通过受保护的本地设置流程读取并注入 `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`，不要输出实际值、放进 shell 历史、提交文件或截图。本页不提供真实 key。
4. Compose 从启动它的环境读取 `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`；缺失时的 `replace-after-local-admin-setup` 不是可用 key。注入后需重新创建 Storefront 容器才会更新进程环境：

   ```bash
   docker compose -f infra/local/compose.yaml up -d --force-recreate storefront
   ```

   `apps/storefront/.env.local` 不会自动成为 Compose 的变量来源；本机 Next.js 开发与 Compose 的环境作用域要分开处理。不要修改或提交真实环境文件来共享配置。

店面运行时环境边界见 `apps/storefront/src/lib/store.ts`、共享 `medusa-http.ts`、购物车 `cart-server.ts` / `cart-policy.ts` 和 `.env.example`：

| 变量 | 作用与约束 |
| --- | --- |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | 本机可用 Backend 地址，示例 `http://localhost:9000`。 |
| `MEDUSA_BACKEND_URL_INTERNAL` | 可选、仅服务端优先覆盖。Compose 注入 `http://backend-server:9000`；宿主机开发应留空，不能照搬 Docker 主机名。 |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | 运行时使用实际本地 publishable key；构建占位值不能访问 Store API。当前商品客户端组件不接收此值。 |
| `NEXT_PUBLIC_DEFAULT_REGION` | 两位国家代码，如 `us`，不是 Region ID；服务端查询真实 Region，商品请求附带 `region_id` 和 `country_code`，创建 cart 同时设置该国家的 shipping address，保存 cart 必须匹配国家/Region/币种。 |
| `MEDUSA_SALES_CHANNEL_ID` | 可选服务端渠道 ID；当 key 关联多个渠道时必须选择它授权的一个渠道，否则 Medusa 库存计算会失败。当前 Compose 未透传该可选变量，本地 bootstrap 应使用单渠道 key；多渠道场景需另行显式配置服务环境，不能仅在宿主机 export 就假定容器收到。 |
| `NEXT_PUBLIC_BASE_URL` | 运行时购物车 Origin/cookie 策略；本地 `http://localhost:8000`，生产必须 `https://`。仅允许无账号、query/hash、非根路径的基础 URL；HTTP 仅允许 `localhost`、`127.0.0.1`、`[::1]`。浏览器 origin 必须精确匹配配置（scheme/host/port），不能混用 localhost/127.0.0.1。 |

服务端通过 `Reflect.get(process.env, …)` 运行时读取商品/购物车连接配置及 base URL，避免 Next.js 固化构建占位值。共享 transport 优先内部 Backend 地址，发送 `x-publishable-api-key`、不缓存并限制超时；公开模型及安全错误不包含 cart 身份、凭据、内部 URL 或后端诊断。不要使用 Admin secret key 替代 publishable key。购物车写入不自动重试。

## 访客购物车功能与运行时约束

- `/store/[handle]` 可将当前选中、已定价且可购买的变体加入真实 Medusa cart；`/cart` 显示真实单价、行小计/估算行合计，以及 Medusa 返回的 subtotal/discount/tax/total。金额为主单位；缺失金额不编造。运费未选择，税费与库存仍可能变化，不承诺免费运费或最终订单总额。
- 数量更新接受整数 1–99，移除是单独操作；Medusa 决定真实可用库存及数量相关价格。加入时复核发布、渠道可见、完整规格、价格及已有同变体合计数量；增加已有行也重新核验商品/变体可见性，减少/移除不要求重新购买资格。
- 创建 cart 使用当前国家、Region、币种及可选渠道；读取/写入保存 cart 必须匹配这些上下文。未显式指定渠道时，通过商品渠道校验确认保存渠道仍被当前 key 授权（空目录有效），不能只依赖 Medusa 的 cart retrieval/line-write 授权。上游失败不放行写入或自动清 cookie。
- 浏览器身份来自 `medusa_guest_cart` cookie：HttpOnly、SameSite=Lax、Path=/、Max-Age 30 天，不来自请求 JSON 或客户端公开 cart 模型。本地 HTTP loopback cookie 不带 Secure，即使 Next 是 production mode；HTTPS cookie 带 Secure，部署生产应使用精确匹配的 HTTPS base URL。有效期配置已离线检查，不等于真实 30 天留存已测试。
- `POST /api/cart` 要求配置的精确 Origin、JSON 和同源 Fetch Metadata（若存在），校验有界输入及行归属。非 loopback HTTP 被明确拒绝；不通过伪造 Host/forwarded headers、Origin 重写或放宽 CSRF 来支持接口 IP 访问。
- 缺失、已完成或不兼容的保存 cart 要用户显式 reset，不静默新建/转移商品。Reset 只清当前浏览器 cookie，不删除远端 cart、订单；即使 Backend/Region 不可用仍可 reset，但仍要求有效的 base URL/Origin。
- 所有浏览器变更控件共享 origin-wide exclusive Web Lock；pending 时禁用，其他标签竞争操作被拒绝而非排队/重放。无 Web Locks（需安全上下文或 localhost）则不发送写入；这不是服务端或分布式锁。结果不确定时先打开/刷新 `/cart` 核对，不重复提交。
- 无购物车数量徽标、checkout、支付或订单完成；Stripe 暂缓，不增加搜索，当前仍为中性功能 UI，非最终品牌设计。

### 购物车运行证据与验收状态

**production Storefront HTTP 集成已通过（运行报告，非浏览器 QA）：** 所有变更均走 `POST /api/cart`，精确 localhost Origin 与隔离 cookie；没有直接对 Medusa 执行 cart 写入。`/cart` SSR 和只读 Medusa 查询交叉确认以下结果：

1. USD 10、SKU `TEST-001`、库存 10 的测试商品成功加入真实 cart，响应设置 HttpOnly、SameSite=Lax、HTTP 本地 non-Secure cookie。
2. 刷新和重新打开 HTTP cookie 会话保留原 cart/行；数量 1 → 3 → 2，行及 cart 金额 $10 → $30 → $20；增加到 11 被拒，仍为 2/$20。
3. 无效数量、缺失/不存在的变体、错误 Origin、跨站请求被拒；更新/移除另一隔离 cart 的行被拒且两边均未变化。
4. 移除后为空，SSR 显示空 cart；不存在的保存 cart 要显式 reset，reset 清 cookie 而不删除远端记录。
5. 22 张受保护业务表（含商品、价格、库存、预留、订单、支付、通知）前后只读哈希相同，原商品/库存保持不变。运行结束时保留两个自有本地一次性空 cart，后续已精确软删除，见下文清理重试结果；真实身份仅留在受保护清单，不在文档输出。
6. 无 checkout、支付、订单完成、邮件或 R2 操作；复用容器配置中外部邮件/R2 凭据被禁用。未修改真实环境文件或 Backend 源码。HTTP 会话复开不等于浏览器重启/cookie 交互已验证；折扣、税费和 live provider 场景也未覆盖。

**宿主机购物车手动验收：用户报告通过（2026-11-25）。** 在提供 Windows localhost 访问说明和清单后，用户回复“测试完成没问题”。清单范围为选中变体加购、数量 1 → 3 → 2 对应 $10 → $30 → $20、刷新/新标签持久性、尝试 11 件库存拒绝、删除后为空。此为整体手动验收通过，不是代理亲自观察浏览器，也不拆成逐项已证实结果；没有截图、Console 或 DevTools 证据，不要求重做本轮验收。与前序商品媒体验收分开记录。

**购物车轮清理重试已完成（2026-11-25，保存证据及独立只读复核）。** 受保护最终状态为 `cleanup_complete`，无待处理的 cart 删除或 Windows 映射清理项；数据库卷和原有业务数据保留。宿主机手动验收仍为用户报告通过，不因停止预览要求重做。这里的完成指精确软删除及停服/映射清理，不是物理清空数据库或移除保留资源。

- **进程与监听：** 重试仅临时启动既有 PostgreSQL、Redis，完成后均停止；未启动 Backend Server/Worker 或预览。本次只读检查未发现项目 Node/Next 进程，Linux `8000`、`9000`、`55432`、`56379` 均无监听；自有 production Next 和 WSL TCP forwarder 保持停止，预览链接不再是运行入口。
- **Docker 留存：** Backend Server、Worker、PostgreSQL、Redis、迁移容器均为 `exited`。5 个容器身份、原网络身份及卷挂载与清理前受保护快照一致，2 个命名卷均存在；未执行 `down`、`rm`、`prune` 或卷删除。停止容器不等于删除数据。
- **原有数据（保存证据，不是实时数据库复验）：** 独立核对历史运行清单中前后 22 张受保护业务表数量/哈希一致；本次重试状态另记录原 Test Product、变体、价格和库存相关记录在操作前后均与保留基线逐项一致，仍为 USD 10、SKU `TEST-001`、库存 10。本次文档复核未连接数据库，重试前后不变依据保存的验证记录，不把卷存在单独视为数据不变证明。
- **两个空测试 cart 均已精确软删除：** 原自有清单与恢复快照中的两个唯一目标匹配，删除前为空、未完成，历史行无活动记录；重试记录确认无订单、支付、库存预留及其他不允许的关联，仅通过 Medusa Cart Module 的 `softDeleteCarts` 处理这两个精确目标。两个目标各自的验证均为普通服务查询不可见、数据库保留行 `deleted_at` 已设置。属于软删除（逻辑删除），**非物理清除**，保留行及受保护恢复材料仍在。先前权限拒绝属于历史，本次重试无新的权限拒绝。
- **重试入口与临时文件：** 首次执行在入口加载前因模块导入错误失败，未发生数据变更；修正临时脚本后执行成功、退出码 `0`。重试记录确认临时脚本已移除。历史 harness/forwarder 脚本、日志及维护输入的清理事实不变，未泛化清理目录；商品媒体六份验收/清理证据仍保留。
- **受保护状态保留：** `.claude/cart-runtime/cleanup-status.json` 保存最新脱敏状态，连同 `manifest.json`、`cleanup-recovery.json` 作为追溯/恢复材料保留；本次确认均为 `0600`、目录 `0700`，由 Git 忽略。不要输出 cart 身份、凭据或恢复清单内容，也不要重跑已删除的生命周期 harness。
- **Windows 转发已移除：** 用户明确报告已手动删除；本次另通过只读注册表检查确认 `127.0.0.1:8000` 对应规则不存在。删除动作由用户完成，代理仅直接确认当前缺失状态，未修改任何 Windows 网络配置。
- **剩余验收证据边界（不是要求重做已通过的验收）：** 规格清空、hydration、pending/disabled、跨标签 Web Locks/不支持提示、响应式、Console、浏览器重启及生产 HTTPS Secure 行为没有独立验证；整体反馈不自动证明这些项目。

以上质量/HTTP 结果来自实现、复核及运行报告。前序清理重试执行了精确软删除并临时启动/停止既有 PostgreSQL、Redis；本次独立复核仅核对进程、端口、容器/卷/网络、Windows 注册表及保存证据并更新本页与 `README.md`，未重跑测试、lint、typecheck、build，未重启服务、执行 cart 写入、重复删除、浏览器或外部服务验证。重试及本次复核均无外部邮件、支付或 R2 操作；未修改源码、真实环境、依赖、`CLAUDE.md` 或 Git 历史，未 commit/push；不将历史报告表述为本次新执行。

### Windows 宿主机 localhost 连通与映射清理

**历史连通证据：** 初次 Windows localhost 请求失败时没有匹配的 portproxy 规则，PowerShell 非管理员；代理没有创建 Windows 映射，也没有提权/UAC、修改防火墙或 `.wslconfig`。随后本轮自有 Node TCP forwarder 仅绑定 WSL eth0 并转发到 Next 的 loopback 端口，逐字节转发、不改 Host/Origin、不记录请求体。Linux 和 Windows 对转发目标、保留 localhost Host 的 GET 均返回真实商品/购物车页面；无 cookie 的空 JSON POST 返回预期 400，无有效 cart 动作。用户随后报告购物车手动验收通过，不据此推断逐项浏览器行为或映射创建者。

**最终清理结果：** Linux forwarder、Next 及四服务均停止，forwarder 脚本/状态/日志的历史清理已完成。先前仍在的 localhost `8000` portproxy 规则，用户现明确报告已手动删除；本次通过 Windows PowerShell 只读检查 `HKLM\SYSTEM\CurrentControlSet\Services\PortProxy\v4tov4\tcp`，确认值名 `127.0.0.1/8000` 不存在。用户手动删除与代理直接只读验证是不同证据；代理没有执行 Windows 删除、提权或网络配置修改。

该项无需再执行删除命令，不为验证重启服务、不重新添加映射、不改其他规则。保留资源及恢复材料不属于待删除项；旧验收链接不是当前运行入口。

## 商品列表/详情：功能与实际验证

当前界面是中性响应式功能界面，**最终 UI/品牌视觉设计单独推进**，不属于本轮商品功能已完成的声明。

- `/store`：当前渠道可见的已发布商品，每页 12 件，有界分页、空目录及超页提示，列表链接到详情。
- `/store/[handle]`：真实标题、纯文本描述、图片/无图占位、按区域的变体价格、规格选择、SKU、库存/缺货/允许预订状态。Medusa v2 金额以主单位显示，不额外除以 100；商品页不报价最终税费和运费。
- 成功查询且无匹配商品调用 `notFound()`；配置/授权错误、国家未配置 Region、Backend 不可用分别显示安全提示，不伪装成 404 或空列表。
- 图片 URL 仅允许无内嵌用户名/密码的 HTTP(S)，浏览器直接加载，图片不携带 Store API key；没有服务端通配图片代理。`ProductImage` 用 `onError` 显示占位，源码阅读/SSR 不等于浏览器已加载或已验证失败事件。

### 前序真实本地 HTTP/SSR 结果（历史证据）

以下来自前序运行验证报告，不是浏览器 QA，也不是当前预览状态；当时使用单独启动的 **production Storefront build**（端口 8010）和真实本地 Medusa，不是 Compose 的 Next.js 开发进程：

1. Compose 受控迁移先成功，Server 健康、Worker 持续运行，幂等 bootstrap 成功。
2. Store API 返回一个已发布测试商品：USD 10、库存 10、SKU `TEST-001`、Size `One Size`、无图片。
3. `/store` 和 `/store/test-product` 返回 HTTP 200，出现真实商品/链接、`$10.00`、US/USD 区域、正确库存和初始 `One Size` 选中状态；无描述/图片时显示真实缺省提示。
4. 不存在的商品返回 404 和 `noindex`。自定义 not-found 文案及返回列表链接存在于 Next.js hydration payload；初始 HTML 是错误壳，不能声称浏览器最终页面已验证。
5. `/store?page=2` 显示诚实的空页提示及返回导航；页码 0 回退第一页；首页链接到 `/store`。
6. 响应未泄漏实际 publishable key、构建占位 key 或内部 Docker 主机名；停止 Backend 后，列表和详情都显示 `Catalog temporarily unavailable`，不暴露连接细节。

该次前序验证显式禁用外部 Resend/R2，未上传文件、支付或进行外部账号操作，真实 `.env` 文件未改动。

### 本轮商品媒体验证与独立复核（2026-11-25）

**媒体轮结束时状态：媒体 workflow/关联/HTTP 验证通过；宿主机手动验收按用户报告通过，清理重试已完成、当轮预览已停止。** 本节及后续媒体清理记录为历史证据；当前购物车预览另见上节。前述 8010 无图联调是历史验证；媒体轮预览使用 **127.0.0.1:8000**，外部 R2 被用于一张专用合成图片，不能描述为媒体轮“禁用 R2、无上传”。没有邮件、订单或支付操作。

运行代理报告的真实操作与结果（文档复核不重复上传或访问 R2）：

1. 复用并启动原 PostgreSQL、Redis、Backend Server/Worker 容器，没有重建/删除容器、网络或卷；原一次性迁移容器成功退出 `0`。
2. 通过独立 `medusa exec` 调用 Medusa File workflow 和已配置的 R2 provider，上传专用合成 PNG。匿名公开 GET 为 `200` / `image/png`，下载字节与本地 PNG 一致。
3. 保存原商品媒体快照后，只修改本地 `test-product` 的 `images` 和 `thumbnail`；Store API 确认关联，列表/详情 SSR 中均出现测试图片 `<img>`。原商品仍为 USD 10、库存 10、SKU `TEST-001`、Size `One Size`，未改变其变体结构。
4. 创建独立、可撤销的双变体验收商品，Small USD 11 / Medium USD 17、不同 `QA-S-…` / `QA-M-…` SKU，均关闭库存管理。Store API 确认数据，但不是浏览器切换事件证据。
5. 响应及 19 个客户端 JS 文件检查未发现实际 key、构建占位 key 或内部 Backend hostname。根 `npm test` 为 Backend 20/20、Storefront 44/44。

独立只读复核确认：Linux 回环 `8000` 由 PID `81232` 的 production `next-server` 监听，工作目录是本仓库 Storefront；列表、原商品详情和双变体详情均为商品页面（非配置错误页），列表与原详情含相同图片 URL 的 `<img>`，原详情包含 `$10.00`、`TEST-001`、`One Size`，双变体详情有 Small/Medium 选项。空分页 HTTP 200、独立缺失商品 HTTP 404，Backend `/health` 200；四个服务容器运行，迁移容器退出 `0`。独立重跑 Storefront 离线测试 44/44 通过。

**覆盖边界：** 前序运行验证无业务源码/测试变更，未重跑 lint/typecheck/build，预览复用已有 production build。本次仅更新验收文档，未重跑任何质量命令；Backend 20 + Storefront 44 通过为前序证据。既有纯函数测试覆盖规格匹配、初始选择、图片 URL 过滤，不覆盖 React 事件或 hydration；没有新增“规格修复”或交互回归测试。上传使用受控 workflow 回退，不是 Admin HTTP multipart 认证上传接口；运行代理报告缺少管理员凭据，原 Backend 容器未启用 R2 上传配置且现已停止，因此不能据此声称 Admin 上传可用。本轮清理最终记录另有专用对象删除后 provider 读取 `NoSuchKey / HTTP 404` 的证据，不借用此前独立 File smoke test 的删除结果。

### 宿主机浏览器验收清单（用户报告通过）

**2026-11-25 用户原话：“已测试完成 没有问题”。** 此反馈发生在提供商品图片、Test Product 规格选择、双变体 `$11` / `$17` 切换、空分页及 404 的宿主机浏览器入口后，记录为用户报告的手动验收通过，不表示代理亲自观察浏览器，也不表示每项断言或 DevTools 检查均已完成。代理没有可操作的浏览器，未取得截图、Console 或 DevTools 证据；不将整体反馈拆成逐项已证实结果。

以下保留原入口与验收标准供追溯，**不是逐项通过记录，也不是要求重新验收或保证入口永久可用**。媒体轮预览/proxy 在该轮清理后停止，当时 `8000` 无监听；后续购物车 preview 重新使用该端口。QA 双变体商品及专用图片已按最终记录删除，原商品媒体已恢复为空。以下入口与图片、双变体操作描述均是验收时的历史状态，不代表当前内容；本次未重新验证宿主机映射/浏览器可达性。不要为了重做媒体验收重启服务、公开暴露 Backend 或改为无保护的公网监听。

| 入口 | 用户操作与通过标准 |
| --- | --- |
| [列表](http://localhost:8000/store) | Test Product 卡片显示蓝黄棋盘格，点击进详情、返回列表及刷新均正常。 |
| [原商品详情](http://localhost:8000/store/test-product) | 图片实际可见，DevTools 中图片 `naturalWidth > 0`；Size 从 `One Size` 清空为 `Select size` 后，**规格状态区**显示选择提示并隐藏其 SKU/变体价格，重新选择后恢复 `$10.00`、`TEST-001` 和库存状态。页面上方商品汇总价格保留是预期行为。 |
| [双变体详情](http://localhost:8000/store/qa-variants-cc1ce128-a60f-4cec-bbe5-1d7fec820bab) | 初始要求选择规格；Small/Medium 来回切换，规格状态区分别为 `$11.00` / `$17.00`、不同 `QA-S-…` / `QA-M-…` SKU 和 `In stock`；清空后回到提示。 |
| [空分页](http://localhost:8000/store?page=2) | 显示空页提示及返回导航。 |
| [缺失商品](http://localhost:8000/store/qa-missing-cc1ce128-a60f-4cec-bbe5-1d7fec820bab) | 确认浏览器最终呈现自定义 404 及返回列表链接，而不只是在 hydration payload 中出现文案。 |

- DevTools 临时阻断棋盘格图片请求并刷新，确认 `No image available`；解除阻断并**再次刷新**后恢复图片。只解除阻断不会自动重置组件已记录的失败状态。
- 在 375、768、1440 宽度检查无水平溢出、图片布局正常；用键盘操作链接和规格选择，确认焦点可见。
- Console 检查 hydration/运行错误，记录导航、刷新、选择及图片失败/恢复情况；人为阻断引起的网络失败是预期，不与未阻断时的异常混淆。
- 如后续补充逐项证据，可记录浏览器/宽度、通过项目和失败现象；截图或 Console 文本须避免包含 key、真实账号和受保护文件。上述补充项未因本次整体反馈自动标记为已执行。

### 当前留存与回滚边界

本节保留**商品媒体轮结束时**的清理/复核事实。后续购物车轮曾重启服务，现也已完成清理重试；当前停止状态、cart 软删除及 Windows 映射清理以上文购物车节为准。媒体恢复和专用 QA 商品/图片删除的完成事实不变。

**媒体轮清理重试已完成（2026-11-25）：** 受保护最终状态为 `cleanup-complete`，该次重试无新的权限拒绝。先前媒体清理被拒的记录已被成功结果取代，不要求用户重复口头授权。以下“本次”仅指媒体清理文档轮的保存证据及当时实际只读检查：未重启服务、查询实时数据库、访问 R2 或重试被拒动作。

- **恢复/数据库证据（保存记录核对）：** 原商品清理前后 ID 与原清单一致，清理后媒体精确匹配原清单的 `thumbnail=null`、`images=[]`。排除媒体及 `updated_at` 后，前后商品快照业务字段一致；最终记录与清理状态中的业务哈希相同，记录原商品仍为 SKU `TEST-001`、USD 10、库存 10、1 个变体。管理员、认证、Store、Region、渠道、API Key、库存等 13 张受保护表的清理前、清理后、清理状态与最终记录的数量/内容哈希均一致。服务已停止，这不是实时数据库复验。
- **删除证据（保存记录核对）：** QA 商品清理前快照的精确 ID、handle 与清单一致；最终状态记录精确删除后 ID、handle 均无活动记录。专用 PNG 的单对象删除通过 File Module 配置的 provider 完成，最终记录明确保存删除后读取 `NoSuchKey / HTTP 404` 的结果，不仅凭删除调用成功判断，也不借用先前 smoke test。本次未重新访问 R2 或实时查询 QA 商品。
- **实际进程/端口复核：** `/proc` 检查 PID `81232`、`96055` 均不存在，TCP `8000`、`9000`、`55432`、`56379` 均无监听。预览及 proxy 已停止，未重新请求商品页、健康接口或检查宿主机浏览器。
- **实际 Docker 复核：** PostgreSQL、Redis、Backend Server、Worker 四个容器均为 `exited`，容器 ID 与清理前基础设施快照一致；迁移容器仍为 `exited`、退出码 `0`。五个容器保留，`b2c-medusa-local_default` 网络 ID 未变。命名卷 `b2c-medusa-local_postgres-data`、`b2c-medusa-local_redis-data` 均存在，名称、driver、创建时间与最终证据一致，仍分别挂载到原 PostgreSQL/Redis 容器。未删除容器、网络或数据卷；卷留存本身不替代业务数据核验。
- **恢复材料保留：** `.claude/acceptance/` 中 `cleanup.json`、`cleanup-status.json`、`cleanup-before.json`、`cleanup-after.json`、`cleanup-infrastructure-before.json`、`cleanup-final-status.json` 六份证据均存在，权限 `0600`、父目录 `0700`，由 Git 忽略。独立核对最终清单列出的 8 个临时文件均已不存在：`fixture.png`、`storefront-private.log`、`wsl-storefront-proxy.cjs`、`wsl-storefront-proxy.log`、`wsl-storefront-proxy-state.json`、`finalize-acceptance.ts`、`cleanup-launcher.cjs`、`cleanup-verify-readonly.cjs`。不要打印、截图、发送或提交受保护恢复清单及快照中的凭据或对象 URL。
- 清理报告记录未新增上传、发邮件、支付、commit/push，未修改源码或真实 `.env`；前序媒体上传事实不变。本次只读复核及文档更新没有上述运行操作；仅修改本页与 `README.md`，未重跑测试、lint/typecheck/build。bootstrap key 默认留在已停止的 Backend 容器内 `/tmp/local-publishable-key`，本次未读取或回显其值。
- **媒体轮与购物车轮均无待重试的上述清理阻塞：** 两个空 cart 已精确软删除（非物理清除），Windows 规则由用户手动删除且经只读检查确认不存在，服务均已停止。Admin HTTP multipart 认证上传及媒体集成回归仍未验证，不因清理成功而变为已完成。未来新的运行或清理动作仍须遵守权限系统并重新核验精确目标；不移除保留容器、网络或 PostgreSQL/Redis 数据卷。

### 后续工作

商品媒体宿主机手动验收已按用户报告通过，该轮受控清理及保存证据核对完成，不要求重复口头授权或重做媒体验收。后续补齐 Admin HTTP multipart 认证上传验证及商品媒体集成回归测试。访客购物车已实现，102 个 Storefront 离线测试及真实 production Storefront HTTP 集成通过；购物车宿主机手动验收也已按用户报告“测试完成没问题”通过（非代理浏览器逐项证明）。购物车轮清理重试已完成：两个空 cart 精确软删除（非物理清除），Windows localhost 转发由用户手动移除并经只读注册表确认不存在；预览、forwarder 和服务停止，数据库卷与原有数据保留，无待处理清理项。结账、订单店面闭环及其集成测试仍未实现；现有通知模板/订阅器不代表下单已打通。**Stripe 测试支付暂缓接入**，最终 UI 单独设计，不增加搜索。任何新运行或清理仍须遵守权限系统。

## 从本地开发到 GitHub、Docker 和发布

- 本地 Docker 已可构建 Backend、Worker 和 Storefront，并先执行一次性 migration；这是本地联调，不代表已有生产流水线。
- 首次基线已提交并推送到 `origin`/`main`（提交 `da134d4`，71 个文件）。源码版本管理与正式发布准备度分开判断，不必等全部业务功能或最终 UI。
- CI 已建立：`.github/workflows/quality.yml` 在 PR、`main` push 和可复用调用时执行 `npm ci`、Compose 配置校验、lint、typecheck、`npm test` 和完整构建，只使用公开占位构建变量，不读取真实凭据。
- 镜像发布已建立：`.github/workflows/publish.yml` 先用 `quality` 复用工作流做门禁，通过后以提交 SHA 和 `main` 标签推送 `ghcr.io/<owner>/medusa-backend`（Server 与 Worker 同镜像）和 `ghcr.io/<owner>/medusa-storefront` 到 GHCR，使用 `GITHUB_TOKEN` 和 `packages: write`，并带 Buildx 缓存与 OCI source/revision 标签。首次成功运行与镜像可见性尚未验证。
- Storefront Dockerfile 现为多阶段：Compose 使用 `development` target 保持 `next dev`，GHCR 使用 `production` target 运行 `next start`。生产阶段以非 root `node` 用户运行，构建不需要真实环境变量。
- 本地已用清洁 Git 上下文实际构建并启动过两个镜像：Storefront 生产镜像 `/store`、`/cart` 返回 200，Backend 不可达时显示安全提示；Backend 镜像从空库迁移成功、`/health` 与 Admin 均返回 200。测试容器、网络和临时镜像已清理，未推送任何镜像。
- staging/production 仍需 Caddy、独立环境注入、备份恢复验证，以及“单独迁移 → 管理员 bootstrap → Server/Worker 启动 → 健康检查”的顺序。不能把本地 Compose 当作生产部署。
