/**
 * 全链路集成测试（零后端）：`MemoryIonetServer` + `FakeSocketAdapterFactory`。
 *
 * 覆盖任务书要求的主链路：**登录 → 选角 → 收到推送 → 面板（store）更新**，
 * 以及边界：业务失败文案优先级、竞态守卫（乱序响应不覆盖新数据）、会话恢复。
 *
 * 运行环境刻意用 vitest 默认的 `node`：仓库未安装 jsdom / @testing-library，
 * 因此这里只驱动 store 与 transport（面板是这些 store 的纯函数式视图）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_CMD,
  BANK_CMD,
  CAREER_CMD,
  IDLE_CMD,
  INVENTORY_CMD,
  LOOTRULE_CMD,
  PLAYER_CMD,
  PRODUCE_CMD,
  SHOP_CMD,
  STORY_CMD,
  WORLD_CMD,
  businessErrorMessage,
} from '@idle-dark/protocol';
import type {
  InventorySlotDto,
  PlayerMetaDto,
  PlayerStateDto,
  StoryDto,
  UnitStateDto,
  WorldSnapshotDto,
  WorldTickDto,
} from '@idle-dark/protocol';
import { createFakePair } from '@idle-dark/ionet-transport/testing';
import { RootStore } from '../src/app/root-store.js';
import { createMemoryStorage, type StorageLike } from '../src/services/storage.js';
import { TOKEN_STORAGE_KEY } from '../src/stores/session-store.js';

// ─────────────────────────── 夹具 ───────────────────────────

const PLAYER_META: PlayerMetaDto = {
  key: 'k1',
  name: '守夜人',
  role: 'Eyer',
  roleName: '艾尔',
  currentCareer: 'warrior',
  currentCareerName: '战士',
  level: 5,
  peakLevel: 0,
  createdAt: 1,
  inBattle: false,
};

const PLAYER_STATE: PlayerStateDto = {
  key: 'k1',
  name: '守夜人',
  role: 'Eyer',
  roleName: '艾尔',
  level: 5,
  peakLevel: 0,
  exp: 10,
  maxExp: 100,
  gold: 1234,
  diamonds: 50,
  currentCareer: 'warrior',
  careers: [],
  equipments: {},
  inventory: [],
  buildInventory: [],
  awardInventory: [],
  inventorySize: 24,
  slotLimits: { maxSkillCount: 3, maxEnhanceCount: 2 },
  selectedSkills: [],
  selectedEnhances: [],
  skillExp: {},
  dungeonTickets: {},
  storiesDone: [],
  enemyTasks: {},
  medicineLevel: {},
  medicineExp: 0,
  maxMedicineExp: 100,
  map: 'home',
  endlessLevel: 0,
  pendingOfflineMs: 60_000,
};

function makeUnit(overrides: Partial<UnitStateDto> = {}): UnitStateDto {
  return {
    id: 'u1',
    kind: 'enemy',
    typeKey: 'bat',
    name: '夜蝠',
    camp: 'enemy',
    level: 3,
    quality: 1,
    hp: 20,
    maxHp: 30,
    mp: 0,
    maxMp: 0,
    rp: 0,
    maxRp: 0,
    ep: 0,
    maxEp: 0,
    comboPoint: 0,
    targetId: null,
    castingProgress: null,
    buffs: [],
    ...overrides,
  };
}

function makeSlot(overrides: Partial<InventorySlotDto> = {}): InventorySlotDto {
  return {
    id: 's1',
    key: 'sword',
    count: 1,
    level: 3,
    quality: 2,
    position: 'inventory',
    displayQuality: 2,
    name: '锈蚀短剑',
    type: 'equip',
    equipPosition: 'weapon',
    price: 10,
    locked: false,
    enchantTimes: 0,
    affixes: [],
    ...overrides,
  };
}

const SNAPSHOT: WorldSnapshotDto = {
  map: 'home',
  endlessLevel: 0,
  units: [makeUnit()],
  maps: [{ key: 'home', name: '家园', isDungeon: false, level: 1, lockedReason: null, ticketCount: 0 }],
  pendingMaps: [],
  updateRate: 1,
  paused: false,
};

/** 最小可用的 REST 假实现（只认登录）。 */
function makeFetch(): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const isLogin = url.endsWith('/auth/login');
    const body = isLogin
      ? { token: 'jwt-1', expiresAt: 9_999_999_999, userId: 'u1', displayName: '测试员' }
      : { message: `未实现的 REST 端点：${url}` };
    return {
      ok: isLogin,
      status: isLogin ? 200 : 404,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as typeof fetch;
}

