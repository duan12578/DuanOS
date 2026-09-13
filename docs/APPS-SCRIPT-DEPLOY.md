# Apps Script 私有桥接部署清单

本文件是后续人工部署说明。本轮不会创建 Web App、填写真实值或写入账本。

1. 在所有者 Google 账户中新建 Apps Script 项目，复制 `apps-script/Code.gs` 与 `appsscript.json`。
2. 在 Script Properties 填写 `SPREADSHEET_ID`、`RECEIPT_EMAIL`、`DUANOS_BRIDGE_SECRET`。真实值不得进入 GitHub、前端、聊天或截图。
3. 部署 Web App：Execute as 选择脚本所有者；访问权限选择允许匿名 HTTP 请求的“任何人 / Anyone”（具体文案以当前界面为准），否则 Cloudflare 服务端无法调用。端点虽然网络可达，但每个业务请求都必须通过共享 Secret 的 HMAC-SHA256 验签。保存原始 `https://script.google.com/macros/s/.../exec` URL，不要使用重定向后的 `script.googleusercontent.com` 地址。
4. 在 Cloudflare 正式环境配置 `APPS_SCRIPT_WEB_APP_URL`、`APPS_SCRIPT_SHARED_SECRET`、`DUANOS_OWNER_PASSWORD_HASH`。共享 Secret 必须与 Script Property 完全相同；Owner Hash 必须符合 `pbkdf2-sha256$iterations$salt-base64url$hash-base64url`。
5. 保留 KV binding `DUANOS_KV`。删除已废弃的全部 Google OAuth Variables/Secrets。
6. 先验证 `/api/health` 未登录返回 `{ "ok": true, "authenticated": false }`，登录后为 `true`。
7. 在获得所有者明确同意后，才创建一条真实流水验证写表、回执与重复重试。

Web App 不接受浏览器直连作为认证方式。Cloudflare 服务端会生成 HMAC-SHA256；Apps Script 同时验证签名、五分钟时间窗、action、requestId 和 payload。
