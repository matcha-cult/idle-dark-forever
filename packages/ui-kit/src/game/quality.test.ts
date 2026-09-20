// @vitest-environment node
/**
 * 品质契约的纯函数与常量边界测试（3 档）。
 *
 * 末段是**跨包一致性门禁**：protocol 的 `QUALITY_NAMES` 是值导出，本包运行时不能 import 它
 * （红线：只依赖 antd + react），所以直接读 `packages/protocol/src/dto.ts` 源码做逐字比对。
 * 放在这里而不是 `hygiene.test.ts`：它是「品质」这条契约的天然归属地。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStringArrayLiteral } from '../testing/hygiene-scan.js';
import {
  clampQuality,
  MAX_QUALITY,
  QUALITY_COLOR_TOKEN_NAMES,
  QUALITY_LABELS,
  qualityColorTokenName,
  qualityLabel,
} from './quality.js';

describe('QUALITY_LABELS', () => {
  it('3 档且顺序与协议一致', () => {
    expect(QUALITY_LABELS).toEqual(['普通', '优秀', '传奇']);
  });

  it('色 token 名 3 个且互不重复', () => {
    expect(QUALITY_COLOR_TOKEN_NAMES).toHaveLength(3);
    expect(new Set(QUALITY_COLOR_TOKEN_NAMES).size).toBe(3);
  });
});

describe('clampQuality', () => {
  it('合法档位原样返回', () => {
    expect(clampQuality(0)).toBe(0);
    expect(clampQuality(1)).toBe(1);
    expect(clampQuality(MAX_QUALITY)).toBe(2);
  });

  it('小数截断', () => {
    expect(clampQuality(2.9)).toBe(2);
    expect(clampQuality(-0.4)).toBe(0);
  });

  it('负值 / 越界夹取', () => {
    expect(clampQuality(-5)).toBe(0);
    expect(clampQuality(99)).toBe(2);
  });

  it('NaN / Infinity / undefined → 夹取', () => {
    expect(clampQuality(Number.NaN)).toBe(0);
    expect(clampQuality(Number.POSITIVE_INFINITY)).toBe(2);
    expect(clampQuality(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampQuality(undefined as unknown as number)).toBe(0);
  });
});

describe('qualityLabel', () => {
  it('缺省用内置文案', () => {
    expect(qualityLabel(0)).toBe('普通');
    expect(qualityLabel(2)).toBe('传奇');
  });

  it('labels 覆盖，缺位回退内置文案', () => {
    expect(qualityLabel(0, ['白', '绿'])).toBe('白');
    expect(qualityLabel(1, ['白', '绿'])).toBe('绿');
    expect(qualityLabel(2, ['白', '绿'])).toBe('传奇');
  });

  it('越界夹取后取文案', () => {
    expect(qualityLabel(42)).toBe('传奇');
    expect(qualityLabel(-1)).toBe('普通');
  });
});

describe('qualityColorTokenName', () => {
  it('3 档各自映射到不同 token 名', () => {
    const names = Array.from({ length: 3 }, (_, index) => qualityColorTokenName(index));
    expect(names).toEqual([...QUALITY_COLOR_TOKEN_NAMES]);
  });

  it('越界夹取', () => {
    expect(qualityColorTokenName(99)).toBe(QUALITY_COLOR_TOKEN_NAMES[2]);
    expect(qualityColorTokenName(Number.NaN)).toBe(QUALITY_COLOR_TOKEN_NAMES[0]);
  });
});

describe('与 @idle-dark/protocol 的一致性（协议是唯一真相）', () => {
  const protocolDto = readFileSync(
    fileURLToPath(new URL('../../../protocol/src/dto.ts', import.meta.url)),
    'utf8',
  );
  const protocolNames = parseStringArrayLiteral(protocolDto, /QUALITY_NAMES[^=]*=\s*\[([^\]]*)\]/);
  const qualityUnion = /export type Quality = ([^;]+);/.exec(protocolDto)?.[1] ?? '';

  it('protocol 的 Quality 是 0..2 共 3 档', () => {
    expect(qualityUnion.split('|').map((part) => part.trim())).toEqual(['0', '1', '2']);
  });

  it('本地 QUALITY_LABELS 与 protocol QUALITY_NAMES 逐字一致', () => {
    expect(protocolNames).toHaveLength(3);
    expect(QUALITY_LABELS).toEqual(protocolNames);
  });

  it('本地色 token 名恰好 3 个且互不重复', () => {
    expect(QUALITY_COLOR_TOKEN_NAMES).toHaveLength(protocolNames.length);
    expect(new Set(QUALITY_COLOR_TOKEN_NAMES).size).toBe(protocolNames.length);
  });
});
