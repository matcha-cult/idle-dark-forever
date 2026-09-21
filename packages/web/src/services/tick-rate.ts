/**
 * `(world, tick)` 推送频率自检 —— **只在开发期安装**（`import.meta.env.DEV`）。
 *
 * ## 背景（P2 起语义已变，务必按新语义解读）
 *
 * P2 之前是「每 200ms 无条件推整份 `units` 快照」，所以 5 帧/秒是常态。
 * **P2 之后改为「有变化才推」**：服务端每 200ms 只做一次**评估**，
 * 完全无变化的窗口**不发任何消息**（`world_push_quiet_skips_total` 会 +1）。
 *
 * 因此现在的正确解读是：
 * - **帧率 ≤ 5/s 且可以是 0**：长时间没有帧 = 世界真的没有变化（站桩、波次间隙），
 *   **不是**卡死、更不是断线（断线由 `system.ping` 与 WS 层判定）；
 * - 帧率**仍然不能超过** 5/s（超出说明 `tickIntervalMs` 或 batcher 出了问题）；
 * - **相同 `serverTime` 出现多次**仍然只可能是重复投递（多标签页 / 5273+5274 /
 *   残留 socket）—— 框架 `sendNotification` 会发给该 userId 的**全部** OPEN 连接。
 *
 * 想知道「有没有在推」要看是否有帧到来；想知道「服务端是否在跑」看
 * `system.ping` 的响应与 `/api/metrics` 的 `world_push_*`。
 *
 * 用法（浏览器 Console）：
 * ```js
 * await __idleDarkTickRate()      // 默认采样 10s
 * await __idleDarkTickRate(3000)  // 采样 3s
 * __IDLE_DARK__                   // 根 store（临时排查用）
 * ```
 */
import { WORLD_CMD } from '@idle-dark/protocol';

/** 一条 tick 到达样本：本地到达时刻 + 服务端帧里的 `serverTime`。 */
export interface TickSample {
  at: number;
  serverTime: number;
}

export interface TickRateReport {
  /** 采样窗口内收到的 (world, tick) 帧数。 */
  frames: number;
  /** 实际频率（帧/秒，保留两位）。 */
  perSecond: number;
  /** 帧间隔分布（ms；不足两帧时全为 0）。 */
  gapMs: { min: number; p50: number; p90: number; max: number };
  /** 去重后的 `serverTime` 个数。 */
  uniqueServerTimes: number;
  /**
   * 重复投递的帧数 = `frames - uniqueServerTimes`。
   * `> 0` 说明同一 tick 被送到同一个连接多次（或多连接）。
   */
  duplicatedFrames: number;
  /** 人话结论（前端零推导，这里只是把测得的数字翻译成一句话）。 */
  verdict: string;
}

/** 设计频率上限：200ms → 5Hz；留 20% 容差。 */
const EXPECTED_PER_SECOND = 5;
const TOLERATED_PER_SECOND = EXPECTED_PER_SECOND * 1.2;

/**
 * 汇总采样（纯函数，便于单测）。
 *
 * 对**乱序 / 重复时刻 / 空数组**都安全：内部排序后再算间隔。
 */
export function summarizeTickRate(samples: readonly TickSample[], windowMs: number): TickRateReport {
  const list = [...samples].sort((a, b) => a.at - b.at);
  const frames = list.length;
  const seconds = Number.isFinite(windowMs) && windowMs > 0 ? windowMs / 1000 : 1;
  const perSecond = Math.round((frames / seconds) * 100) / 100;

  const gaps: number[] = [];
  for (let i = 1; i < frames; i += 1) gaps.push((list[i]?.at ?? 0) - (list[i - 1]?.at ?? 0));
  gaps.sort((a, b) => a - b);
  const pick = (p: number): number =>
    gaps.length === 0 ? 0 : (gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0);
  const gapMs = {
    min: gaps[0] ?? 0,
    p50: pick(0.5),
    p90: pick(0.9),
    max: gaps[gaps.length - 1] ?? 0,
  };

  const uniqueServerTimes = new Set(list.map((sample) => sample.serverTime)).size;
  const duplicatedFrames = frames - uniqueServerTimes;

  let verdict: string;
  if (frames === 0) {
    verdict =
      '窗口内没有收到 (world, tick) 推送 —— P2 起这**可能完全正常**（世界无变化时不推送）；' +
      '若 HUD 也在动却没有帧，才需要查未进图 / 未选角 / 连接';
  } else if (duplicatedFrames > 0) {
    verdict = `重复投递 ${duplicatedFrames} 帧（同一 serverTime 多次到达）—— 检查是否开了多个标签页 / 5273+5274 两个 dev server / 残留 socket`;
  } else if (perSecond > TOLERATED_PER_SECOND) {
    verdict = `服务端推送快于设计（${perSecond}/s > ${EXPECTED_PER_SECOND}/s）—— 检查 WORLD_CONFIG.tickIntervalMs 与 batcher flushIntervalMs`;
  } else {
    verdict = `正常：单连接 ${perSecond}/s、间隔中位数 ${gapMs.p50}ms（P2 设计：评估 5Hz / 200ms，仅在有变化时推送，故帧率 ≤ 5 且可为 0）`;
  }

  return { frames, perSecond, gapMs, uniqueServerTimes, duplicatedFrames, verdict };
}

/** 探针挂在宿主对象（浏览器里就是 `window`）上的两个名字。 */
export interface DevProbeHost {
  __IDLE_DARK__?: unknown;
  __idleDarkTickRate?: (windowMs?: number) => Promise<TickRateReport>;
}
/** 探针只需要「能订阅推送」这一小块能力。 */
export interface TickSource {
  notifications: {
    onAny(handler: (frame: unknown) => void): () => void;
  };
}

/**
 * 安装开发探针：暴露根 store + `__idleDarkTickRate()`。
 *
 * `host` 只要求是个对象（浏览器里传 `window`；测试里传普通对象），
 * 内部按 `DevProbeHost` 读写那两个名字 —— 避免 `Window` 因「无可选属性交集」而类型不兼容。
 *
 * @returns 卸载函数（退订推送、删掉两个全局名）。
 */
export function installDevProbe(
  root: unknown,
  host: object,
  source: TickSource,
): () => void {
  const target = host as DevProbeHost;
  target.__IDLE_DARK__ = root;

  let running = false;
  target.__idleDarkTickRate = async (windowMs = 10_000): Promise<TickRateReport> => {
    if (running) throw new Error('上一个采样还没结束，稍等再试');
    running = true;
    const samples: TickSample[] = [];
    const unsubscribe = source.notifications.onAny((frame) => {
      const notification = frame as { kind?: string; cmd?: number; subCmd?: number; data?: unknown };
      if (notification.kind !== 'notification') return;
      if (notification.cmd !== WORLD_CMD.cmd || notification.subCmd !== WORLD_CMD.tick) return;
      const serverTime = (notification.data as { serverTime?: unknown } | undefined)?.serverTime;
      samples.push({
        at: Date.now(),
        serverTime: typeof serverTime === 'number' ? serverTime : -1,
      });
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, windowMs));
    } finally {
      unsubscribe();
      running = false;
    }
    const report = summarizeTickRate(samples, windowMs);
    console.log('[idle-dark] (world, tick) 频率自检', report);
    return report;
  };

  return () => {
    delete target.__IDLE_DARK__;
    delete target.__idleDarkTickRate;
  };
}
