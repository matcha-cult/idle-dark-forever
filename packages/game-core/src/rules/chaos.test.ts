/**
 * 混沌仪纯规则 + `Player` 混沌状态存档边界（W6）。
 *
 * 覆盖：阶位换算 / 混沌图判定 / 解锁判据（全部野外 BOSS）/ 序列与失败选项的
 * JSON 往返与脏数据夹紧（undefined / null / NaN / 越界 / 非法 key / 超长）。
 */
import { describe, expect, it } from 'vitest';
import { createDefaultTables } from '../data/index.js';
import { Player } from './player.js';
import {
  CHAOS_MAX_RETRY,
  CHAOS_MAX_SEQUENCE,
  chaosLevelOfTier,
  chaosMapKeyOfTier,
  chaosTierOfMapKey,
  hasAllWorldBossesKilled,
  isChaosFailMode,
  isChaosMap,
  isWorldBossMap,
  worldBossMapKeys,
} from './chaos.js';

const tables = createDefaultTables();

function freshPlayer(): Player {
  const player = new Player(tables, 'char-1', () => 1_700_000_000_000);
  player.role = 'Eyer';
  player.postCreate();
  return player;
}

describe('混沌仪 · 阶位换算', () => {
  it('T1=85 … T16=100；非法阶一律 null', () => {
    expect(chaosLevelOfTier(1)).toBe(85);
    expect(chaosLevelOfTier(16)).toBe(100);
    for (const bad of [0, 17, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chaosLevelOfTier(bad)).toBeNull();
    }
  });

  it('地图 key 与阶互逆；非法 key → null', () => {
    expect(chaosMapKeyOfTier(1)).toBe('chaos.t01');
    expect(chaosMapKeyOfTier(16)).toBe('chaos.t16');
    expect(chaosMapKeyOfTier(0)).toBeNull();
    expect(chaosMapKeyOfTier(17)).toBeNull();
    for (let tier = 1; tier <= 16; tier += 1) {
      expect(chaosTierOfMapKey(chaosMapKeyOfTier(tier)!)).toBe(tier);
    }
    for (const bad of ['chaos.t00', 'chaos.t17', 'chaos.t01x', 'world.1', '']) {
      expect(chaosTierOfMapKey(bad)).toBeNull();
    }
  });

  it('isChaosMap：仅合法 1~16 整数标记为混沌图', () => {
    expect(isChaosMap({ chaos: 1 })).toBe(true);
    expect(isChaosMap({ chaos: 16 })).toBe(true);
    expect(isChaosMap({ chaos: 0 })).toBe(false);
    expect(isChaosMap({ chaos: 17 })).toBe(false);
    expect(isChaosMap({ chaos: 1.5 })).toBe(false);
    expect(isChaosMap({})).toBe(false);
    expect(isChaosMap(null)).toBe(false);
    expect(isChaosMap(undefined)).toBe(false);
  });

  it('isWorldBossMap：有 boss 且非混沌图', () => {
    expect(isWorldBossMap({ boss: 'x' })).toBe(true);
    expect(isWorldBossMap({ boss: 'x', chaos: 1 })).toBe(false);
    expect(isWorldBossMap({})).toBe(false);
    expect(isWorldBossMap({ boss: '' })).toBe(false);
    expect(isWorldBossMap(null)).toBe(false);
  });
});

describe('混沌仪 · 解锁判据', () => {
  it('数据驱动的野外 BOSS 图恰好 13 张（world.1..world.13，不含混沌图）', () => {
    const keys = worldBossMapKeys(tables.maps);
    expect(keys).toHaveLength(13);
    expect(keys).toEqual(Array.from({ length: 13 }, (_, i) => `world.${i + 1}`));
  });

  it('全部击杀才解锁；缺一不可；空要求 fail-closed', () => {
    const all = worldBossMapKeys(tables.maps);
    expect(hasAllWorldBossesKilled(tables.maps, [])).toBe(false);
    expect(hasAllWorldBossesKilled(tables.maps, all.slice(0, 12))).toBe(false);
    expect(hasAllWorldBossesKilled(tables.maps, all)).toBe(true);
    expect(hasAllWorldBossesKilled(tables.maps, new Set(all))).toBe(true);
    // 无野外 BOSS 图（数据缺失）→ false，而不是「空集合视为解锁」
    expect(hasAllWorldBossesKilled({ 'chaos.t01': { boss: 'x', chaos: 1 } }, [])).toBe(false);
  });

  it('Player.hasAllWorldBossesKilled 随击杀集合变化', () => {
    const player = freshPlayer();
    expect(player.hasAllWorldBossesKilled()).toBe(false);
    for (const key of worldBossMapKeys(tables.maps).slice(0, 12)) {
      player.markWorldBossKilled(key);
    }
    expect(player.hasAllWorldBossesKilled()).toBe(false);
    player.markWorldBossKilled('world.13');
    expect(player.hasAllWorldBossesKilled()).toBe(true);
  });
});

