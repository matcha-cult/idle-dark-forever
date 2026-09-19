/**
 * `@idle-dark/ui-kit` —— 纯 antd 组件层（**运行时只依赖 antd + react**）。
 *
 * 存在意义：把「暗黑奇幻放置/RPG」的通用展示形态（品质、物品、资源条、战斗单位、
 * 外壳布局、反馈）沉淀成零业务、零 store、零传输依赖的组件；业务状态一律由容器注入。
 *
 * 三条红线（`src/hygiene.test.ts` 用可执行门禁强制，违反即测试失败）：
 * 1. 只允许 `antd` / `react` / `react-dom` 与相对路径 import；
 *    `@idle-dark/protocol` **只允许 `import type`**（运行时零依赖，协议仍是类型唯一真相）。
 * 2. 颜色只能来自 `theme.useToken()`；源码零内联 hex、零 `!important`、零 `<style>`。
 * 3. 反馈 API 只能走 `App.useApp()`；禁止静态 `message.*` / `Modal.confirm`。
 *
 * 分组：
 * - `theme/`    主题与中文化外壳（ConfigProvider + antd App + 持久化 store）
 * - `layout/`   应用外壳、侧边导航、HUD、页面/卡片/工具条
 * - `game/`     游戏语义组件（品质、物品、资源、单位、数量、费用、操作）
 * - `data/`     纯展示数据块（属性列表、日志面板）
 * - `feedback/` 错误边界、连接徽标、空态
 * - `form/`     受控表单行（按需）
 * - `format/`   纯格式化函数
 *
 * 测试基础设施在子路径 `@idle-dark/ui-kit/testing`（不进本 barrel）。
 */

export * from './data/index.js';
export * from './feedback/index.js';
export * from './form/index.js';
export * from './format/duration.js';
export * from './format/number.js';
export * from './game/index.js';
export * from './layout/index.js';
export * from './theme/index.js';
