# Douyin Messenger（抖音多账号直播场控系统）

> 基于 Electron + TypeScript 的抖音多账号直播间自动化管理工具。

## ✨ 功能特性

- **多账号管理**：同时管理多个抖音账号，一键切换
- **自动发言**：支持话术轮转、随机发送、定时发送
- **直播状态监测**：实时监测直播间在线状态，下播自动停止
- **账号健康度**：实时健康度评估仪表盘
- **房间管理**：直播间收藏、快速切换
- **福袋检测**：自动检测并参与直播间福袋
- **防风控策略**：随机间隔、人性化发送节奏

## 🏗️ 技术架构

```
src/
├── main/              # Electron 主进程
│   ├── ipc/           # IPC 通道定义与路由
│   ├── lifecycle/     # 应用生命周期管理
│   ├── plugins/       # 插件系统
│   ├── security/      # 协议安全拦截
│   ├── services/      # 后台服务（自动化引擎、直播监测等）
│   └── window/        # 窗口管理
├── preload/           # Preload 脚本（WebView 沙箱桥接）
│   ├── core/          # 观测器基类、消息桥
│   ├── observers/     # 状态观测器（登录、直播状态等）
│   ├── operations/    # DOM 操作（发言、点赞等）
│   └── optimizers/    # 性能优化
├── renderer/          # 渲染进程（UI）
│   ├── controllers/   # 控制器层
│   ├── renderers/     # UI 模块
│   └── views/         # HTML 页面
├── application/       # 应用层（调度器、用例）
├── domain/            # 领域层（账号模型）
├── infrastructure/    # 基础设施（WebView 控制器）
└── shared/            # 共享类型、常量、选择器
```

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/douyin-messenger.git
cd douyin-messenger

# 安装依赖
npm install

# 开发模式编译
npm run build

# 启动应用
npm start
```

### 开发模式

```bash
# 监听文件变化，自动编译
npm run dev

# 另一个终端启动 Electron
npm start
```

## ⚠️ 注意事项

### 签名服务

本开源版**不包含**抖音签名相关文件（`dy_ab.js` / `dy_live_sign.js`），
因此某些需要 API 签名的功能可能无法正常工作。

如需集成签名服务，请在 `src/main/plugins/douyin-sec/sign-service.ts` 中自行实现。

### 免责声明

本项目仅供学习交流使用，请勿用于任何违反抖音平台服务条款的行为。
使用本工具产生的任何后果由使用者自行承担。

## 📝 开发规范

- 强类型优先：禁止 `any` 滥用，所有接口和返回值必须明确定义
- 单一职责：每个模块/函数只做一件事
- 中文注释：核心逻辑使用中文注释便于维护

## 📄 License

[MIT](./LICENSE)
