# DuanOS v0.2.0 安全 Review

## 架构

`DuanOS Web → 同域 Cloudflare Pages Functions → HMAC 签名 → 私有 Apps Script Web App → Google Sheets / Gmail`

所有记账仍先写入 AsyncStorage。Owner Session 登录后，Cloudflare 才接受 `/api/ledger`；Apps Script 以脚本所有者身份操作固定账本和回执邮箱。

## Review 结论

- Google OAuth：Client ID、Client Secret、redirect URI、state/PKCE、scope、refresh/access token 与 Drive/Sheets/Gmail REST OAuth 代码均已删除。
- 长期秘密：前端与仓库均不含长期秘密。Cloudflare 只读取 `APPS_SCRIPT_WEB_APP_URL`、`APPS_SCRIPT_SHARED_SECRET`、`DUANOS_OWNER_PASSWORD_HASH`；Apps Script 只从 Script Properties 读取 `SPREADSHEET_ID`、`RECEIPT_EMAIL`、`DUANOS_BRIDGE_SECRET`。
- Owner 密码：Cloudflare 只保存 `pbkdf2-sha256$iterations$salt$hash`，当前仅支持 Cloudflare Production 兼容的 100,000 次 PBKDF2-SHA256、独立至少 16-byte salt、32-byte 派生值，并使用 constant-time 比较。不保存或记录明文。
- Session：登录成功后旋转既有 Session，使用 32-byte 随机 ID；KV 只存创建/过期时间；Cookie 为 `__Host-`、Secure、HttpOnly、SameSite=Lax、Path=/，有效期 30 天。退出同时删除服务端 Session。
- 暴力破解：按 Cloudflare IP 与 User-Agent 的 SHA-256 摘要计数，15 分钟内五次失败即临时锁定；响应不提示密码接近程度，也不保存原始 IP。
- CSRF/CORS：登录、退出和记账 POST 均要求 `Origin` 与请求 URL 同源；未设置跨域允许头。
- HMAC：签名覆盖 timestamp、稳定 requestId、action 和固定字段顺序的完整 payload；Apps Script constant-time 验签并拒绝超过五分钟的请求、未知 action 和无效 payload。错误响应不包含 Secret 或请求正文。
- 幂等：Cloudflare KV 与 Apps Script Script Properties 双层记录 `sheet_written` / `complete`。写表确认后才发邮件；邮件失败只重试 `ledger.receipt`。Apps Script 使用脚本锁保护同一阶段，Cloudflare 超时后再次调用 append 也不会新增第二行。
- 本地保护：同步发生在本地持久化之后；错误只修改同步状态，不删除或覆盖本地业务字段。
- 日志：Cloudflare 不记录口令、Hash、Cookie、共享 Secret 或 payload。Apps Script 只记录固定内部错误消息，不记录签名、正文或 Script Properties。

## 已知限制

- Cloudflare KV 最终一致，登录限速在极端跨区域并发下不是严格全局计数；本系统仅限单一所有者。若威胁模型扩大，应迁移限速和入口幂等锁到 Durable Object。
- PBKDF2-SHA256 100,000 次低于理想密码哈希工作因子；v0.2.0 依赖单 Owner、高熵密码、五次失败锁定、HTTPS、安全 Cookie 与 Cloudflare Secret 共同降低风险。后续版本应评估 scrypt 或 Cloudflare Access。
- Apps Script Script Properties 有配额，不适合无限增长。未来需要保留清理策略，但在不能证明远端重试窗口结束前不得删除幂等状态。
- Apps Script Web App、Script Properties 与 Cloudflare Production 已正式配置，Apps Script bridge 已进入真实联调；当前仅阻塞于 Owner Auth 的 Cloudflare PBKDF2 兼容性，本 PR 修复该问题。Web App 为了接受 Cloudflare 服务端请求需要允许匿名 HTTP 访问，因此 URL 不是认证边界；安全性依赖高熵共享 Secret、HMAC 验签、时间窗和幂等校验。
- 本地记录未额外加密；清除 Safari 网站数据仍会删除本地记录。
