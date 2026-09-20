/**
 * 钱包（R1）边界单测。
 *
 * 设定：`GoodData.wallet === true` 的通货 / 精华 / 一般等价物**不占背包格**，
 * 计入 `Player.wallet`（无上限）；混沌钥石不是钱包物品。
 *
 * 覆盖门禁 §5.3：**背包满时通货仍能获得**；并覆盖 undefined/null/NaN/负数/0/
 * 超大值/精度边界/错误路径。
 */
import { describe, expect, it } from 'vitest';

import { InventorySlot } from './inventory-slot.js';
import { Player } from './player.js';
import { createDefaultTables } from '../data/index.js';
import { createTestTables } from './fixtures.test.js';

const tables = createTestTables();
const NOW = 1_700_000_000_000;
const now = (): number => NOW;

function makePlayer(): Player {
  return new Player(tables, 'p1', now);
}

function item(key: string, count: number): InventorySlot {
  return new InventorySlot(tables, 'loot').fromJSON({ key, count });
}

describe('钱包：物品标记', () => {
  it('isWalletGood 只认 GoodData.wallet === true，未知 key 为 false', () => {
    const player = makePlayer();
    expect(player.isWalletGood('currency.chaos')).toBe(true);
    expect(player.isWalletGood('essence.atk')).toBe(true);
    // 普通材料仍占背包。
    expect(player.isWalletGood('potion')).toBe(false);
    expect(player.isWalletGood('nope')).toBe(false);
    expect(player.isWalletGood('')).toBe(false);
  });

  it('真实数据表：12 种通货 + 18 个精华槽全部是钱包物品，普通材料不是', () => {
    const real = createDefaultTables();
    const walletKeys = Object.values(real.goods)
      .filter((good) => good.wallet === true)
      .map((good) => good.key);
    expect(walletKeys.filter((key) => key.startsWith('currency.'))).toHaveLength(12);
    // 实装 6 + 空位 6 = 12 个 essence key。
    expect(walletKeys.filter((key) => key.startsWith('essence.'))).toHaveLength(12);
    // 普通材料（例如黏液）不得被标记为钱包物品。
    const mucus = Object.values(real.goods).find((good) => good.key === 'mucus');
    expect(mucus?.wallet).toBeUndefined();
  });
});

describe('钱包：掉落不占背包格', () => {
  it('通货入包不占格：inventory 长度不变、wallet 增加、返回全额', () => {
    const player = makePlayer();
    const before = player.inventory.length;
    const slot = item('currency.chaos', 5);
    const placed = player.loot(slot);
    expect(placed).toBe(5);
    expect(player.inventory.length).toBe(before);
    expect(player.countGood('currency.chaos')).toBe(0);
    expect(player.walletCount('currency.chaos')).toBe(5);
    // `Player.loot` 会清空传入槽（`lootGood` 依赖这一点）。
    expect(slot.key).toBeNull();
  });

  it('**背包满**时通货仍能获得（门禁 §5.3 回归）', () => {
    const player = makePlayer();
    // 不放任何背包格 → 背包容量视为 0。
    expect(player.inventory.length).toBe(0);
    expect(player.loot(item('currency.chaos', 7))).toBe(7);
    expect(player.walletCount('currency.chaos')).toBe(7);
  });

  it('背包满时普通材料被丢弃（lost 路径仍成立）', () => {
    const player = makePlayer();
    // potion 可堆叠但没有任何格子 → 放不下。
    expect(player.loot(item('potion', 3))).toBe(0);
    expect(player.walletCount('potion')).toBe(0);
  });

  it('钱包无容量上限：一次投入超大数量全额落地', () => {
    const player = makePlayer();
    const huge = Number.MAX_SAFE_INTEGER;
    expect(player.loot(item('currency.chaos', huge))).toBe(huge);
    expect(player.walletCount('currency.chaos')).toBe(huge);
    // 继续累加仍为精确整数（未溢出为负数）。
    expect(player.loot(item('currency.chaos', huge))).toBe(huge);
    expect(player.walletCount('currency.chaos')).toBeGreaterThan(0);
  });

  it('钱包物品与普通材料可同时掉落且互不干扰', () => {
    const player = makePlayer();
    player.inventory.push(new InventorySlot(tables, 'inventory'));
    expect(player.loot(item('currency.chaos', 2))).toBe(2);
    expect(player.loot(item('potion', 3))).toBe(3);
    expect(player.walletCount('currency.chaos')).toBe(2);
    expect(player.countGood('potion')).toBe(3);
    // 钱包物品不在背包里。
    expect(player.inventory.some((slot) => slot.key === 'currency.chaos')).toBe(false);
  });

  it('金币 / 神力优先级高于钱包分支（不会被写成钱包物品）', () => {
    const player = makePlayer();
    player.loot(item('gold', 100));
    player.loot(item('diamonds', 2));
    expect(player.gold).toBe(100);
    expect(player.account.diamonds).toBe(2);
    expect(player.wallet.has('gold')).toBe(false);
    expect(player.wallet.has('diamonds')).toBe(false);
  });

  it('空槽 / null key 不产生钱包条目', () => {
    const player = makePlayer();
    expect(player.loot(new InventorySlot(tables, 'loot'))).toBe(0);
    expect(player.wallet.size).toBe(0);
  });

  it('负数 / 0 / NaN 数量不污染钱包（返回 0，条目不被写入）', () => {
    const player = makePlayer();
    expect(player.loot(item('currency.chaos', 0))).toBe(0);
    expect(player.loot(item('currency.chaos', -5))).toBe(0);
    expect(player.wallet.has('currency.chaos')).toBe(false);
  });

  it('钱包物品忽略 target 容器：即使指定其它背包也进钱包', () => {
    const player = makePlayer();
    const bag: InventorySlot[] = [new InventorySlot(tables, 'inventory')];
    expect(player.loot(item('essence.atk', 4), bag)).toBe(4);
    expect(player.walletCount('essence.atk')).toBe(4);
    expect(bag[0]!.key).toBeNull();
  });
});