interface Harness {
  root: RootStore;
  server: ReturnType<typeof createFakePair>['server'];
}

/** 装配「mock 服务端 + RootStore」，注册全部面板读接口。 */
function createHarness(storage: StorageLike = createMemoryStorage()): Harness {
  const { factory, server } = createFakePair();
  const ok = (data: unknown): { data: unknown } => ({ data: { success: true, data } });

  server
    .on(AUTH_CMD.cmd, AUTH_CMD.me, () =>
      ok({ userId: 'u1', displayName: '测试员', diamonds: 50, playerSlotCount: 1, highestEndlessLevel: 0 }),
    )
    .on(PLAYER_CMD.cmd, PLAYER_CMD.list, () => ok([PLAYER_META]))
    .on(PLAYER_CMD.cmd, PLAYER_CMD.select, () => ok(PLAYER_STATE))
    .on(WORLD_CMD.cmd, WORLD_CMD.snapshot, () => ok(SNAPSHOT))
    .on(INVENTORY_CMD.cmd, INVENTORY_CMD.list, () => ok([makeSlot()]))
    .on(BANK_CMD.cmd, BANK_CMD.list, () => ok([]))
    .on(CAREER_CMD.cmd, CAREER_CMD.list, () =>
      ok({ careers: [], skills: [], enhances: [], maxSkillCount: 3, maxEnhanceCount: 2 }),
    )
    .on(PRODUCE_CMD.cmd, PRODUCE_CMD.medicineState, () =>
      ok({ levels: {}, exp: 0, maxExp: 100, bowelLevel: 1, bowelEffect: 1, bowelUpgradePrice: 100 }),
    )
    .on(STORY_CMD.cmd, STORY_CMD.list, () => ok([]))
    .on(SHOP_CMD.cmd, SHOP_CMD.state, () =>
      ok({ playerSlotCount: 1, playerSlotMax: 5, nextSlotPrice: 100, diamonds: 50, exchangeOptions: [] }),
    )
    .on(IDLE_CMD.cmd, IDLE_CMD.report, () =>
      ok({
        offlineMs: 60_000,
        cappedMs: 0,
        simulatedMs: 60_000,
        extrapolatedMs: 0,
        gainedExp: 5,
        gainedGold: 10,
        kills: 1,
        loots: [],
        materials: [],
        pausedByMaxOffline: false,
      }),
    )
    .on(LOOTRULE_CMD.cmd, LOOTRULE_CMD.get, () => ok({ enabled: true, minLevel: 1, rules: [] }));

  const root = new RootStore({
    wsUrl: 'ws://test.local/ws',
    baseUrl: '/api',
    storage,
    adapterFactory: factory.create,
    fetchImpl: makeFetch(),
    autoRefreshMetricsMs: 0,
  });
  return { root, server };
}

const opened: RootStore[] = [];
afterEach(() => {
  for (const root of opened.splice(0)) root.dispose();
});

// ─────────────────────────── 用例 ───────────────────────────

