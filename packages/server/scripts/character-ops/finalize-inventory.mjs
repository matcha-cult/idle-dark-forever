/**
 * 把 nbb01 的背包整理成「目标态」（幂等）：
 *   - 主手：细木剑（原装）
 *   - 副手：空
 *   - 背包：秘银青铜剑 Lv.100（测试·高等级）+ 铜剑 Lv.1（测试·1 级可装备）
 * 走引擎自己的 fromJSON/toJSON。
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { createDefaultTables, Player, InventorySlot } from '@idle-dark/game-core';

const CHARACTER_ID = process.argv[2] ?? '3504fecf-a635-436b-ae19-ecbd81f1c5e4';
const tables = createDefaultTables();
const rngMax = { next: () => 0.999 };
const AFFIX_KEYS = ['atk', 'atkMul', 'str', 'dex', 'int', 'critRate', 'critBonus', 'leech', 'atkSpeedAdd', 'hpFromKill'];
const itemJson = (key, level) => ({
  key, count: 1, level, quality: 2, position: 'inventory', enchantTimes: 0, locked: false, legendType: null,
  affixes: AFFIX_KEYS.map((k) => ({ key: k, value: tables.affixes[k].generate(100, rngMax), rebuilded: false })),
});

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query('SELECT state FROM characters WHERE id = $1', [CHARACTER_ID]);
if (!rows.length) throw new Error('角色不存在');
writeFileSync(`tmp/finalize-backup-${Date.now()}.json`, JSON.stringify(rows[0].state, null, 2));

const player = Player.fromJSON(tables, CHARACTER_ID, () => Date.now(), rows[0].state);

// 1) 副手腾空（把测试武器放回背包）
const off = player.equipments.offHand;
if (off.key && (off.key === 'copperSword' || off.key === 'mithrilCopperSword')) {
  for (let i = 0; i < player.inventory.length && !off.empty; i += 1) {
    if (!off.empty && player.inventory[i].empty) player.inventory[i].swap(off);
  }
}

// 2) 保证两柄测试武器在背包里（缺哪把补哪把）
for (const [key, level] of [['mithrilCopperSword', 100], ['copperSword', 1]]) {
  const has = player.inventory.some((s) => s.key === key);
  if (has) continue;
  const idx = player.inventory.findIndex((s) => s.empty);
  if (idx < 0) throw new Error('背包已满');
  player.inventory[idx].fromJSON(itemJson(key, level));
}

const after = player.toJSON();
await client.query('UPDATE characters SET state = $1::jsonb WHERE id = $2', [JSON.stringify(after), CHARACTER_ID]);

const check = await client.query('SELECT state FROM characters WHERE id = $1', [CHARACTER_ID]);
const r = Player.fromJSON(tables, CHARACTER_ID, () => Date.now(), check.rows[0].state);
console.log('主手   :', r.equipments.weapon.key);
console.log('副手   :', r.equipments.offHand.key ?? '(空)');
const bag = r.inventory.filter((s) => s.key);
for (const s of bag) console.log('背包   :', s.name, '| key=', s.key, '| Lv.' + s.level, '| 需求等级', Math.ceil(s.level / 2), '| 词缀', s.affixes.length);
await client.end();