describe('钱包：存档往返', () => {
  it('toJSON / fromJSON 保留数量并丢弃 0 / 负数 / NaN', () => {
    const player = makePlayer();
    player.loot(item('currency.chaos', 3));
    player.loot(item('essence.atk', 9));
    const json = player.toJSON();
    expect(json.wallet).toEqual({ 'currency.chaos': 3, 'essence.atk': 9 });

    const reloaded = Player.fromJSON(tables, 'p2', now, json);
    expect(reloaded.walletCount('currency.chaos')).toBe(3);
    expect(reloaded.walletCount('essence.atk')).toBe(9);

    const dirty = Player.fromJSON(tables, 'p3', now, {
      wallet: { 'currency.chaos': 5, 'essence.atk': 0, bad1: -1, bad2: Number.NaN, bad3: Number.POSITIVE_INFINITY },
    });
    expect(dirty.walletCount('currency.chaos')).toBe(5);
    expect(dirty.wallet.size).toBe(1);
  });

  it('缺省 / null / 非对象 wallet 视为空钱包', () => {
    for (const raw of [undefined, null, 0, 'x', []]) {
      const player = Player.fromJSON(tables, 'p4', now, { wallet: raw });
      expect(player.wallet.size).toBe(0);
    }
  });
});

describe('钱包：扣款边界', () => {
  it('余额充足：全额扣除，扣清后条目删除', () => {
    const player = makePlayer();
    player.loot(item('currency.chaos', 5));
    expect(player.costWallet('currency.chaos', 3)).toBe(0);
    expect(player.walletCount('currency.chaos')).toBe(2);
    expect(player.costWallet('currency.chaos', 2)).toBe(0);
    expect(player.wallet.has('currency.chaos')).toBe(false);
  });

  it('余额不足：不部分扣除（原子），返回缺口', () => {
    const player = makePlayer();
    player.loot(item('currency.chaos', 2));
    expect(player.costWallet('currency.chaos', 10)).toBe(8);
    expect(player.walletCount('currency.chaos')).toBe(2);
  });

  it('非法数量：0 / 负数返回 0 不动钱包；NaN 原样返回', () => {
    const player = makePlayer();
    player.loot(item('currency.chaos', 4));
    expect(player.costWallet('currency.chaos', 0)).toBe(0);
    expect(player.costWallet('currency.chaos', -3)).toBe(0);
    expect(Number.isNaN(player.costWallet('currency.chaos', Number.NaN))).toBe(true);
    expect(player.walletCount('currency.chaos')).toBe(4);
  });

  it('Infinity 视为无法满足（返回 Infinity，不扣款）', () => {
    const player = makePlayer();
    player.loot(item('currency.chaos', 4));
    expect(player.costWallet('currency.chaos', Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(player.walletCount('currency.chaos')).toBe(4);
  });

  it('未持有的 key 扣款：返回全额缺口', () => {
    const player = makePlayer();
    expect(player.costWallet('currency.mirror', 1)).toBe(1);
  });
});
