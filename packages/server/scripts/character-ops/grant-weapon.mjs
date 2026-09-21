/**
 * 一次性工具：给指定角色塞一柄「多属性测试武器」。
 * 走引擎自己的 fromJSON / toJSON，保证写回去的存档形状与服务器持久化完全一致。
 *
 * 用法：cd packages/server && set -a && . ./.env && set +a && \
 *      node scripts/character-ops/grant-weapon.mjs <characterId> [goodKey] [itemLevel]
 *   itemLevel 决定**装备需求**：`equipBlockReason` 要求 `player.level >= ceil(itemLevel/2)`。
 *   词缀值是按等级 100 的区间上限算的，**不随 itemLevel 变**（测试用途，故意超模）。
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { createDefaultTables, Player } from '@idle-dark/game-core';

const CHARACTER_ID = process.argv[2] ?? '3504fecf-a635-436b-ae19-ecbd81f1c5e4';
const GOOD_KEY = process.argv[3] ?? 'mithrilCopperSword';
const ITEM_LEVEL = Number(process.argv[4] ?? 100);
const tables = createDefaultTables();

// ── 词缀：全部取等级 100 区间的**上限**，且都在 weapon 位上合法 ──
const rngMax = { next: () => 0.999 };
const AFFIX_KEYS = ['atk', 'atkMul', 'str', 'dex', 'int', 'critRate', 'critBonus', 'leech', 'atkSpeedAdd', 'hpFromKill'];
const affixes = AFFIX_KEYS.map((key) => {
  const data = tables.affixes[key];
  if (!data) throw new Error(`没有这个词缀：${key}`);
  return { key, value: data.generate(100, rngMax), rebuilded: false };
});

const ITEM = {
  key: GOOD_KEY,
  count: 1,
  level: ITEM_LEVEL,
  quality: 2, // 传奇档（实心橙标）
  affixes,
  enchantTimes: 0,
  locked: false,
  legendType: null,
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query('SELECT state FROM characters WHERE id = $1', [CHARACTER_ID]);
if (rows.length === 0) throw new Error('角色不存在');
const before = rows[0].state;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `tmp/character-${CHARACTER_ID}-${stamp}.json`;
writeFileSync(backup, JSON.stringify(before, null, 2));
console.log('备份 →', backup);

const player = Player.fromJSON(tables, CHARACTER_ID, () => Date.now(), before);
const index = player.inventory.findIndex((slot) => slot.empty);
if (index < 0) throw new Error('背包已满，没有空格');
player.inventory[index].fromJSON({ ...ITEM, position: 'inventory' });

const after = player.toJSON();
await client.query('UPDATE characters SET state = $1::jsonb WHERE id = $2', [JSON.stringify(after), CHARACTER_ID]);

// ── 回读校验：完全按服务器的方式再解一次，并打印展示串 ──
const check = await client.query('SELECT state FROM characters WHERE id = $1', [CHARACTER_ID]);
const reloaded = Player.fromJSON(tables, CHARACTER_ID, () => Date.now(), check.rows[0].state);
const slot = reloaded.inventory[index];
console.log('槽位          :', index);
console.log('物品          :', slot.name, '| key=', slot.key, '| 物品等级=', slot.level, '| quality=', slot.quality);
console.log('装备需求等级  :', Math.ceil(slot.level / 2), '（角色当前', reloaded.level, '级）');
console.log('词缀条数      :', slot.affixes.length);
for (const a of slot.affixes) console.log('  -', a.key.padEnd(12), JSON.stringify(a.value), '→', a.display);
console.log('价格          :', slot.price);
await client.end();