describe('Player · 混沌状态 JSON 往返与脏数据夹紧', () => {
  it('正常往返：序列 / 失败选项 / 下标 / 重试 / 运行态全部保留', () => {
    const player = freshPlayer();
    player.chaosSequence = ['keystone.t01', 'keystone.t01', 'keystone.t16'];
    player.chaosFailMode = 'continue';
    player.chaosIndex = 2;
    player.chaosRetry = 1;
    player.chaosActive = true;

    const restored = Player.fromJSON(tables, 'char-1', () => 1, player.toJSON());
    expect(restored.chaosSequence).toEqual(['keystone.t01', 'keystone.t01', 'keystone.t16']);
    expect(restored.chaosFailMode).toBe('continue');
    expect(restored.chaosIndex).toBe(2);
    expect(restored.chaosRetry).toBe(1);
    expect(restored.chaosActive).toBe(true);
  });

  it('malformed：非数组序列 → 空、非法 key 丢弃、超长截断到 16、允许重复', () => {
    const many = Array.from({ length: 20 }, () => 'keystone.t03');
    const restored = Player.fromJSON(
      tables,
      'char-1',
      () => 1,
      {
        chaosSequence: ['keystone.t01', 'garbage', 7, null, 'keystone.t99', ...many],
      },
    );
    expect(restored.chaosSequence.length).toBe(CHAOS_MAX_SEQUENCE);
    expect(restored.chaosSequence.every((key) => key === 'keystone.t01' || key === 'keystone.t03')).toBe(true);
    expect(restored.chaosSequence[0]).toBe('keystone.t01');

    const notArray = Player.fromJSON(tables, 'char-1', () => 1, { chaosSequence: 'keystone.t01' });
    expect(notArray.chaosSequence).toEqual([]);
  });

  it('malformed：failMode 非法回落 normal；index / retry 夹紧为非负整数', () => {
    const restored = Player.fromJSON(
      tables,
      'char-1',
      () => 1,
      {
        chaosSequence: ['keystone.t05'],
        chaosFailMode: 'nope',
        chaosIndex: Number.NaN,
        chaosRetry: Number.POSITIVE_INFINITY,
        chaosActive: true,
      },
    );
    expect(restored.chaosFailMode).toBe('normal');
    expect(restored.chaosIndex).toBe(0);
    expect(restored.chaosRetry).toBe(0);

    const high = Player.fromJSON(
      tables,
      'char-1',
      () => 1,
      {
        chaosSequence: ['keystone.t05'],
        chaosIndex: 999,
        chaosRetry: 999,
        chaosActive: true,
      },
    );
    expect(high.chaosIndex).toBe(1); // clamp 到序列长度（= 已走完）
    expect(high.chaosRetry).toBe(CHAOS_MAX_RETRY);

    const negative = Player.fromJSON(tables, 'char-1', () => 1, { chaosIndex: -5, chaosRetry: -3 });
    expect(negative.chaosIndex).toBe(0);
    expect(negative.chaosRetry).toBe(0);
  });

  it('malformed：空序列时 active 强制 false', () => {
    const restored = Player.fromJSON(tables, 'char-1', () => 1, {
      chaosSequence: [],
      chaosActive: true,
      chaosIndex: 3,
    });
    expect(restored.chaosActive).toBe(false);
    expect(restored.chaosIndex).toBe(0);
  });

  it('isChaosFailMode 只认两个字面量', () => {
    expect(isChaosFailMode('normal')).toBe(true);
    expect(isChaosFailMode('continue')).toBe(true);
    expect(isChaosFailMode('NORMAL')).toBe(false);
    expect(isChaosFailMode(null)).toBe(false);
  });
});
