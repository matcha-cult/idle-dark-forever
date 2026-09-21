import { Player, VirtualClock, createDefaultTables } from '@idle-dark/game-core';
import { BattleCollector } from '../../dist/modules/logic/shared/battle-collector.js';
import { buildBattleWorld } from '../../dist/modules/logic/shared/headless.js';
import { unitStateDtoOf } from '../../dist/modules/logic/world/internal/unit-state.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;
const player = Player.fromJSON(tables, 'c1', () => NOW, {
  role: 'Eyer', currentCareer: 'warrior', careers: { warrior: { type: 'warrior', level: 1 } },
});
player.postCreate();
player.selectCareer('warrior');
const clock = new VirtualClock();
const { world, playerUnit } = buildBattleWorld({ tables, player, map: 'world.1', seed: 5, sink: new BattleCollector(), clock });
clock.advanceBy(20_000, 5_000);

const dto = unitStateDtoOf(playerUnit, world.playerUnit);
const withAttr = Buffer.byteLength(JSON.stringify(dto), 'utf8');
const { attributes, exp, maxExp, ...rest } = dto;
const withoutAttr = Buffer.byteLength(JSON.stringify(rest), 'utf8');
console.log('玩家单位 DTO：', withAttr, 'B');
console.log('去掉 attributes/exp/maxExp：', withoutAttr, 'B');
console.log('attributes 对象：', Buffer.byteLength(JSON.stringify(attributes), 'utf8'), 'B');
console.log('静态字段（add/reset 才发一次）之外的 chg 典型负载：hp/exp 各约 20B');
const enemy = world.units.find((u) => u !== world.playerUnit);
if (enemy) {
  const e = unitStateDtoOf(enemy, world.playerUnit);
  console.log('敌方单位 DTO：', Buffer.byteLength(JSON.stringify(e), 'utf8'), 'B；有 attributes 吗？', e.attributes !== undefined);
}
world.dispose(); clock.dispose();