describe('登录 → 选角 → 推送 → 面板更新', () => {
  it('登录后连上 WS、拉到角色列表；选角后各域面板拿到服务端数据', async () => {
    const { root, server } = createHarness();
    opened.push(root);

    // 1) 登录（REST）→ token 落盘 → `?token=` 连 WS → 并发拉账号 / 角色列表
    await expect(root.login('tester', 'secret123')).resolves.toBe(true);
    expect(root.session.isAuthenticated).toBe(true);
    expect(root.session.token).toBe('jwt-1');
    expect(root.connection.state).toBe('online');
    expect(root.session.players).toHaveLength(1);
    expect(root.session.hasPlayers).toBe(true);
    expect(root.session.hasCharacter).toBe(false);

    // 2) 选角 → 服务端权威角色态 + 面板并发加载
    await expect(root.selectCharacter('k1')).resolves.toBe(true);
    expect(root.session.hasCharacter).toBe(true);
    expect(root.player.name).toBe('守夜人');
    expect(root.player.gold).toBe(1234);
    expect(root.player.pendingOfflineMs).toBe(60_000);

    expect(root.world.snapshot?.map).toBe('home');
    expect(root.world.units).toHaveLength(1);
    expect(root.world.maps).toHaveLength(1);
    expect(root.inventory.inventory).toHaveLength(1);
    // P2：装备栏固定 9 槽（前端按协议常量渲染，不硬编码）。
    expect(root.inventory.equipments).toHaveLength(9);
    expect(root.inventory.equipments.map((entry) => entry.position)).toEqual([
      'weapon',
      'offHand',
      'plastron',
      'gloves',
      'belt',
      'boots',
      'amulet',
      'ring1',
      'ring2',
    ]);
    expect(root.inventory.equipments.find((entry) => entry.position === 'weapon')?.slot).toBeNull();
    expect(root.idle.report?.kills).toBe(1);
    expect(root.idle.hasPending).toBe(true);
    expect(root.idle.shouldShowReport).toBe(true);

    // 3) 服务端推送世界 tick → store 只存帧（单位整体替换 + 日志追加 + 增量角标）
    const tick: WorldTickDto = {
      serverTime: 1_700_000_000_000,
      units: [
        makeUnit({ id: 'u1', hp: 5 }),
        makeUnit({ id: 'u2', camp: 'player', kind: 'player', name: '守夜人', hp: 100, maxHp: 100 }),
      ],
      events: [
        { kind: 'damage', fromId: 'u2', toId: 'u1', damageType: 'physical', skill: '斩击', value: 25, crit: false, absorbed: 0 },
        { kind: 'death', unitId: 'u1', name: '夜蝠', camp: 'enemy' },
      ],
      gainedExp: 7,
      gainedGold: 13,
    };
    server.pushRoute(WORLD_CMD.cmd, WORLD_CMD.tick, tick);
    expect(root.world.units).toHaveLength(2);
    expect(root.world.log).toHaveLength(2);
    expect(root.world.enemies).toHaveLength(1);
    expect(root.world.allies).toHaveLength(1);
    expect(root.player.lastGain).toEqual({ exp: 7, gold: 13, at: tick.serverTime });
    // 权威数值不被推送改写（前端零推导）
    expect(root.player.gold).toBe(1234);

    // 4) 服务端推送背包变更 → 格子整体替换
    server.pushRoute(INVENTORY_CMD.cmd, INVENTORY_CMD.changed, [
      makeSlot(),
      makeSlot({ id: 's2', name: '夜蝠之牙', quality: 2 }),
    ]);
    expect(root.inventory.inventory.map((slot) => slot.id)).toEqual(['s1', 's2']);
  });

  it('业务失败：服务端 message 优先，缺失时回落本地码表，且不抛异常', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');

    server.on(WORLD_CMD.cmd, WORLD_CMD.enterMap, () => ({
      data: { success: false, message: '该地图本轮不可进入', data: { code: 'MAP_LOCKED' } },
    }));
    await expect(root.world.enterMap('home')).resolves.toBe(false);
    expect(root.toast.toasts.at(-1)?.title).toBe('该地图本轮不可进入');
    expect(root.toast.toasts.at(-1)?.code).toBe('MAP_LOCKED');

    server.on(WORLD_CMD.cmd, WORLD_CMD.enterMap, () => ({
      data: { success: false, data: { code: 'NO_TICKET' } },
    }));
    await root.world.enterMap('home');
    expect(root.toast.toasts.at(-1)?.title).toBe(businessErrorMessage('NO_TICKET'));
  });

  it('竞态守卫：先发后到的旧响应不得覆盖新数据', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');

    let call = 0;
    server.on(WORLD_CMD.cmd, WORLD_CMD.snapshot, () => {
      call += 1;
      // 第一次慢（20ms）、第二次快（0ms）→ 第二次先到；第一次到达时必须被丢弃。
      return call === 1
        ? { data: { success: true, data: { ...SNAPSHOT, map: 'old-map' } }, delayMs: 20 }
        : { data: { success: true, data: { ...SNAPSHOT, map: 'new-map' } } };
    });

    const first = root.world.load();
    const second = root.world.load();
    await Promise.all([first, second]);
    expect(root.world.snapshot?.map).toBe('new-map');
    expect(root.world.loading).toBe(false);
  });

  it('会话恢复：本地有 token 时 bootstrap 直接连 WS 并拉面板', async () => {
    const storage = createMemoryStorage();
    storage.setItem(TOKEN_STORAGE_KEY, 'jwt-restored');
    const { root } = createHarness(storage);
    opened.push(root);

    await root.bootstrap();
    expect(root.session.isAuthenticated).toBe(true);
    expect(root.session.token).toBe('jwt-restored');
    expect(root.session.players).toHaveLength(1);
    expect(root.connection.state).toBe('online');
  });

  it('未登录时 bootstrap 不发任何请求（内存零污染）', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.bootstrap();
    expect(root.session.isAuthenticated).toBe(false);
    expect(server.requests).toHaveLength(0);
  });
});

