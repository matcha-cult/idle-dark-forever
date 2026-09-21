/**
 * 世界侧车状态：**每角色每图**的 run 进度（形状 + 读入 + **唯一写入口**）。
 *
 * 存在 `account_state.data.worldMaps[characterId]`（JSONB 侧车）里 ——
 * 它**不进** `characters.state`（`Player` 存档只放角色自身状态），也不需要 Prisma 迁移：
 * 这个 JSONB 列的设计初衷就是「内核加字段不变成一次数据库迁移」。
 *
 * ## 为什么需要这个模块
 *
 * `wave` / 里程碑此前由**两处**各自拼写落库：
 * - `WorldService.persistPosition()`：写 `{map, wave}`；
 * - `IdleLogicService.settle()`：只写 `{map}` —— **把 `wave` 抹掉**。
 *
 * 后者在**每次登录**都会跑（`root-store` 的离线报告），于是「波数」根本不可能跨会话，
 * 玩家看到的波次永远是从 0 开始。这不是"少写一个字段"，而是**同一片状态有两个写者、
 * 且形状不一致**（违反 `AGENTS.md` §16 的 C6「每片状态只有一个写者」）。
 *
 * 现在：形状由 {@link WorldMapState} 定义，写入只走 {@link writeWorldMapState}，
 * 读入只走 {@link parseWorldMapState}。任何新增字段都必须同时改这两处，
 * **不要**再在业务代码里手拼对象字面量。
 */

/**
 * 单张地图的 run 状态。
 *
 * 所有「波数类」字段的约定一致：**`0` 等价于「无进度」⇒ 不落库**（保持旧存档形状）。
 */
export interface WorldMapState {
  /** 当前地图 key（未知 / 缺失 → `home`，由调用方 `resolveWorldPosition` 兜底）。 */
  map: string;
  /** 已完成的波数（W4）。 */
  wave?: number;
  /** 最近一次**已交付**的精英波（W11 里程碑幂等）。 */
  lastEliteWave?: number;
  /** 最近一次**已交付**的守关 BOSS 波（W11 里程碑幂等）。 */
  lastBossWave?: number;
}

/**
 * 波次类存档值 → 安全整数。
 *
 * `NaN` / `Infinity` / 负数 / 非数字 / `0` 一律归 `0`（`0` 波等价于「本图无进度」）。
 */
export function worldWaveOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

/**
 * 解析一条侧车记录（**读入唯一入口**，脏数据一律收敛而不是抛错）。
 *
 * - 非对象 / `null` → `null`（调用方跳过该条）；
 * - `map` 非字符串 / 空串 → `'home'`；
 * - 波数类字段：非正 / 非有限 → 省略（不落 `0`）；
 * - `lastEliteWave` / `lastBossWave` **晚于 `wave`** → 丢弃（脏存档防御：
 *   否则会"提前认为已交付"，导致该窗口的精英 / BOSS 永久不再刷）。
 */
export function parseWorldMapState(entry: unknown): WorldMapState | null {
  // 数组也是 `typeof === 'object'`，但绝不是合法的侧车记录 —— 显式排除。
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const raw = entry as { map?: unknown; wave?: unknown; lastEliteWave?: unknown; lastBossWave?: unknown };
  const map = typeof raw.map === 'string' && raw.map !== '' ? raw.map : 'home';
  const wave = worldWaveOf(raw.wave);
  const elite = worldWaveOf(raw.lastEliteWave);
  const boss = worldWaveOf(raw.lastBossWave);
  const out: WorldMapState = { map };
  if (wave > 0) out.wave = wave;
  if (elite > 0 && elite <= wave) out.lastEliteWave = elite;
  if (boss > 0 && boss <= wave) out.lastBossWave = boss;
  return out;
}

/**
 * **唯一写入口**（C6）。任何要改「当前地图 / 波数 / 里程碑」的地方都必须走这里。
 *
 * ⚠️ 调用方仍需自行 `markAccountDirty(userId)` —— 本函数是纯函数，不做 IO。
 */
export function writeWorldMapState(
  worldMaps: Record<string, WorldMapState>,
  characterId: string,
  patch: { map: string; wave?: number; lastEliteWave?: number; lastBossWave?: number },
): WorldMapState {
  const wave = worldWaveOf(patch.wave);
  const elite = worldWaveOf(patch.lastEliteWave);
  const boss = worldWaveOf(patch.lastBossWave);
  const next: WorldMapState = { map: patch.map };
  if (wave > 0) next.wave = wave;
  if (elite > 0 && elite <= wave) next.lastEliteWave = elite;
  if (boss > 0 && boss <= wave) next.lastBossWave = boss;
  worldMaps[characterId] = next;
  return next;
}

/**
 * 把「当前地图」写进侧车，并**在同图时保留既有波数 / 里程碑**（换图则归零）。
 *
 * 这是**离线结算唯一需要的写入口**：离线只推进收益、**不推演波次**，
 * 所以正确语义就是「位置照写、进度照留」。之前这里手拼 `{ map }` 把 `wave` 抹掉，
 * 而离线结算在**每次登录**都会跑（`root-store` 拉离线报告）⇒ 玩家看到的波数永远从 0 开始。
 */
export function writeWorldMapKeepingProgress(
  worldMaps: Record<string, WorldMapState>,
  characterId: string,
  map: string,
): WorldMapState {
  const prev = worldMaps[characterId];
  const sameMap = prev !== undefined && prev.map === map;
  return writeWorldMapState(worldMaps, characterId, {
    map,
    ...(sameMap
      ? {
          wave: prev.wave,
          lastEliteWave: prev.lastEliteWave,
          lastBossWave: prev.lastBossWave,
        }
      : {}),
  });
}

/**
 * 深拷贝侧车（`PlayerContextService` 的缓存快照要用，避免调用方改到缓存本体）。
 *
 * 与 {@link parseWorldMapState} 的差别：这里**保留** `map` 的原始值（不做 `home` 兜底），
 * 因为快照只是复制，兜底属于「解析存档」的职责。
 */
export function cloneWorldMaps(
  source: Record<string, WorldMapState>,
): Record<string, WorldMapState> {
  const out: Record<string, WorldMapState> = {};
  for (const key of Object.keys(source)) {
    const entry = source[key];
    if (!entry) continue;
    out[key] = parseWorldMapState(entry) ?? { map: 'home' };
  }
  return out;
}
