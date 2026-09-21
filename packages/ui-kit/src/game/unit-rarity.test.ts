// @vitest-environment node
/**
 * 怪物稀有度契约（4 档）的纯函数与常量边界测试。
 *
 * 末段是**跨包一致性门禁**：protocol 的 `UNIT_RARITY_NAMES` 是值导出，本包运行时不能 import 它
 * （红线：只依赖 antd + react），所以直接读 `packages/protocol/src/dto.ts` 源码做逐字比对 ——
 * 与 `quality.test.ts` 同一套做法。
 *
 * 这个文件同时钉住一条**产品语义**：`普通 / 稀有 / 精英 / 传奇` 是 4 档，
 * 而 `quality`（敌人词缀条数）不是稀有度 —— 二者一旦混用，就会出现
 * 「两条词缀的精英怪被画成传奇」并与真 BOSS 撞色。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStringArrayLiteral } from '../testing/hygiene-scan.js';
import type { RarityColor } from './rarity-palette.js';
import {
  clampUnitRarity,
  COMMON_UNIT_RARITY,
  MAX_UNIT_RARITY,
  UNIT_RARITY_LABELS,
  unitRarityLabel,
  unitRarityToneOf,
} from './unit-rarity.js';

const RARE: RarityColor = { name: '#ffff77', chip: '#ffff77', chipText: '#3d3600' };
const LEGEND: RarityColor = { name: '#ef6916', chip: '#ef6916', chipText: '#2b1000' };
const TOKENS = { elite: '#722ed1', chipText: '#ffffff' };
const PALETTE = { rare: RARE, legend: LEGEND };

function tone(rarity: number | null | undefined, labels?: readonly string[]) {
  return unitRarityToneOf(rarity, PALETTE, TOKENS, labels);
}

describe('UNIT_RARITY_LABELS', () => {
  it('4 档且顺序为「普通 / 稀有 / 精英 / 传奇」', () => {
    expect(UNIT_RARITY_LABELS).toEqual(['普通', '稀有', '精英', '传奇']);
  });

  it('普通档 = 最低档，且默认不渲染徽标', () => {
    expect(COMMON_UNIT_RARITY).toBe(0);
    expect(tone(0)).toBeNull();
  });

  it('最高档 = 传奇（守关 BOSS）', () => {
    expect(MAX_UNIT_RARITY).toBe(3);
  });
});

describe('clampUnitRarity：夹取到 0..3', () => {
  it('0..3 原样通过', () => {
    for (const v of [0, 1, 2, 3]) expect(clampUnitRarity(v), `v=${v}`).toBe(v);
  });

  it('越界与脏值（NaN / ±Infinity / 负 / 小数 / 非数字 / 缺失）', () => {
    expect(clampUnitRarity(4)).toBe(3);
    expect(clampUnitRarity(99)).toBe(3);
    expect(clampUnitRarity(Infinity)).toBe(3);
    expect(clampUnitRarity(-Infinity)).toBe(0);
    expect(clampUnitRarity(-1)).toBe(0);
    expect(clampUnitRarity(2.9)).toBe(2);
    // 可转成数字的字符串会被强制转换（与 `clampQuality` 同一口径，别在这里做类型校验）。
    expect(clampUnitRarity('2' as unknown as number)).toBe(2);
    for (const bad of [Number.NaN, null, undefined, {}, []]) {
      expect(clampUnitRarity(bad as number), `bad=${String(bad)}`).toBe(0);
    }
  });
});

describe('unitRarityLabel', () => {
  it('缺省用内置文案', () => {
    expect(unitRarityLabel(0)).toBe('普通');
    expect(unitRarityLabel(1)).toBe('稀有');
    expect(unitRarityLabel(2)).toBe('精英');
    expect(unitRarityLabel(3)).toBe('传奇');
  });

  it('labels 覆盖，缺位回退内置文案', () => {
    expect(unitRarityLabel(2, ['白', '绿'])).toBe('精英');
    expect(unitRarityLabel(1, ['白', '绿'])).toBe('绿');
  });

  it('越界夹取后取文案', () => {
    expect(unitRarityLabel(42)).toBe('传奇');
    expect(unitRarityLabel(-1)).toBe('普通');
  });
});

describe('unitRarityToneOf：档位 → 展示态', () => {
  it('稀有复用装备稀有设计色', () => {
    expect(tone(1)?.chip).toBe(RARE.chip);
    expect(tone(1)?.chipText).toBe(RARE.chipText);
  });

  it('传奇复用装备传奇设计色', () => {
    expect(tone(3)?.chip).toBe(LEGEND.chip);
    expect(tone(3)?.chipText).toBe(LEGEND.chipText);
  });

  it('精英用注入的 token 色，且与稀有 / 传奇**都不同**（否则四阶退化）', () => {
    expect(tone(2)?.chip).toBe(TOKENS.elite);
    expect(tone(2)?.chip).not.toBe(tone(1)?.chip);
    expect(tone(2)?.chip).not.toBe(tone(3)?.chip);
  });

  it('归一后的档位写进产物（供 data-rarity 断言）', () => {
    expect(tone(1)?.rarity).toBe(1);
    expect(tone(2)?.rarity).toBe(2);
    expect(tone(3)?.rarity).toBe(3);
    expect(tone(99)?.rarity).toBe(3);
  });

  it('普通 / 脏值 → null（不贴标）', () => {
    for (const bad of [0, -1, Number.NaN, null, undefined, Infinity]) {
      if (bad === Infinity) {
        expect(tone(bad)?.rarity).toBe(3);
        continue;
      }
      expect(tone(bad as number), `bad=${String(bad)}`).toBeNull();
    }
  });
});

describe('与 @idle-dark/protocol 的一致性（协议是唯一真相）', () => {
  const protocolDto = readFileSync(
    fileURLToPath(new URL('../../../protocol/src/dto.ts', import.meta.url)),
    'utf8',
  );
  const protocolNames = parseStringArrayLiteral(
    protocolDto,
    /UNIT_RARITY_NAMES[^=]*=\s*\[([^\]]*)\]/,
  );

  it('本地 UNIT_RARITY_LABELS 与 protocol UNIT_RARITY_NAMES 逐字一致', () => {
    expect(protocolNames).toHaveLength(4);
    expect(UNIT_RARITY_LABELS).toEqual(protocolNames);
  });

  it('本地 MAX_UNIT_RARITY 与协议 UNIT_RARITY_MAX 一致', () => {
    const maxFromProtocol = /UNIT_RARITY_MAX\s*=\s*(\d+)/.exec(protocolDto)?.[1];
    expect(Number(maxFromProtocol)).toBe(MAX_UNIT_RARITY);
  });
});
