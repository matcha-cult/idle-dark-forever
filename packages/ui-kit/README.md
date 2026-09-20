# @idle-dark/ui-kit

《永夜》重制版的**纯 antd 组件层**。存在的唯一理由是：把游戏通用展示形态（品质、物品、
资源条、战斗单位、外壳布局、反馈）沉淀成**零业务、零 store、零传输依赖**的组件，
让业务容器只负责注入服务端 DTO 与意图回调。

## 依赖契约（由 `src/hygiene.test.ts` 强制）

| 允许 | 说明 |
|---|---|
| `antd` / `antd/*` / `react` / `react-dom` | peer 依赖，仅此三者 |
| 相对路径 import（必须带 `.js` 后缀） | `verbatimModuleSyntax` + ESM 输出 |
| `import type ... from '@idle-dark/protocol'` | **仅类型**，运行时零依赖 |

禁止：`mobx`、`node:*`、任何其他裸包（含 `@ant-design/icons`——它不是 peer 依赖；
图标由调用方以 `ReactNode` 注入，如 `SideNavItem.icon`）、动态 `import()` / `require()`。

## 其他硬约束（同样由门禁测试强制）

- 颜色只能来自 `theme.useToken()`：源码**零内联 hex**、零 `!important`、零组件内 `<style>`；
- 反馈 API 只能走 `App.useApp()`：禁止静态 `message.*` / `notification.*` / `Modal.confirm`；
- 组件统一具名导出（禁 `export default`），一个 `.tsx` 只导出一个组件，单文件 ≤200 行；
- 一律不传 `size`：紧凑由 `buildThemeConfig()` 的 `compactAlgorithm` 全局承担。

## ⚠️ 环境前置：`@idle-dark/protocol` 必须可解析

`src/` 里有若干 `import type { InventorySlotDto, Quality, UnitDto } from '@idle-dark/protocol'`
（type-only，运行时被完全擦除）。**但 TypeScript 仍需解析该模块**，而当前
`packages/ui-kit/package.json` 没有声明 `@idle-dark/protocol` 依赖，pnpm 也就不会建软链。

当前工作区用一条手工软链让它可解析：

```bash
mkdir -p packages/ui-kit/node_modules/@idle-dark
ln -sfn ../../../../packages/protocol packages/ui-kit/node_modules/@idle-dark/protocol
```

**`pnpm install` 会清掉这条软链**，之后 `tsc` 会报 `Cannot find module '@idle-dark/protocol'`。
根治办法（需要改 `package.json`，不在本 package 的写入范围内）：
在 `packages/ui-kit` 加 `devDependencies: { "@idle-dark/protocol": "workspace:*" }`。
另：`pnpm run typecheck` 前需先构建 protocol（下游从 `dist` 解析）。

## 测试

```bash
pnpm --filter @idle-dark/ui-kit exec tsc -p tsconfig.json --noEmit
pnpm --filter @idle-dark/ui-kit exec vitest run
```

本包**不安装 jsdom / @testing-library**（不新增依赖），因此渲染测试统一走
`react-dom/server` 的 `renderToStaticMarkup`（`src/testing/index.ts` 的 `renderToHtml`）。
后果与边界：

- 可验证：结构、文案、data 属性、disabled、SVG/内联 style 等**静态输出**；
- 不可验证（需要 DOM 环境，已登记为未完成项）：事件点击、`useEffect` 副作用
  （日志自动滚底）、`Grid.useBreakpoint` 的真实断点切换、错误边界的错误态 UI
  （SSR 不执行 `getDerivedStateFromError`）、Tooltip / Drawer 的挂载行为。

`@idle-dark/ui-kit/testing` 子路径导出（不进主 barrel）：

| 导出 | 用途 |
|---|---|
| `installViewportMock(host?, width?)` | 给 jsdom 装可控 `matchMedia`（antd 响应式依赖） |
| `setViewportWidth(px)` / `resetViewport()` / `getViewportWidth()` | 切换与复位视口以断言断点行为 |
| `installResizeObserverMock(host?)` | 补 jsdom 缺失的 `ResizeObserver` |
| `renderToHtml(el)` / `htmlToText(html)` | SSR 渲染与取纯文本 |
| `makeSlot(overrides)` / `makeUnit(overrides)` | `InventorySlotDto` / `UnitStateDto` 夹具 |

## 分组

| 目录 | 职责 |
|---|---|
| `theme/` | ConfigProvider + antd App 外壳、主题配置纯函数、零副作用持久化 store、明暗切换 |
| `layout/` | AppShell（桌面 Sider ↔ 移动 Drawer）、SideNav、HudBar、PageShell、SectionCard、Toolbar |
| `game/` | 品质 3 档、物品卡/网格、五类资源条、战斗单位卡、数量选择、费用清单、操作条 |
| `data/` | 属性列表、日志面板 |
| `feedback/` | 错误边界、连接徽标、空态 |
| `form/` | 受控表单行（按需增补） |
| `format/` | 纯格式化函数（数值 / 时长） |
