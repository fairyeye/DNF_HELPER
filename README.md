# DNF 活动助手

自动领取 DNF（地下城与勇士）限时活动积分的桌面工具，基于 Electron + Puppeteer 实现。

## 功能

- **一键领取**：自动完成每日/每周/一次性任务的积分领取，支持积分兑换目标奖励
- **多活动并行**：支持同时管理多个活动事件，一键全部运行
- **双框架支持**：兼容 ACT 框架（标准活动页）和 Milo 框架（WeGame/周年庆等活动）
- **打卡签到**：支持累计登录天数的打卡活动，自动领取里程碑奖励
- **自动登录检测**：运行脚本前自动检查登录状态，未登录时弹出浏览器窗口引导扫码
- **登录信息分离**：ACT 和 Milo 框架的登录信息独立存储，互不干扰
- **积分查询**：随时查看当前积分、预测积分、距离目标奖励的差距
- **活动管理**：添加/删除活动事件，自动标记过期活动

## 使用说明

### 安装

运行安装包 `DNF活动助手 Setup 1.0.0.exe`，选择安装目录后完成安装。

### 登录

1. 打开应用，点击右上角 **QQ 登录** 按钮
2. 弹出浏览器窗口，使用 QQ 扫码登录
3. 登录成功后窗口自动关闭，状态栏显示"已登录(ACT)"或"已登录(Milo)"
4. 不同框架的活动会分别弹出一次登录窗口

### 运行活动

- **单个运行**：点击活动卡片上的 **运行** 按钮
- **全部运行**：点击顶部 **一键运行全部** 按钮，依次执行所有活动
- **查询状态**：点击 **积分** 或 **天数** 按钮查看当前进度

### 管理活动

- **添加活动**：将活动配置 JSON 文件放入 `resources/events/` 目录（安装目录下）
- **删除活动**：点击活动卡片上的 **删除** 按钮
- **清空登录**：点击 **清空登录** 按钮清除所有登录信息（Cookie + 浏览器缓存）

### 日志

底部日志区域实时显示引擎运行日志，包括登录状态、任务执行结果、积分变化等信息。

## 添加新活动

当 DNF 推出新的限时活动时，可以通过 AI 辅助生成活动配置。将以下提示词连同活动页面链接一起发送给 AI（如 QoderWork、ChatGPT 等），即可生成配置文件。

### 提示词（复制使用）

---

**请根据以下 DNF 活动页面链接，帮我生成活动自动领取的配置 JSON 文件。**

活动链接：`<粘贴活动页面 URL，如 https://dnf.qq.com/cp/a20260710xxxx/index.html>`

请按以下步骤操作：

1. 打开活动页面，等待至少 12 秒让 `window.ACT` 框架初始化完成

2. 在页面的 JavaScript 上下文中执行以下代码提取信息：

```javascript
(function() {
  return {
    actId: window.ACT?.var?.iActId,
    isLogin: window.ACT?.var?.isLogin,
    score: window.ACT?.var?.jScore,
    scripts: Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n'),
    html: document.body.innerHTML
  };
})()
```

3. 在提取的 JS 源码中搜索 `submitFlow` 调用，提取 6 位十六进制的 token，分类为：
   - 每日任务（标注"每日"/"daily"，约 10 分/个）
   - 每周任务（标注"每周"/"weekly"，约 20 分/个）
   - 兑换 token（用于积分兑换奖励）
   - 注意检查外部 JS 文件（`<script src="...">`）中的 token

4. 分析页面"积分兑换"区域，找到目标奖励的 ID 和所需积分

5. 生成配置文件，格式如下：

```json
{
  "id": "<活动标识，如 a20260710xxx>",
  "name": "<活动名称>",
  "url": "<活动页面完整 URL>",
  "startDate": "<活动开始日期，YYYY-MM-DD>",
  "endDate": "<活动结束日期，YYYY-MM-DD>",
  "dailyTasks": [
    { "token": "<6位token>", "name": "<任务名称>", "points": 10 }
  ],
  "weeklyTasks": [
    { "token": "<6位token>", "name": "<任务名称>", "points": 20 }
  ],
  "refreshToken": "9796c4",
  "exchangeToken": "<兑换token>",
  "targetReward": {
    "id": 12,
    "name": "<目标奖励名称>",
    "cost": 600
  }
}
```

