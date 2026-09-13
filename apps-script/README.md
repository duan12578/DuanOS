# DuanOS Apps Script 私有桥接

此目录只保存可审计源码，不含真实配置，也不会自动部署。

人工部署时，在脚本的 Script Properties 中配置：

- `SPREADSHEET_ID`：目标《个人记账｜口述版》的 ID
- `RECEIPT_EMAIL`：所有者本人接收回执的邮箱
- `DUANOS_BRIDGE_SECRET`：与 Cloudflare `APPS_SCRIPT_SHARED_SECRET` 相同的高熵随机值

将 Web App 设置为“以本人身份执行”。为了让 Cloudflare 服务端能够调用，访问权限需选择允许匿名 HTTP 请求的“任何人 / Anyone”（具体文案以当前 Apps Script 界面为准）。这表示 URL 在网络层可访问，但业务请求仍必须通过 HMAC-SHA256 验签；不要把 URL 本身当作认证凭据。部署 URL 只填入 Cloudflare Secret/Variable `APPS_SCRIPT_WEB_APP_URL`。Cloudflare 以 HMAC-SHA256 签名每个请求；签名覆盖时间戳、稳定记录 ID、action 和规范化 payload。脚本拒绝超过五分钟的请求，并用 Script Properties 记录 `sheet_written` / `complete`，避免超时重试重复写表或重复发信。

不得把上述真实值、Owner 密码或任何 Token 提交到 GitHub。正式联调前先确认工作表 `记账流水` 的九列依次为：日期、类型、分类、金额（元）、账户、内容/商户、备注、对方账户、录入时间。
