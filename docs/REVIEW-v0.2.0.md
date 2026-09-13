# DuanOS v0.2.0 安全与可靠性 Review

## 范围

本版只增加 Google Sheets 记账同步和 Gmail 回执。Todoist、Calendar、Notion 与大模型 API 不在本版范围。

## 数据流

1. 记账记录先以稳定 ID 写入 AsyncStorage。
2. 登录 Google 且后端健康时，前端把同一 ID 作为幂等键提交到同域 `/api/ledger`。
3. 后端从加密的服务端 Session 读取 Google 凭证，按完全匹配标题查找表格并确认 `记账流水` 工作表。
4. 后端按九列顺序追加一行，先记录 `sheet_written`，之后发送 Gmail 回执。
5. 邮件失败时重试只重发邮件，不再次追加表格行。

## Review 结论

- 秘密泄漏：仓库只包含空值示例；OAuth secret、允许邮箱和加密密钥必须配置为 Cloudflare Secrets/Variables。前端不读取长期凭证。
- OAuth CSRF：Authorization Code Flow 使用随机 state、十分钟有效期、加密 HttpOnly Cookie 和 PKCE。回调只重定向到当前同域根路径，不接受用户提供的跳转地址。
- Cookie：Session ID 使用 Secure、HttpOnly、SameSite=Lax；Google token 加密后只存 KV。
- CORS/CSRF：写入 API 要求 `Origin` 与请求 origin 完全一致，不返回跨域允许头。
- 所有者限制：OAuth userinfo 的已验证邮箱必须与 `ALLOWED_GOOGLE_EMAIL` 完全一致。
- 输入：后端重新校验 ID、日期、类型、正数金额、账户、内容与长度；退款、转账、还款不属于合法类型。
- 幂等与异常：KV 状态区分 processing、sheet_written 和 complete。表格确认后再发邮件；失败前不会标记完成。
- 本地保护：所有云操作发生在本地持久化之后；失败只更新同步状态，不删除或覆盖业务字段。
- 日志：响应只返回固定错误码，代码不记录 token、OAuth code、请求正文或用户邮箱。

## 已知限制

- Cloudflare KV 不是强一致数据库。单一所有者的顺序重试已覆盖；极端的跨区域、同一毫秒并发请求仍存在理论竞争窗口。若未来开放多用户或批量并发，应将幂等锁迁移到 Durable Object 或 D1 唯一约束。
- 本地记录仍未加密，清除 Safari 网站数据会删除本地记录。
- 首次正式上线必须人工完成 Google OAuth、Cloudflare KV 与 Secrets 配置，并进行真实账本验收。