**关键说明：**
- `refreshToken` 固定为 `9796c4`，所有 DNF 活动通用
- token 是 6 位十六进制字符串，出现在 `ACT.fun.submitFlow('xxxxxx', ...)` 调用中
- 一定要设置 `endDate`，程序会自动标记过期活动
- 如果是 Milo 框架的活动（WeGame 类），需要额外提取 `actId`、`bindToken`、`queryBindToken`、`initToken` 等字段，并在配置中添加 `"framework": "milo"`
- 如果是打卡签到类活动，设置 `"type": "checkin"`，并提取 `checkInToken` 和 `checkInGiftToken`

---

### 配置文件字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 活动唯一标识（用于文件名和内部引用） |
| `name` | string | 活动名称（显示在界面上） |
| `url` | string | 活动页面完整 URL |
| `startDate` | string | 活动开始日期 YYYY-MM-DD |
| `endDate` | string | 活动结束日期 YYYY-MM-DD |
| `dailyTasks` | array | 每日任务列表，每项含 `token`、`name`、`points` |
| `weeklyTasks` | array | 每周任务列表 |
| `oneTimeTasks` | array | 一次性任务列表（可选） |
| `refreshToken` | string | 数据刷新 token，固定 `9796c4` |
| `exchangeToken` | string | 积分兑换 token |
| `targetReward` | object | 目标奖励：`id`（奖励序号）、`name`（名称）、`cost`（所需积分） |
| `framework` | string | 框架类型：`"milo"` 表示 Milo 框架，不填默认 ACT |
| `type` | string | 活动类型：`"checkin"` 表示打卡签到类 |

### Milo 框架额外字段

| 字段 | 说明 |
|------|------|
| `actId` | Milo 活动 ID |
| `bindToken` | 大区绑定 token |
| `queryBindToken` | 查询绑定 token |
| `initToken` | 初始化 token |
| `dailyLotteryToken` | 每日抽奖 token（可选） |

### Checkin 类型额外字段

| 字段 | 说明 |
|------|------|
| `checkInToken` | 打卡 token |
| `checkInGiftToken` | 打卡礼包 token |
| `milestones` | 里程碑数组：`[{ "index": 0, "days": 3, "name": "奖励名称" }]` |

## 项目结构

```
dnf_gui/
├── main.js          # Electron 主进程（IPC 通信、引擎加载）
├── index.html       # 渲染进程（界面、交互逻辑）
├── package.json     # 依赖配置 + electron-builder 打包配置
├── build.bat        # 构建脚本（复制引擎 + 打包 EXE）
├── AGENTS.md        # GUI 开发规范
└── README.md

dnf_bot_stronger/
├── bot_core.mjs     # 核心引擎（Puppeteer 自动化、登录检测、任务领取）
├── events/          # 活动配置 JSON 文件
│   ├── a20260611stronger.json   # ACT 框架示例
│   ├── a20260611wegame.json     # Milo 框架示例
│   └── celebration.json         # 打卡签到示例
└── AGENTS.md        # 引擎开发规范
```

## 开发

### 环境要求

- Node.js 18+
- Windows 系统（构建 EXE 需要）

### 运行

```bash
cd dnf_gui
# 复制引擎文件
cp ../dnf_bot_stronger/bot_core.mjs .
# 启动开发模式
npx electron .
```

### 打包 EXE

```bash
# 设置中国镜像
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
# 复制引擎并打包
cp ../dnf_bot_stronger/bot_core.mjs .
npx electron-builder --win --config
```

产出文件在 `dist/DNF活动助手 Setup 1.0.0.exe`。

### 技术栈

- **Electron 35** — 桌面应用框架
- **Puppeteer-core** — 无头浏览器自动化
- **electron-builder** — Windows NSIS 安装包打包
- **Chrome Profile 持久化** — 浏览器会话跨重启保持

## 注意事项

- QQ 登录 Cookie 有效期约 7 天，过期后需要重新扫码
- 部分活动需要先在游戏内完成对应操作（如通关副本）才能领取积分
- 积分兑换操作不可撤销，请确认目标奖励后再运行
- 无头浏览器可能被活动页面的反作弊系统检测，工具内置了随机延迟和人类行为模拟来降低风险
