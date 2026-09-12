# DuanOS v0.1.1

基于 Expo SDK 55、React Native 0.83 与 TypeScript 的个人 iPhone 工作系统。

## 当前能力

| 页面 | 内容 |
| --- | --- |
| 首页 | 今日收支、待完成事项、复盘状态、四类快捷入口 |
| 工作台 | 本地记录、分类筛选、待办完成/恢复、删除确认、提醒重试 |
| AI | 本地规则意图识别、输入示例、真实连接状态 |
| 数据 | 累计收支、记录分布、存储与隐私说明 |

底部四页导航，中间 `+` 是统一输入入口。输入 → 本地识别 → 核对/补充字段 → 确认保存。

- 记账：识别收支、阿拉伯数字金额、常见账户；金额以整数分保存，支持两位小数。
- 待办：保存和完成/恢复，不自动申请通知权限。
- 定时提醒：北京时间单次本机通知；拒绝权限、平台不支持或失败时明确显示未安排，可重试。
- 每日复盘：保存原文与日期，不向 Notion 写入。
- AsyncStorage 持久化；初次启动无虚构记录。加载失败阻止写入，避免覆盖原数据。

## 运行

需要 Node.js 22.13+（推荐 Node 24 LTS）和 npm。

```bash
npm ci
npm start
```

在 iPhone 使用兼容 SDK 55 的 Expo Go 扫描二维码。手机和电脑需可互相访问。若 App Store 当前 Expo Go 已不兼容 SDK 55，使用对应的开发构建；不要随意单独升级 React Native。

```bash
npm run web       # 浏览器预览；不支持本机定时通知
npm run typecheck
npm test          # 核心规则测试
npm run test:ui   # React Native 组件交互测试
npm run check     # 类型、测试、Expo 依赖兼容检查
npm run export    # iOS / Android / Web JavaScript 与资源打包
```

`export` 不是 IPA 安装包，也不是 App Store 上架。iOS 安装包需 macOS/Xcode 或 EAS 构建及相应签名账户。通知最终需在真机检查前台、锁屏和拒绝权限场景。

## 输入例子

```text
微信支付午饭25元
工资卡收入100元
待办：明天拿快递，不需要提醒
明天晚上8点提醒我背英语单词
每日复盘：今天完成了哪些事？下次如何改善？
```

一次一条意图。无法识别时手动选类型；识别后可修改内容、金额、账户、日期和提醒时间。日期为 `YYYY-MM-DD`，提醒时间为 `YYYY-MM-DD HH:mm`，始终按 Asia/Shanghai 解释。数字钟点与今天/明天/后天可自动识别；复杂日期和中文数字钟点请在核对表单填写。

## 安全配置

无需任何 API Key 即可运行本版。`.env` 与 `.env.*` 已加入 `.gitignore`，仅提交空值 `.env.example`。

如将来需要配置，复制 `.env.example` 为 `.env`。`EXPO_PUBLIC_API_BASE_URL` 只是未来后端地址的预留，本版不读取或调用。**所有 `EXPO_PUBLIC_*` 都会进入客户端包，不得放秘密**。OpenAI/DeepSeek 等提供商密钥只放未来服务端的 `.env`，不要放客户端、`app.json`、代码、截图或 GitHub。

依据：[Expo 环境变量文档](https://docs.expo.dev/guides/environment-variables/)、[Expo 通知文档](https://docs.expo.dev/versions/v55.0.0/sdk/notifications/)。

## 本版边界

- 本地规则识别，不是大模型聊天或多智能体；Google Sheets、Todoist、Google Calendar、Gmail、Notion 未连接。
- 不包含转账、还款、退款关联、循环提醒、批量意图、跨设备同步、导入导出或历史编辑。相关资金操作会阻止保存，避免错误影响收支。
- 待办里的“明天”等保留在正文，本版不解析待办到期日期或优先级。
- 记录仅在当前设备。卸载、清除浏览器数据可能丢失；存储未额外加密。收支汇总不是银行余额。
- 本机通知受系统权限、专注模式等影响；不保证精确投递。最多一次逻辑记录对应一个通知标识，重试使用相同标识。
- 视觉预览在本次环境受阻；详见 [Review](docs/REVIEW-v0.1.1.md)。

## 代码结构

`App.tsx`：四页界面、统一输入表单与本地操作。`src/domain.ts`：类型、识别、校验、日期与金额统计。`src/notifications.ts`：通知权限、安排与取消。`tests/`：规则和组件交互测试。
