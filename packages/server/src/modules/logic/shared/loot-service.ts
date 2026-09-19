/**
 * 掉落生成端口实现（`combat.LootService` ← `rules/goods`）
 *
 * `BattleWorld` 通过 `LootService` 端口调用掉落生成，从而不依赖 `rules/`；
 * 服务端在此把它接回 `rules/goods.ts` 的权威实现。
 *
 * ⚠️ 返回的是**真实 `InventorySlot`**（附带 `level` / `goodData` 等额外字段，
 * 满足 `LootSlot` 的结构子集），这样 `Player.loot()` 能拿到带词缀的完整装备实例。
 */
import {
  generateEquip,
  getDecomposeMatrials,
  randomEquip,
  type DataTables,
  type LootService,
  type LootSlot,
  type Rng,
} from '@idle-dark/game-core';

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampQuality(value: unknown): number {
  const n = Math.trunc(finite(value, 0));
  if (n < 0) return 0;
  if (n > 6) return 6;
  return n;
}

export class RulesLootService implements LootService {
  constructor(
    private readonly tables: DataTables,
    private readonly rng: Rng,
  ) {}

  randomEquip(level: number, mfRate: number, position?: string): LootSlot {
    const safeLevel = Math.max(1, Math.trunc(finite(level, 1)));
    const safeMf = finite(mfRate, 1);
    const slot = randomEquip(this.tables, safeLevel, safeMf, position, this.rng);
    return slot as unknown as LootSlot;
  }

  generateEquip(kind: string, level: number, quality: number, legend?: string): LootSlot {
    const safeLevel = Math.max(1, Math.trunc(finite(level, 1)));
    const slot = generateEquip(
      this.tables,
      kind,
      safeLevel,
      clampQuality(quality),
      legend ?? null,
      this.rng,
    );
    return slot as unknown as LootSlot;
  }

  getDecomposeMaterials(slot: LootSlot): Record<string, number> {
    const level = (slot as unknown as { level?: unknown }).level;
    return getDecomposeMatrials({
      level: Math.max(1, Math.trunc(finite(level, 1))),
      quality: clampQuality(slot.quality),
    });
  }
}
