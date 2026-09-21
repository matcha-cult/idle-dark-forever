/**
 * BattlePanel —— 战斗（原版 Tab「战斗」）。
 *
 * 玩家在这里回答三个问题：
 *   1. 我在哪、还能去哪？→ 地图列表（服务端 `MapDto`）
 *   2. 现在打成什么样？→ 单位卡列表（`UnitStateDto`，服务端权威快照）+ 战斗日志（事件流）
 *   3. 打不动怎么办？→ 目标切换 / 离开地图 / 放弃离线收益
 *
 * 纪律：本面板**不做任何数值推导**。血条、施法进度、Buff 剩余时间、倍速全部直接渲染
 * 服务端下发的值；日志只把 `BattleEventDto` 格式化成文案。
 */
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { App as AntApp, Button, Flex, Space, Switch, Tag, Typography, theme } from 'antd';
import type { BattleEventDto, MapDto, UnitStateDto } from '@idle-dark/protocol';
import {
  ActionBar,
  EmptyState,
  LogPanel,
  SectionCard,
  UnitCard,
  formatAmount,
  type LogEntry,
  type LogSegment,
} from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';
import { isAttackableCamp, isDead } from '../../../stores/world-store.js';

/**
 * 伤害类型的中文名（**照抄原版** `dark-forever-memorize/src/logics/renderMessage.js`
 * 的 `DAMAGE_TYPES`，并按本仓 `rules/damage.ts` 的类型表补齐原版后加的四系）。
 */
const DAMAGE_TYPE_NAMES: Record<string, string> = {
  melee: '物理',
  magic: '魔法',
  fire: '火焰',
  cold: '寒冷',
  lightning: '闪电',
  chaos: '混沌',
  holy: '神圣',
  real: '真实',
  water: '水',
  poison: '毒素',
};

/**
 * 日志里的数值文案：**一律取整**，与原版 `renderMessage.js` 的 `Math.round(value)` 一致。
 *
 * ⚠️ 取整在**展示层**，不在引擎：原版的伤害与 HP 全程浮点，只有渲染才 `Math.round`。
 * 在结算处取整会改平衡（`0.4 → 0` 让弱怪打高防玩家彻底无效；保底 1 又抬高 <1 伤害），
 * 因此保持「引擎浮点 + 展示取整」这条原版路线。
 * 非有限值回落 0（原版会直接渲染出 `NaN`；这是纯防御，正常路径不会走到）。
 */
export function formatLogValue(value: unknown): string {
  const numeric = Number(value);
  return String(Number.isFinite(numeric) ? Math.round(numeric) : 0);
}

/** 技能展示名：优先服务端下发的中文名，缺失才回落数据表键（缺失可见）。 */
const skillLabelOf = (event: { skill: string; skillName?: string }): string =>
  typeof event.skillName === 'string' && event.skillName !== '' ? event.skillName : event.skill;

/**
 * 战斗事件 → 日志条目（纯展示映射，不改变任何数值）。
 *
 * 文案**逐句对齐原版** `renderMessage.js`（`battle.damage` / `battle.heal` /
 * `battle.dodge` / `battle.death` / `battle.buff(Off)` / `player.got.exp` /
 * `map.enter` / `enemy.appear` / `player.death`），不要自行改写语序。
 *
 * 着色同样对齐原版 `renderMessage.less`：**正文不着色**，只有
 * ① 伤害数字（玩家打出=红 `player`、其它=蓝 `other`）、
 * ② 治疗数字（绿 `heal`）、
 * ③ 复活秒数（`accent`）、
 * ④ 暴击前缀加粗。
 *
 * `lookup` 必须能查到**历史单位**（`world.nameOf` / `world.campOf`）——日志是历史，
 * 单位表是当下，用当下查历史必然有名字/阵营缺失。
 */
export interface UnitLookup {
  nameOf(id: string): string;
  /** 阵营；查不到返回 `''`（按「非玩家」处理）。 */
  campOf(id: string): string;
}

/** 组装一条日志：`text` 由 `segments` 拼出，保证两者永不漂移。 */
function compose(segments: LogSegment[]): { segments: LogSegment[]; text: string } {
  return { segments, text: segments.map((segment) => segment.text).join('') };
}

