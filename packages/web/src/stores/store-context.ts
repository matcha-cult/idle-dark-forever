/**
 * StoreContext —— 域 Store 的统一注入面（构造注入 + `makeAutoObservable`，零装饰器）。
 *
 * 设计意图：
 * - 域 Store 之间**不直接互相 import 类**，只依赖本接口，避免 Store 层的循环依赖；
 * - `root()` 是**延迟取根**函数：域 Store 需要在动作成功后触发别的域刷新
 *   （如装备成功后刷新背包），但根 Store 持有所有域 Store，构造期无法拿到实例，
 *   因此用闭包在调用时才求值。
 *
 * 错误处理口径：本接口只提供依赖，不提供错误策略；各 Store 自行 try/catch +
 * `toast.fromError/fromFailure`，不让异常穿透到 UI 事件处理器。
 */
import type { GameApi, GameClient } from '../services/game-client.js';
import type { RootStore } from '../app/root-store.js';
import type { SessionStore } from './session-store.js';
import type { ToastStore } from './toast-store.js';

export interface StoreContext {
  /** WS typed API（按 protocol cmd 段组织的域入口）。 */
  api: GameApi;
  /** 应用侧 transport 装配点（连接状态、指标、推送总线）。 */
  client: GameClient;
  /** 提示队列（错误 → 文案转译的唯一出口）。 */
  toast: ToastStore;
  /** 会话（token / 账号 / 角色列表 / 当前角色 key）。 */
  session: SessionStore;
  /** 延迟取根 Store（避免构造期循环引用）。 */
  root: () => RootStore;
}
