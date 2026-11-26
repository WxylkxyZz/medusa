# B2C 独立站（Medusa）

当前项目已有本地 npm workspace、Medusa Backend/Worker、Next.js Storefront、本地 PostgreSQL/Redis Compose、Dockerfile 和环境模板。Resend Notification Provider、订单确认/发货/密码重置模板与订阅器、本地 Store/Region/Sales Channel/Publishable API Key/测试商品 bootstrap 已实现并完成本地验证。Storefront 商品列表、详情和访客购物车已实现，并用真实本地 Medusa 数据完成 HTTP/服务端渲染验证；购物车宿主机手动验收已按用户报告通过（非代理浏览器实测或逐项证明）。这不是最终 UI 设计，结账、订单店面闭环和支付仍未实现。

R2 文件 provider 已配置，先前真实 smoke test 已验证上传、公开 URL 访问、File Module 读取、删除以及删除后的拒绝访问。本轮已通过独立的 `medusa exec` / File workflow 上传合成 PNG，验证公开读取及本地商品图片关联，列表/详情 SSR 均输出真实图片标签；**宿主机手动验收已按用户报告通过（“已测试完成 没有问题”），非代理浏览器实测或逐项检查证明**。这不覆盖 Admin multipart 上传接口；媒体轮复用的旧 Backend 容器未启用 R2 上传配置，并在该轮清理时停止；后续购物车联调已再次启动原服务，当前状态见下文。Stripe 明确暂缓；CI 与 GHCR 镜像发布已建立（`.github/workflows/quality.yml`、`publish.yml`，发布 `medusa-backend`/`medusa-storefront` 的 `main` 与 `sha-<sha>` 标签），其中 `sha-1d7cf47…` 已实拉启动验证，最新 `sha-f601b34…` 镜像仅经 GitHub Packages API 确认存在，实拉启动验证因本机 ghcr.io 拉取受阻仍未完成（见下文）；生产 migration/recovery scripts、Caddy、staging/production 部署、结账与订单闭环仍未实现。

## 当前文档

- [本地开发与验证](docs/local-development.md)：质量命令、运行时 key/bootstrap 设置、商品功能及验证边界。
- [架构图](B2C%20独立站架构图.html)：运行架构、构建部署、版本更新、数据备份和常见问题。
- [交接文档](B2C-Medusa-交接文档.md)：本地-only 的架构决策和历史资料，不随仓库分发；历史状态必须以当前源码和实际验证为准。
- [Claude Code 工作说明](CLAUDE.md)：当前项目边界、目标目录和初始化规则。

## 当前边界

- 当前项目根目录：`/home/ubuntu/Medusa`
- 开发与调试平台：本地 Linux
- 旧版 `/home/ubuntu/B2Csite`：不再使用
- InstaBox、云端浏览器和远程 Linux 调试机：不再使用
- Backend、Storefront、Docker、Compose 和基础质量脚本已创建；不新增搜索服务或搜索框

## Storefront 商品浏览：实现与验证

**功能实现，不是最终品牌/视觉设计：** 当前采用中性响应式界面，先打通商品浏览；最终 UI 设计是单独的设计工作。

- `/` 链接到 `/store`；`/store` 按发布状态和 publishable key 的销售渠道范围展示真实商品，每页 12 件，分页有边界及空页提示。
- `/store/[handle]` 展示名称、纯文本描述、图片/无图占位、区域价格、规格和变体选择、SKU、库存/缺货/允许预订状态。不编造商品、价格或库存；Medusa v2 金额按主货币单位处理，不再除以 100。
- 服务端运行时读取后端地址和 publishable key，按国家解析真实 Region，请求携带 `region_id`、`country_code`。两条商品路由动态渲染，API 不缓存；构建不需要可用 Backend。
- 成功查询但没有商品才返回 404；配置、区域及上游服务故障分别显示安全提示，不冒充空目录或商品不存在。图片仅接受 HTTP(S) URL，由浏览器直接加载，不经过服务端图片代理。

**自动化验证（购物车实现/复核及运行报告）：** 根 lint、typecheck、`npm test` 通过，Backend 20 个、Storefront 102 个离线测试（原商品测试 44 个，新增购物车/回归测试 58 个）。覆盖商品边界、购物车金额/数量、cookie/Origin、行归属、区域/渠道、失效购物车、非重试写入及 Web Locks 协调等；不是浏览器 E2E。复核报告记录完整根 workspace build 在占位公开配置和不可达 Backend 下通过，包含 Backend、Admin 与 Storefront，无 Backend 构建失败；运行报告另记录 fresh Storefront production build 通过。商品、购物车及 API 路由保持动态。编译检查确认运行时环境读取保留，运行报告检查响应及 22 个客户端 JS 未见测试的 key/Backend 配置标记；这不是对所有可能泄漏的穷尽证明。

