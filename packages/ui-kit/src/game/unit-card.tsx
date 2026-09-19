/**
 * UnitCard —— 战斗单位卡（名字 + 等级 + 品质 + 血条 + 施法条 + Buff 图标行）。
 *
 * 数据来自 `UnitStateDto`（**type-only** import）：服务端权威快照，前端只渲染，
 * 不做任何数值推导（`hp/maxHp`、`castingProgress` 均为服务端算好的值）。
 *
 * 颜色纪律：全体走 antd token；品质色复用 `RarityTag`。
 * 边界：`buffs` 缺省/超长安全；`castingProgress` 为 `null` 时不渲染施法条；
 *       `hp` 超过 `maxHp` 时血条夹取到 100%（数值文案仍显示真实值）。
 */
import { Avatar, Flex, Tooltip, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import type { UnitStateDto } from '@idle-dark/protocol';
import { formatDuration } from '../format/duration.js';
import { RarityTag } from './rarity-tag.js';
import { ResourceBar } from './resource-bar.js';

export interface UnitCardProps {
  unit: UnitStateDto;
  /** 选中（当前操作目标）。 */
  selected?: boolean;
  /** 被当前单位锁定为目标（描边高亮）。 */
  targeted?: boolean;
  /** 已阵亡（灰度 + 划名）。 */
  dead?: boolean;
  /** 是否显示法力条，缺省 true（`maxMp === 0` 时不渲染）。 */
  showMana?: boolean;
  /** 最多显示几个 Buff，缺省 6。 */
  maxBuffs?: number;
  /** 单击。 */
  onClick?: (unit: UnitStateDto) => void;
  /** 右上角附加区。 */
  extra?: ReactNode;
}

export function UnitCard(props: UnitCardProps) {
  const { unit, selected = false, targeted = false, dead = false, showMana = true, maxBuffs = 6, onClick, extra } = props;
  const { token } = theme.useToken();

  const buffs = unit.buffs.slice(0, Math.max(0, maxBuffs));
  const hiddenBuffs = unit.buffs.length - buffs.length;
  const casting = unit.castingProgress;
  const interactive = !dead && onClick !== undefined;

  const borderColor = selected
    ? token.colorPrimary
    : targeted
      ? token.colorError
      : token.colorBorderSecondary;

  return (
    <Flex
      vertical
      gap={token.marginXXS}
      data-testid="unit-card"
      data-unit-id={unit.id}
      data-camp={unit.camp}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onClick(unit) : undefined}
      style={{
        padding: token.paddingXS,
        border: `1px solid ${borderColor}`,
        borderRadius: token.borderRadiusSM,
        background: token.colorBgContainer,
        opacity: dead ? 0.5 : 1,
        cursor: interactive ? 'pointer' : 'default',
        minWidth: 180,
      }}
    >
      <Flex justify="space-between" align="center" gap={token.marginXXS}>
        <Flex align="center" gap={token.marginXXS} style={{ minWidth: 0 }}>
          <Typography.Text strong ellipsis delete={dead} data-testid="unit-card-name">
            {unit.name}
          </Typography.Text>
          <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
            {`Lv.${unit.level}`}
          </Typography.Text>
          <RarityTag quality={unit.quality} />
        </Flex>
        {extra}
      </Flex>

      <ResourceBar kind="hp" current={unit.hp} max={unit.maxHp} />
      {showMana && unit.maxMp > 0 ? <ResourceBar kind="mp" current={unit.mp} max={unit.maxMp} /> : null}
      {unit.maxRp > 0 ? <ResourceBar kind="rp" current={unit.rp} max={unit.maxRp} /> : null}

      {casting === null ? null : (
        <ResourceBar
          kind="ep"
          label="施法"
          current={casting}
          max={1}
          showValues={false}
          height={4}
          width={140}
        />
      )}

      {buffs.length === 0 ? null : (
        <Flex align="center" gap={token.marginXXS} wrap data-testid="unit-card-buffs">
          {buffs.map((buff) => (
            <Tooltip key={buff.key} title={`${buff.name} ×${buff.stack}（${formatDuration(buff.remainMs)}）`}>
              <Avatar
                size={20}
                shape="square"
                style={{
                  background: token.colorFillSecondary,
                  color: token.colorText,
                  fontSize: token.fontSizeSM,
                }}
              >
                {buff.name.slice(0, 1)}
              </Avatar>
            </Tooltip>
          ))}
          {hiddenBuffs > 0 ? (
            <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
              {`+${hiddenBuffs}`}
            </Typography.Text>
          ) : null}
        </Flex>
      )}
    </Flex>
  );
}
