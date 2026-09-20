/**
 * 测试用秘境图夹具（W3 临时）。
 *
 * 背景：W3 用全新地图种子**整体替换**了 `data/maps.ts`，旧 `town.*` / `silver.*` /
 * `chapter*` 秘境图被物理删除；`nightmare.*` 与 `year2018.dungeon` 保留但数量不足以
 * 支撑秘境控制器单测（票键去重、神力重置的不同价格档）。
 *
 * 秘境体系在 W6 整体删除，本夹具随之移除。这里的字段与旧 `town.*` 秘境同形，
 * 让单测继续验证**控制器逻辑**而不依赖具体地图内容。
 */
import type { DataTables, MapData } from '@idle-dark/game-core';

interface TestDungeonSpec {
  key: string;
  level: number;
  resetPrice: number;
  outside?: string;
}

const SPECS: TestDungeonSpec[] = [
  // 与旧 `town.cave2` 等价：可重置、价格 30、通关后转入开放图。
  { key: 'test.cave', level: 30, resetPrice: 30, outside: 'world.1' },
  // 与旧 `town.mine.2` 等价。
  { key: 'test.mine', level: 50, resetPrice: 50, outside: 'world.2' },
  // 与旧 `silver.warrior` 等价：`resetPrice = -1` → 不可重置。
  { key: 'test.noreset', level: 60, resetPrice: -1 },
  // 填充票键（去重后数量 > 10 的老断言仍成立）。
  ...Array.from({ length: 10 }, (_, i) => ({
    key: `test.filler.${i + 1}`,
    level: 70 + i,
    resetPrice: 70 + i,
  })),
];

/** 把测试秘境图写入一份 tables 实例（就地修改）。 */
export function addTestDungeons(tables: DataTables): void {
  for (const spec of SPECS) {
    const map: MapData = {
      key: spec.key,
      name: `测试秘境 ${spec.key}`,
      hint: 'W3 单测夹具（W6 随秘境体系删除）。',
      level: spec.level,
      requirement: {},
      isDungeon: true,
      resetPrice: spec.resetPrice,
      maxCoolDownStack: 1,
      ...(spec.outside === undefined ? {} : { outside: spec.outside }),
      phases: [
        {
          description: 'P1',
          monsters: [{ type: 'slime.minimal', total: 1, delay: 1000, max: 1 }],
        },
      ],
    };
    tables.maps[spec.key] = map;
  }
}