export function formatBattleEvent(
  event: BattleEventDto,
  lookup: UnitLookup,
): { segments: LogSegment[]; text: string } {
  const nameOf = (id: string): string => lookup.nameOf(id);
  switch (event.kind) {
    case 'damage': {
      const target = nameOf(event.toId);
      const amount = formatLogValue(event.value);
      const type = DAMAGE_TYPE_NAMES[event.damageType] ?? event.damageType;
      const crit = event.crit ? '暴击！' : '';
      const absorbed = event.absorbed > 0 ? `(${formatLogValue(event.absorbed)}点已吸收)` : '';
      // 原版按 `!from` 分两支：无来源（环境/持续伤害）不点名攻击者。
      // 服务端在 `!skill` 时不发事件，所以 `fromId !== ''` 一支必然有技能。
      // 原版按 `from.camp === 'player'` 决定伤害数字的红/蓝（不是「谁受伤」）。
      const tone: LogSegment['tone'] = lookup.campOf(event.fromId) === 'player' ? 'player' : 'other';
      const head =
        event.fromId === ''
          ? `${target}受到了`
          : `${nameOf(event.fromId)}的${skillLabelOf(event)}对${target}造成了`;
      const segments: LogSegment[] = [];
      if (crit !== '') segments.push({ text: crit, bold: true });
      segments.push({ text: head });
      segments.push({ text: amount, tone });
      segments.push({ text: `点${type}伤害。${absorbed}` });
      return compose(segments);
    }
    case 'heal':
      return compose([
        { text: `${nameOf(event.fromId)}的${skillLabelOf(event)}为${nameOf(event.toId)}回复了` },
        { text: formatLogValue(event.value), tone: 'heal' },
        { text: '点生命。' },
      ]);
    case 'dodge': {
      const from = nameOf(event.fromId);
      const to = nameOf(event.toId);
      // 原版：无技能时退化成「造成的伤害被躲闪了」。
      if (event.skill === '' && (event.skillName === undefined || event.skillName === '')) {
        return compose([{ text: `${from}造成的伤害被${to}躲闪了。` }]);
      }
      return compose([{ text: `${from}的${skillLabelOf(event)}被${to}躲闪了。` }]);
    }
    case 'death':
      return compose([{ text: `${event.name}死亡了。` }]);
    case 'buff':
      return compose([
        {
          text: event.on
            ? `${nameOf(event.unitId)}受到了${event.name}效果的影响。`
            : `${nameOf(event.unitId)}的${event.name}效果消失了。`,
        },
      ]);
    case 'exp':
      return compose([
        { text: `${event.whoId === undefined ? '你' : nameOf(event.whoId)}获得了` },
        { text: formatLogValue(event.amount), tone: 'accent' },
        { text: '点经验。' },
      ]);
    default:
      return compose(formatGeneralSegments(event.text));
  }
}

/**
 * `general` 事件文案化。
 *
 * 内核用 `general` 承载「没有专门契约事件」的提示（见 `battle-world.ts` 的出站路径），
 * 文案是 `key:参数...` 形式。**这里只做展示映射**，未知前缀原样透出（不吞、不猜），
 * 以免新前缀静默消失。已知前缀的文案同样对齐原版 `renderMessage.js`。
 */
export function formatGeneralSegments(text: string): LogSegment[] {
  if (typeof text !== 'string' || text === '') return [];
  const parts = text.split(':');
  if (parts[0] === 'player.death') {
    const name = parts[1] ?? '';
    const seconds = parts[2];
    if (seconds !== undefined && seconds !== '') {
      return [
        { text: `${name === '' ? '你' : name}陷入了昏迷，将在` },
        { text: formatLogValue(seconds), tone: 'accent' },
        { text: '秒后恢复。' },
      ];
    }
  }
  return [{ text: formatGeneralText(text) }];
}

export function formatGeneralText(text: string): string {
  if (typeof text !== 'string' || text === '') return '';
  const parts = text.split(':');
  switch (parts[0]) {
    case 'map.enter': {
      // 形如 `map.enter:<mapKey>:<地图名>`；地图名可能自身含冒号，取剩余部分。
      const name = parts.slice(2).join(':');
      return name === '' ? '来到了新的地图。' : `来到了${name}。`;
    }
    case 'enemy.appear': {
      const name = parts[1];
      return name === undefined || name === '' ? '遭遇了敌人。' : `遭遇了一只${name}。`;
    }
    case 'player.death': {
      // 形如 `player.death:<角色名>:<复活秒数>`
      const name = parts[1] ?? '';
      const seconds = parts[2];
      const suffix = seconds === undefined || seconds === '' ? '' : `，将在${formatLogValue(seconds)}秒后恢复`;
      return `${name === '' ? '你' : name}陷入了昏迷${suffix}。`;
    }
    case 'world.unitCap':
      // 原版没有对应文案（本仓 I2 硬顶新增），保留明确提示而非静默。
      return '场上单位已达上限，未能召唤更多敌人';
    default:
      return text;
  }
}