describe('断线重连：自动重新进入当前角色', () => {
  function selectRequests(server: Harness['server']): number {
    return server.requests.filter(
      (request) => request.cmd === PLAYER_CMD.cmd && request.subCmd === PLAYER_CMD.select,
    ).length;
  }

  async function waitFor(condition: () => boolean, tries = 400): Promise<void> {
    for (let i = 0; i < tries; i += 1) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('waitFor 超时');
  }

  it('已在玩角色时重连 → 自动重新 select（服务端每次握手都重置当前角色）', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');
    // 注意：`player.select` 同时是「刷新角色全量状态」的通道（`player-store.load`），
    // 所以一次 `selectCharacter` 本来就会发两次请求 —— 这里用**相对增量**断言。
    const before = selectRequests(server);
    expect(before).toBeGreaterThan(0);

    root.client.ionet.forceReconnect('test-drop');
    await waitFor(() => selectRequests(server) === before + 1);

    expect(root.session.activePlayerKey).toBe('k1');
    expect(root.player.name).toBe('守夜人');
  });

  it('停在选角页（未选角色）时重连 → 不自动 select（否则选角页会继续收到战斗推送）', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    expect(root.session.hasCharacter).toBe(false);
    expect(selectRequests(server)).toBe(0);

    root.client.ionet.forceReconnect('test-drop');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(selectRequests(server)).toBe(0);
  });
});

