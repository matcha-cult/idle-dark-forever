/**
 * E0.5 回归：装备词缀 hook 重绑必须对「未知 / 缺失词缀」健壮。
 *
 * ## 背景（12 号任务书 §2.1 / §3.3 的红框）
 *
 * 词缀是**按 key 持久化**的（`AffixInfoJson{key,value,rebuilded}`），而词缀池会随版本变化：
 * E1 删 `sta`、E3 重写池、E5 把 `dark*` 改名 `chaos*` —— 三次都会改 key 集合。
 * `AffixInfo.affixData` 查不到 key 时返回 `undefined`（`rules/inventory-slot.ts:123-128`），
 * 于是 `PlayerUnit.rebindEquipmentHooks()` 里的 `affixInfo.affixData.hooks` 会在**构造器**
 * 阶段抛 `TypeError`，让**整个角色载入失败**。
 *
 * 本文件是那条路径的回归门禁：去掉 `?.` 后，下面「未知 key」用例必失败（已实测）。
 */

import { describe, expect, it } from 'vitest';

import type { EquipmentSlotLike } from './player-unit.js';
import { makePlayer, makeTestWorld } from './test-support.js';

/** 造一个非空装备槽（只填 hook 绑定真正会读的字段）。 */
function equippedSlot(affixes: EquipmentSlotLike['affixes']): EquipmentSlotLike {
  return {
    empty: false,
    level: 10,
    atk: 5,
    atkSpeed: 1,
    def: 0,
    maxHp: 0,
    affixes,
  };
}

describe('E0.5 装备词缀 hook 重绑：未知 / 缺失 key 不得让角色载入崩溃', () => {
  it('词缀 key 不在池中（affixData 为 undefined）→ 载入不抛错，该条被安全跳过', () => {
    const t = makeTestWorld({ seed: 7 });
    const player = makePlayer();
    player.equipments.weapon = equippedSlot([
      // 老存档里的 `sta`（E1 会删）或任何已从池中移除的 key —— 真实路径返回 undefined。
      { affixData: undefined, value: 999 },
      // 一条仍然有效的词缀，必须照常生效（词缀 hook 签名是 `(effect, value)`）。
      { affixData: { hooks: { atk: (_effect: number, value: number) => value + 7 } }, value: 1 },
    ]);

    let unit!: ReturnType<typeof t.world.addPlayer>;
    expect(() => {
      unit = t.world.addPlayer(player);
    }).not.toThrow();

    // 合法词缀生效：atk = 武器基值 5 + 词缀 7 = 12。
    expect(unit.atk).toBe(12);
  });

  it('affixData 为 null（脏数据防御）→ 不抛错且跳过', () => {
    const t = makeTestWorld({ seed: 8 });
    const player = makePlayer();
    player.equipments.plastron = equippedSlot([
      { affixData: null as unknown as undefined, value: 3 },
    ]);
    expect(() => t.world.addPlayer(player)).not.toThrow();
  });

  it('affixData 存在但 hooks 缺失 → 不抛错且跳过', () => {
    const t = makeTestWorld({ seed: 9 });
    const player = makePlayer();
    player.equipments.gaiter = equippedSlot([{ affixData: {}, value: 3 }]);
    expect(() => t.world.addPlayer(player)).not.toThrow();
  });

  it('空词缀数组 / 空槽 / 槽位缺失 → 均不抛错', () => {
    const t = makeTestWorld({ seed: 10 });
    const player = makePlayer();
    player.equipments.weapon = equippedSlot([]);
    player.equipments.plastron = {
      empty: true,
      level: 0,
      atk: 0,
      atkSpeed: 0,
      def: 0,
      maxHp: 0,
      // 空槽也不该读词缀，但故意塞一条未知 key 证明短路发生在读取之前。
      affixes: [{ affixData: undefined, value: 1 }],
    };
    player.equipments.gaiter = undefined as unknown as EquipmentSlotLike;
    expect(() => t.world.addPlayer(player)).not.toThrow();
  });

  it('词缀 hooks 抛错仍按现有语义向上冒泡（不做静默吞错）', () => {
    // 只是边界确认：本批**不**改变 hook 调用期的错误语义，只修「载入期取值」。
    const t = makeTestWorld({ seed: 11 });
    const player = makePlayer();
    player.equipments.weapon = equippedSlot([
      {
        affixData: {
          hooks: {
            atk: (() => {
              throw new Error('boom');
            }) as never,
          },
        },
        value: 1,
      },
    ]);
    expect(() => t.world.addPlayer(player).atk).toThrow('boom');
  });
});