**真实本地运行观察：** 前序验证已覆盖 USD 10、库存 10、SKU `TEST-001`、Size `One Size`、空分页、无效页码回退、缺失商品 404/noindex 和 Backend 停止后的安全提示。当时禁用外部邮件/R2、商品无图片。本轮在保留原媒体快照后，仅关联一张合成 PNG 到 `test-product` 的 `images`/`thumbnail`；上传、公开 GET `200 image/png` 及字节一致性来自运行代理报告，Store API 关联和列表/详情图片标签也已验证。另建独立双变体验收商品（Small USD 11 / Medium USD 17），不改原商品变体。独立复核确认 `127.0.0.1:8000` 为 production Storefront 进程，列表和两个详情确实有商品而非配置错误页，空页 200、缺失商品 404；本轮运行报告的响应及 19 个客户端 JS 检查未见 key/内部地址泄漏。未进行支付、邮件或下单。

**宿主机手动验收：用户报告通过（2026-11-25）。** 在提供商品图片、Test Product 规格选择、双变体 `$11` / `$17` 切换、空分页和 404 的宿主机浏览器入口后，用户回复“已测试完成 没有问题”。这记录整体手动验收通过，不表示代理亲自观察浏览器，也不表示每项断言、hydration、响应式宽度、图片失败/恢复或 DevTools/Console 检查均已完成；没有代理操作的浏览器、截图或控制台证据。原清单保留为[验收范围与证据边界](docs/local-development.md#宿主机浏览器验收清单用户报告通过)。

**商品媒体轮清理重试已完成（2026-11-25，历史状态，非当前运行状态）：** 受保护最终状态为 `cleanup-complete`，本次重试无新的权限拒绝。保存的前后快照与原清单核对一致：原商品仅恢复媒体为 `thumbnail=null`、`images=[]`，除媒体及更新时间外业务字段相同；原商品业务哈希相同，仍为 SKU `TEST-001`、USD 10、库存 10、1 个变体，13 张受保护表的数量/内容哈希一致。QA 商品清理前精确 ID/handle 与清单一致，最终记录确认二者均无活动记录；专用 PNG 经配置的 provider 单对象删除后，读取返回 `NoSuchKey / HTTP 404`。以上为保存证据的独立核对，本次未查询实时数据库或访问 R2。实际只读检查确认 PID `81232`、`96055` 已不存在，`8000`、`9000`、`55432`、`56379` 无监听；四个服务容器均已退出，迁移容器仍退出 `0`。五个容器、原网络及 PostgreSQL/Redis 命名卷均保留且核对身份一致。8 个清单内临时文件已不存在，受保护恢复材料与最终证据保留。详见[留存与回滚边界](docs/local-development.md#当前留存与回滚边界)。

## 访客购物车：实现、验证与清理状态

- 详情页把**当前选中的可购买变体**加入真实 Medusa cart；`/cart` 支持数量更新（整数 1–99，实际库存仍由 Medusa 决定）和移除。展示真实单价、行金额和 Medusa 估算合计，不捏造税费、免费运费或最终购买总额。
- 购物车身份仅来自 HttpOnly、SameSite=Lax、Path=/、30 天 cookie，不写入客户端公开模型。cookie 策略运行时读取 `NEXT_PUBLIC_BASE_URL`：HTTP 仅允许 loopback，cookie 不带 Secure，即使 Next 运行于 production mode；生产必须 HTTPS，cookie 带 Secure。浏览器 origin 必须与配置完全相同，`localhost` 和 `127.0.0.1` 不能混用；写入只接受同源 JSON。
- 复用商品运行时后端/key/国家与 Region 解析及可选渠道配置；创建 cart 设置国家，保存 cart 必须匹配国家、Region、币种及授权渠道。加入/增加数量重新核验发布及渠道可见性，缺失/已完成/不兼容的 cart 要显式 reset；reset 仅清 cookie，不删除远端 cart/订单或转移商品，上游故障不自动清 cookie。
- 浏览器控件使用 origin-wide Web Locks，竞争操作被拒绝而非排队；无 Web Locks 时不发送写入。这不是服务端分布式锁。写入不会自动重试，结果不确定时先打开/刷新购物车核对，勿重复加购。

**真实本地 HTTP 集成（运行报告）：** 所有变更经过 production Storefront 的 `POST /api/cart`、精确 localhost Origin 和隔离 cookie；不是绕过店面直接写 Medusa。`/cart` SSR 与只读 Medusa 查询交叉确认：USD 10 商品加购成功；HTTP cookie 保存/刷新及重新打开 HTTP cookie 会话仍指向原购物车；数量 1 → 3 → 2 对应 $10 → $30 → $20，增加到 11 被拒且保持 2/$20；无效数量/变体、错误 Origin、跨站请求及另一购物车行的更新/移除均被拒；移除后为空，缺失 cart 需显式 reset。22 张受保护业务表前后哈希相同；原商品/库存未改，无 checkout、订单、支付、邮件或 R2 操作。HTTP cookie 会话测试不等于真实浏览器重开验证。

**宿主机购物车手动验收：用户报告通过（2026-11-25）。** 在提供 Windows localhost 访问说明及购物车清单（选中变体加购、数量 1 → 3 → 2 对应 $10 → $30 → $20、刷新/新标签持久性、尝试 11 件库存拒绝、移除后为空）后，用户回复“测试完成没问题”。这是整体手动验收通过，不是代理浏览器实测、截图/Console 证据或逐项断言证明；不要求重做该轮验收。hydration、pending/disabled、跨标签 Web Locks、响应式、Console、浏览器重启、生产 HTTPS cookie 及真实折扣/税费/provider 行为未获独立验证。

**购物车轮清理重试已完成（2026-11-25），数据库卷和原有数据保留：** 受保护最终状态为 `cleanup_complete`，没有待处理的购物车删除或 Windows 映射清理项。重试仅临时启动原 PostgreSQL、Redis，完成后均已停止；本次独立只读复核确认项目 Node/Next 进程不存在，Linux `8000`、`9000`、`55432`、`56379` 均无监听。Backend Server、Worker、PostgreSQL、Redis 及迁移容器均为 `exited`；原 5 个容器、2 个命名卷及网络身份/挂载与保留快照一致，全部保留，未执行 `down`、`rm`、`prune` 或卷删除。预览已停止，不提供当前可用的预览链接。

- **两个空测试购物车均已精确软删除：** 保存的原自有清单与删除前快照匹配，均为空、未完成；重试记录确认无订单、支付或库存预留关联，通过 Medusa Cart Module 的 `softDeleteCarts` 仅处理这两个目标。逐个删除后验证为普通服务查询不可见、数据库保留行的 `deleted_at` 已设置。属于软删除（逻辑删除），**不是物理清除**；不声称数据库无残留。
- **原有业务数据保留：** 历史运行前后 22 张受保护业务表数量/哈希核对一致；本次重试记录另确认原 Test Product、变体、价格和库存相关记录与保留基线逐项一致，操作前后未变（`TEST-001`、USD 10、库存 10）。本次文档复核未连接已停止的数据库，重试结果依据受保护保存记录，不冒充实时数据库复验。
- **Windows 转发规则已由用户手动删除：** 用户报告已完成；本次另通过只读 Windows 注册表检查确认 `127.0.0.1:8000` 对应 portproxy 规则不存在。用户执行删除与代理直接只读确认分开记录；代理未修改 Windows 网络配置。
- 重试记录无新的权限拒绝；首次入口加载前模块导入失败、未改数据，修正临时脚本后成功执行。记录确认临时脚本已移除；历史 harness/forwarder 清理及商品媒体证据留存事实不变。
- 脱敏状态 `.claude/cart-runtime/cleanup-status.json` 与恢复材料保留，文件权限 `0600`、目录 `0700`，由 Git 忽略；不输出 cart 身份、凭据或恢复清单内容。详见[购物车运行证据与验收状态](docs/local-development.md#购物车运行证据与验收状态)。

**本次复核与文档更新边界：** 仅执行只读进程/端口、Docker、Windows 注册表及受保护保存证据核对，并更新本页和本地开发文档；未重启服务、重复删除、查询实时数据库、访问 R2、执行 cart 写入或浏览器操作，未重跑测试/lint/typecheck/build。前序重试实际执行的软删除与本次独立只读复核区分记录；没有外部邮件、支付或 R2 操作。上列质量、HTTP 与手动验收结果仍为前序证据；未改真实环境、`CLAUDE.md`、源码或 Git 历史，未 commit/push。

## 目标架构

- Medusa v2 Backend + Worker
- Next.js Storefront
- Caddy 反向代理
- Supabase PostgreSQL
- Upstash Redis
- Cloudflare R2
- Stripe 测试支付（暂缓接入）
- Resend 邮件通知
- staging 彩排、受控迁移、异地备份和站外监控

## 初始化原则

1. 所有源码、脚本、配置模板和文档都放在本项目目录。
2. 从干净的 Medusa starter 开始，不复制旧版实现或旧测试数据。
3. 先建立本地 Linux 可运行的 Backend、Storefront 和基础设施，再接入外部服务。
4. 本地、staging、production 的数据库、Redis、对象存储和密钥隔离。
5. 真实密钥只通过受保护环境文件或 Secret Manager 注入，不进入代码、镜像或普通文档。

## GitHub、Docker 与发布时机

这几个步骤要分开看：Docker 和 GitHub 基线已可用，但 CI 产物不等于可上线。

- **GitHub 源码版本管理**：`origin`（`github.com/WxylkxyZz/medusa`）已配置，`main` 已推送到 `f601b34`，本地与远端一致、工作区干净；本地 `main` 未设置 upstream tracking，后续推送仍需显式指定 `origin main`。源码版本管理与正式发布准备度分开判断；新增提交/推送仍需明确请求。
- **本地 Docker**：Backend/Storefront Dockerfile 和 Compose 已存在，`docker compose -f infra/local/compose.yaml up --build -d` 用于本地构建和联调，不是 GHCR 发布流程。当前 Compose Storefront 启动开发模式；上面的 production build 验证是单独运行的。
- **CI/GHCR**：已建立。`quality.yml` 在 PR、`main` push 和 `workflow_call` 时运行 `npm ci`、Compose 校验、lint、typecheck、`npm test` 与完整构建（仅公开占位构建变量）；`publish.yml` 以 `quality` 为门禁，在 `main` push 和手动触发时推送 `ghcr.io/wxylkxyzz/medusa-backend`、`ghcr.io/wxylkxyzz/medusa-storefront` 的 `sha-<sha>` 与 `main` 标签。GitHub Packages API 已确认 `sha-f601b34…` 标签在两个包上都存在（backend digest `sha256:b12fea4e…`、storefront digest `sha256:87bea480…`），但本机对 `ghcr.io` 的实拉仍返回 `NAME_UNKNOWN`/`MANIFEST_UNKNOWN`（具备 `read:packages` 的有效凭据同样失败，公共 GHCR 仓库拉取正常），疑似本机可达的是未同步新包的镜像/代理端点；因此最新镜像的实拉启动验证（migration/bootstrap、健康检查、Admin、storefront 路由、非 root、降级行为）全部未执行、未声称通过，需在具备直连 GHCR 的环境重试。较早的 `sha-1d7cf47…` 已实拉启动验证。`main` 无分支保护；`npm audit` 告警仍为 24 项（1 high、23 moderate）未处理。
- **staging/production**：仍需 staging 彩排、受控迁移、管理员 bootstrap、健康检查和回滚/备份验证。生产不能照搬本地 Compose 或本地默认密钥。

源码管理、CI 建设与业务完善可以并行；正式发布准备度单独判断，不能把“可推送源码”写成“已具备上线条件”。

## 当前待办

1. 商品媒体与购物车宿主机手动验收均已按用户报告通过，不是代理浏览器逐项证明；商品媒体轮及购物车轮清理重试已完成。两个空测试 cart 已精确软删除（非物理清除），Windows 转发规则由用户手动移除且经只读检查确认不存在；预览、转发进程与服务已停止，原容器、网络、数据库卷及原有业务数据保留，无待重试的上述清理项。最终 UI 设计单独推进。
2. 商品媒体的受控 workflow 上传、公开读取、测试商品关联与 SSR 已验证；继续补齐 Admin HTTP multipart 认证上传接口验证及媒体集成回归测试，不能据此宣称 Admin 上传已就绪。浏览器逐项与 DevTools 证据未独立留存。
3. 访客购物车及离线/真实 Storefront HTTP 集成已实现并验证，宿主机手动验收已按用户报告通过；结账、订单店面闭环及其集成测试仍未实现，购物车数量徽标也不在当前范围。继续补充通知失败/重试和更多业务场景，通知模板测试不代表下单已打通。
4. **Stripe 测试支付暂不接入**，后续单独评估；不新增搜索。
5. CI/GHCR 已建立；待办转为在具备直连 GHCR 的环境对最新镜像（`sha-f601b34…`，标签已由 GitHub Packages API 确认）补做实拉启动验证（此前本机拉取被 registry 端点阻断），并补齐 Caddy、staging、备份恢复、生产发布流程与依赖审计处置（当前 24 项告警）。

## 质量命令

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

以上公开值只用于构建检查；运行时必须注入真实本地 bootstrap 产生的 publishable key 和匹配的区域/渠道配置，不能把 `pk_build_placeholder` 当作可用凭据。设置方式见[本地开发与验证](docs/local-development.md)。