describe('进图自动播放剧情（(story, unlock) 推送）', () => {
  /** 等待 `handleNotification` 内部的异步编排（load → open）落定。 */
  async function waitFor(condition: () => boolean, tries = 50): Promise<void> {
    for (let i = 0; i < tries; i += 1) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('waitFor 超时');
  }

  const SCRIPT_STORY: StoryDto = {
    key: 'eyer-stories-1',
    group: '艾尔的故事',
    name: '艾尔的故事 - 序章 - 1',
    status: 'none',
    taskType: 'script',
    canStart: true,
    lockedReason: null,
  };

  function registerStoryRoutes(server: Harness['server'], story: StoryDto): void {
    const ok = (data: unknown): { data: unknown } => ({ data: { success: true, data } });
    server
      .on(STORY_CMD.cmd, STORY_CMD.list, () => ok([story]))
      .on(STORY_CMD.cmd, STORY_CMD.play, () =>
        ok({ key: story.key, name: story.name, nodes: [{ type: 'say', args: ['艾尔', '你好'] }], awards: {} }),
      );
  }

  it('autoPlay=true → 自动打开剧本并切到「故事」面板（服务端不替玩家 finish）', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');
    registerStoryRoutes(server, SCRIPT_STORY);

    server.pushRoute(STORY_CMD.cmd, STORY_CMD.unlock, {
      key: 'eyer-stories-1',
      name: SCRIPT_STORY.name,
      taskType: 'script',
      autoPlay: true,
    });

    await waitFor(() => root.story.play !== null);
    expect(root.ui.activePanelKey).toBe('stories');
    expect(root.story.play?.key).toBe('eyer-stories-1');
    expect(root.story.nodes).toHaveLength(1);
    // 前端只播放，不推导完成：服务端仍是 none/task，由玩家点「结算」触发 finish
    expect(root.story.stories[0]?.status).toBe('none');
  });

  it('autoPlay=false（击杀/购买任务刚登记）→ 只刷新列表，不跳面板、不打开剧本', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');
    registerStoryRoutes(server, { ...SCRIPT_STORY, taskType: 'kill', status: 'task' });

    server.pushRoute(STORY_CMD.cmd, STORY_CMD.unlock, {
      key: 'eyer-stories-3',
      name: '序章 3',
      taskType: 'kill',
      autoPlay: false,
    });

    await waitFor(() => root.story.stories.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.story.play).toBeNull();
    expect(root.ui.activePanelKey).toBeNull();
  });

  it('玩家正在读另一段剧情 → 不打断', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');
    registerStoryRoutes(server, SCRIPT_STORY);
    await root.story.open('eyer-stories-1');
    expect(root.story.play).not.toBeNull();

    server.pushRoute(STORY_CMD.cmd, STORY_CMD.unlock, {
      key: 'eyer-stories-2',
      name: '序章 2',
      taskType: 'script',
      autoPlay: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.story.play?.key).toBe('eyer-stories-1');
  });

  it('已完成的剧情即便 autoPlay=true 也不打开', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');
    registerStoryRoutes(server, { ...SCRIPT_STORY, status: 'done' });

    server.pushRoute(STORY_CMD.cmd, STORY_CMD.unlock, {
      key: 'eyer-stories-1',
      name: SCRIPT_STORY.name,
      taskType: 'script',
      autoPlay: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.story.play).toBeNull();
  });

  it('载荷缺 key / 是非剧本命令时安全忽略', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');
    registerStoryRoutes(server, SCRIPT_STORY);

    server.pushRoute(STORY_CMD.cmd, STORY_CMD.unlock, { autoPlay: true });
    server.pushRoute(STORY_CMD.cmd, STORY_CMD.play, { key: 'eyer-stories-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.story.play).toBeNull();
  });
});

describe('中立（黄名）单位必须可被点选攻击（eyer-stories-4 的前置）', () => {
  it('中立怪进入「可攻击」列表、但不被算作敌方；友军/幽灵不入列', async () => {
    const { root, server } = createHarness();
    opened.push(root);
    await root.login('tester', 'secret123');
    await root.selectCharacter('k1');

    server.pushRoute(WORLD_CMD.cmd, WORLD_CMD.tick, {
      serverTime: 1_700_000_000_100,
      units: [
        makeUnit({ id: 'p1', camp: 'player', kind: 'player', name: '守夜人', hp: 100, maxHp: 100 }),
        makeUnit({ id: 'e1' }),
        // 大史莱姆：中立（不会主动攻击，也不会被溅射打到）
        makeUnit({ id: 'n1', camp: 'neutral', name: '大史莱姆', typeKey: 'slime.giant', level: 12 }),
        makeUnit({ id: 'g1', camp: 'ghost', name: '尸体' }),
      ],
      events: [],
      gainedExp: 0,
      gainedGold: 0,
    });

    expect(root.world.enemies.map((unit) => unit.id)).toEqual(['e1']);
    expect(root.world.neutrals.map((unit) => unit.id)).toEqual(['n1']);
    expect(root.world.attackables.map((unit) => unit.id)).toEqual(['e1', 'n1']);
    expect(root.world.attackables.some((unit) => unit.id === 'g1')).toBe(false);
  });
});
