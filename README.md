# idle-dark-forever

《永夜2016典藏重置版》的服务端权威重制版 —— **ionet-ts + NestJS + React + Antd**。

> 原版是纯前端单机网页游戏（React 17 + MobX + localStorage）。本工程把游戏状态的所有权从浏览器搬到服务器：
> 战斗、掉落、成长、生产、剧情全部由服务端权威计算，前端只负责表现。
>
> 设计方案与系统拆解见 [`ai-docs/`](./ai-docs/)。

## 目录结构

```
idle-dark-forever/
├── packages/
│   ├── protocol/          # 共享线协议：cmd 段 + DTO + 结果约定（前后端唯一真相）
│   ├── game-core/         # 纯 TS 游戏内核：虚拟时钟 / 数据表 / 规则 / 存档编解码（无 MobX、无 IO）
│   ├── server/            # NestJS + ionet-ts 权威服务端
│   ├── ionet-transport/   # 前端传输层：WS 封装 + typed API（消费 @nbb-ionet/client-protocol）
│   ├── ui-kit/            # 纯 antd 组件层（零业务、零 store、零传输依赖）
│   └── web/               # React + Vite + Antd + MobX 业务前端
├── vendor/ionet-ts/       # ionet-ts 框架源码（CI 挂载 / 本地符号链接，不提交）
└── ai-docs/               # 设计与交接文档
```

### 依赖方向（硬约束，禁止反向）

```
web → ionet-transport → protocol
web → ui-kit
server → game-core → protocol
game-core  不得 import IO / MobX / React / 业务相关的 Node 内置模块
ui-kit     不得 import 任何业务 / store / 传输层
web        不得 import 除 @nbb-ionet/client-protocol 之外的任何 @nbb-ionet/* 包
```

## 框架依赖（ionet-ts）

本工程**不提交** ionet-ts 源码。CI 会把框架仓库挂载到 `vendor/ionet-ts/`，
`pnpm-workspace.yaml` 通过 `vendor/ionet-ts/packages/*` 把框架包纳入 workspace。

本地开发时用符号链接：

```bash
ln -sfn /path/to/ionet-ts vendor/ionet-ts
```

## 快速开始

```bash
# 依赖安装（沙箱内全局 store 可能只读，本仓库用 .npmrc 指定 workspace 内 store）
pnpm install --no-frozen-lockfile

# 构建（顺序：protocol → game-core → server / transport / ui-kit → web）
pnpm run build

# 类型校验
pnpm run typecheck

# 开发
pnpm run dev:server   # 服务端
pnpm run dev:web      # 前端
```

## 端口与端点

| 项 | 值 |
|---|---|
| HTTP REST（NestJS） | `:3000/api` |
| WebSocket（ionet External Server） | `:3000/ws`（单端口三合一，attach 到 NestJS http.Server） |
| ionet HTTP fallback | 默认关闭（由 NestJS 承担 REST） |

## 协议

- 线协议信封（请求/响应/推送、reqId、错误码、心跳、握手鉴权）：以 ionet-ts 的 `PROTOCOL.md` 为唯一规格。
- 业务路由与载荷：`packages/protocol`。
- **两级错误判定**（必须遵守）：`errorCode !== 0` → 传输错误；`errorCode === 0 && data.success === false` → 业务错误（码在 `data.data.code`）。

## 工程约定

- 提交信息**不得**包含 `Co-Authored-By` 签名。
- 改动业务代码必须同步补单测，覆盖边界（undefined / null / NaN / 负数 / 0 / 空数组 / 超大值 / 错误路径）。
- 代码改动后必须执行并通过 `pnpm run build` 与 `pnpm run typecheck`。
- 工作量的度量使用「规模 / 测试门禁 / 依赖顺序 / 风险」，不使用时间单位。
- 前端业务页面一律包 `ErrorBoundary`；反馈 API 一律用 antd `App.useApp()`，禁止静态 `message.*` / `Modal.confirm`。
