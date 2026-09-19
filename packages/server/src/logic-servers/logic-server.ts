/**
 * 逻辑服 seam（08 §1 C1 / §2 阶段2；A2 已拍板「单进程边界先行」）
 *
 * 本文件定义**本仓自有的**逻辑服接口与元数据形状，语义对齐 ionet Java 原版
 * `net-server/.../LogicServer.java`（`settingBarSkeletonBuilder` / `settingServerBuilder`
 * / 可选 `startupSuccess`）。
 *
 * ⚠️ 框架（`vendor/ionet-ts`）目前**没有**逻辑服运行时（见
 * `ionet-ts/ai-docs/logic-server-runtime-requirements.md` 的 RS1）。因此这里先落**接口 seam**：
 * 本仓按此形状声明每个服的边界与路由，等框架补齐后把实现替换为框架实现、消费方代码不变。
 *
 * 硬约定（08 §1）：
 * - `*LogicServer` 类里**只许有 builder 配置，禁止业务**（禁止 `@ActionMethod`）；
 * - 业务只属于 `Action`（`@ActionController` / `@ActionMethod`）；
 * - 跨服只允许走通信契约（call/send/事件），禁止直接 import 另一个服的 service/internal。
 */

/** `settingBarSkeletonBuilder` 的产物（对齐框架骨架配置的形状）。 */
export interface BarSkeletonSetting {
  /** 逻辑服名（唯一）。 */
  readonly name: string;
  /** 本服拥有的 protocol cmd 段（`CMD_SEGMENTS` 的值）。 */
  readonly cmdSegments: readonly number[];
  /** 参与合并推送的 cmd 段（当前与 `cmdSegments` 一致）。 */
  readonly cmdMerges: readonly number[];
}

/** `settingServerBuilder` 的产物（将来用于注册/发现，见 RS2）。 */
export interface ServerSetting {
  /** 逻辑服 id（单进程阶段 = name）。 */
  readonly id: string;
  readonly name: string;
  readonly cmdMerges: readonly number[];
}

/** 逻辑服生命周期接口（框架补齐后由框架实现替换）。 */
export interface LogicServer {
  readonly name: string;
  settingBarSkeletonBuilder(): BarSkeletonSetting;
  settingServerBuilder(): ServerSetting;
  /** 启动完成回调（可选）。 */
  startupSuccess?(): void | Promise<void>;
}

/**
 * 逻辑服边界定义（**声明式**，供架构门禁 `test/logic-server-boundary.test.ts` 与路由聚合消费）。
 *
 * - `roots`：该服拥有的源码根（相对 `packages/server/src`，目录或文件路径前缀）；
 * - `cmdSegments`：该服独占的 protocol cmd 段 —— 全仓每段**恰好归属一个服**。
 */
export interface LogicServerDefinition {
  readonly name: string;
  readonly roots: readonly string[];
  readonly cmdSegments: readonly number[];
}

/** 由声明式定义生成 `LogicServer`（避免每个服重复写 builder 样板）。 */
export abstract class BaseLogicServer implements LogicServer {
  protected constructor(protected readonly definition: LogicServerDefinition) {}

  get name(): string {
    return this.definition.name;
  }

  settingBarSkeletonBuilder(): BarSkeletonSetting {
    return {
      name: this.definition.name,
      cmdSegments: this.definition.cmdSegments,
      cmdMerges: this.definition.cmdSegments,
    };
  }

  settingServerBuilder(): ServerSetting {
    return {
      id: this.definition.name,
      name: this.definition.name,
      cmdMerges: this.definition.cmdSegments,
    };
  }
}