function mapLockedReason(map: MapDto): string | null {
  if (map.lockedReason !== null && map.lockedReason.length > 0) return map.lockedReason;
  return null;
}

export const BattlePanel = observer(function BattlePanel() {
  const root = useRootStore();
  const { world } = root;
  const { modal } = AntApp.useApp();
  const { token } = theme.useToken();
  const [busyMap, setBusyMap] = useState<string | null>(null);
  /** 默认只显示可进入的地图；47 张图全平铺会让玩家找不到能进的那张。 */
  const [showLocked, setShowLocked] = useState(false);

  const unlockedMaps = world.maps.filter((map) => mapLockedReason(map) === null);
  const visibleMaps = showLocked ? world.maps : unlockedMaps;
  const unlockedCount = unlockedMaps.length;

  const entries: LogEntry[] = world.log.map((entry) => {
    const formatted = formatBattleEvent(entry.event, {
      nameOf: (id) => world.nameOf(id),
      campOf: (id) => world.campOf(id),
    });
    return { id: String(entry.seq), text: formatted.text, segments: formatted.segments };
  });

  const enter = async (map: MapDto): Promise<void> => {
    setBusyMap(map.key);
    try {
      await world.enterMap(map.key);
    } finally {
      setBusyMap(null);
    }
  };

  const focus = (unit: UnitStateDto): void => {
    // 敌方与**中立**（黄名）都可以指定：原版 `CampRelation.player.neutral === true`，
    // 不主动攻击但可以主动打，打了它才会参战。幽灵/剧情/神龛等一律忽略。
    if (!isAttackableCamp(unit.camp)) return;
    // 只发「把该单位设为目标」的意图；具体由哪个我方单位攻击由服务端决定。
    void world.focus(unit.id);
  };

  const leave = (): void => {
    modal.confirm({
      title: '离开当前地图？',
      content: '离开后当前地图的战斗会话会关闭。',
      okText: '离开',
      cancelText: '取消',
      onOk: () => world.leave(),
    });
  };

  const skipOffline = (): void => {
    modal.confirm({
      title: '放弃离线收益？',
      content: '被跳过的这段时间不会补发金币、经验与掉落，且不可恢复。',
      okText: '确认放弃',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => world.skipOffline(),
    });
  };

  return (
    <Flex vertical gap={token.paddingSM} data-testid="battle-panel">
      <SectionCard
        title="地图"
        extra={
          <Space>
            {/* W4：波次进度（服务端权威下发）。BOSS 波时明确提示「守关 BOSS 现身」。 */}
            <Typography.Text type="secondary" data-testid="battle-wave">
              {`波次 ${world.wave}`}
            </Typography.Text>
            <Typography.Text
              type="secondary"
              data-testid="battle-boss"
              style={world.bossWave ? { color: token.colorWarning } : undefined}
            >
              {world.bossWave ? '守关 BOSS 现身' : `距守关 BOSS ${world.wavesToBoss} 波`}
            </Typography.Text>
            <Typography.Text type="secondary">
              {world.updateRate > 1 ? `模拟倍速 ×${world.updateRate.toFixed(1)}` : '实时模拟'}
            </Typography.Text>
            <Button onClick={leave} disabled={world.currentMap === ''} data-testid="battle-leave">
              离开地图
            </Button>
          </Space>
        }
      >
        <Flex vertical gap={token.paddingXS}>
          {world.maps.length === 0 ? (
            <EmptyState description="暂无可进入的地图" hint="世界数据会在收到 `(world, snapshot)` 后出现" />
          ) : (
            <>
              {/*
                数据表里有 47 张地图，前期绝大多数是锁定的。早期把它们全部平铺，
                玩家很难在 45 张「尚未满足进入条件」的卡片里找到那唯一一张能进的
                —— 这是实际被反馈过的「地图无法解锁」体验问题。
                默认只显示可进入的，需要时再展开全部（服务端已把可进入的排在前面）。
              */}
              <Flex justify="space-between" align="center" gap={token.paddingXS} wrap>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {`可进入 ${unlockedCount} / ${world.maps.length} 张`}
                  {unlockedCount === 0 ? ' —— 提升等级可解锁新地图' : ''}
                </Typography.Text>
                <Space>
                  <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    显示未解锁
                  </Typography.Text>
                  <Switch
                    checked={showLocked}
                    onChange={setShowLocked}
                    data-testid="battle-show-locked"
                  />
                </Space>
              </Flex>
              <Flex wrap gap={token.paddingXS}>
                {visibleMaps.map((map) => {
                  const reason = mapLockedReason(map);
                  const locked = reason !== null;
                  return (
                    <Flex
                      key={map.key}
                    vertical
                    gap={2}
                    style={{
                      minWidth: 200,
                      padding: token.paddingXS,
                      border: `1px solid ${map.key === world.currentMap ? token.colorPrimary : token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusSM,
                      background: map.key === world.currentMap ? token.colorPrimaryBg : token.colorBgContainer,
                    }}
                    data-testid={`map-${map.key}`}
                  >
                    <Flex justify="space-between" align="center" gap={token.marginXXS}>
                      <Typography.Text strong>{map.name}</Typography.Text>
                      <Tag>野外</Tag>
                    </Flex>
                    <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                      {`Lv.${map.level}`}
                    </Typography.Text>
                    {map.hint === undefined ? null : (
                      <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}>
                        {map.hint}
                      </Typography.Text>
                    )}
                    <Button
                      type={map.key === world.currentMap ? 'default' : 'primary'}
                      disabled={locked || busyMap === map.key}
                      loading={busyMap === map.key}
                      onClick={() => void enter(map)}
                      data-testid={`map-enter-${map.key}`}
                    >
                      {locked ? reason : map.key === world.currentMap ? '重新进入' : '进入'}
                    </Button>
                  </Flex>
                );
              })}
              </Flex>
            </>
          )}
        </Flex>
      </SectionCard>

      <SectionCard
        title="战场单位"
        extra={
          <Typography.Text type="secondary">
            {world.neutrals.length > 0
              ? `我方 ${world.allies.length} · 敌方 ${world.enemies.length} · 中立 ${world.neutrals.length}`
              : `我方 ${world.allies.length} · 敌方 ${world.enemies.length}`}
          </Typography.Text>
        }
      >
        {world.units.length === 0 ? (
          <EmptyState description="当前没有单位" hint="进入地图后服务端会以 tick 推送单位快照" />
        ) : (
          <Flex vertical gap={token.paddingXS}>
            <Flex wrap gap={token.paddingXS} data-testid="battle-allies">
              {world.allies.map((unit) => (
                <UnitCard key={unit.id} unit={unit} dead={isDead(unit)} />
              ))}
            </Flex>
            <Flex wrap gap={token.paddingXS} data-testid="battle-enemies">
              {world.attackables.map((unit) => (
                <UnitCard
                  key={unit.id}
                  unit={unit}
                  dead={isDead(unit)}
                  onClick={focus}
                  extra={
                    <Flex gap={4}>
                      {/* 黄名中立怪：不主动攻击、也不会被溅射打到，必须玩家手动点它才会开战
                          （原版「单位」面板语义）。 */}
                      {unit.camp === 'neutral' ? <Tag color="gold">中立</Tag> : null}
                      {/* W4：守关 BOSS（服务端 `UnitStateDto.boss` 显式标记）。 */}
                      {unit.boss ? <Tag color="volcano">守关 BOSS</Tag> : null}
                      {world.allies.some((ally) => ally.targetId === unit.id) ? (
                        <Tag color="red">被锁定</Tag>
                      ) : null}
                    </Flex>
                  }
                />
              ))}
            </Flex>
            <ActionBar
              actions={[
                {
                  key: 'focus-clear',
                  label: '取消集火',
                  tooltip: '让所有我方单位清除当前目标',
                  onClick: () => void world.focus(null),
                },
                { key: 'skip-offline', label: '放弃离线收益', danger: true, onClick: skipOffline },
              ]}
            />
          </Flex>
        )}
      </SectionCard>

      <SectionCard
        title="战斗日志"
        extra={
          <Button onClick={() => world.clearLog()} data-testid="battle-log-clear">
            清空本地日志
          </Button>
        }
      >
        <LogPanel entries={entries} height={260} emptyText="暂无战斗事件" />
      </SectionCard>
    </Flex>
  );
});
