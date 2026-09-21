/**
 * AttributesPanel —— 角色属性（**独立成一域**，原版「战斗」页里玩家那张属性表）。
 *
 * 为什么单独开一个域而不是塞进「战斗」：属性是「我是谁 / 我有多强」，回答的是
 * **养成**问题；战斗页回答的是「在哪打、打成什么样」。两者放在一张卡片流里时，
 * 玩家每次看战斗日志都要先滚过 34 行属性。原版把它做成战斗页里的一个 Tab（单位 /
 * 玩家 / 地图），本仓没有 Tab，落在侧栏「征伐 · 角色属性」是等价映射。
 *
 * 数据源是**玩家单位**（`world.playerUnit`，即服务端 `UnitStateDto`），因此
 * 属性会随 Buff / 升级 / 换装实时变化；显示全在 `PlayerAttributesPanel` 里做，
 * 本组件只负责取单位与空态。
 *
 * ⚠️ 没有活跃世界会话时（未选角、或点了「离开地图」）`world.playerUnit` 是
 * `undefined` —— 属性是由**战斗世界**里的玩家单位计算的（Buff 会改属性，
 * 挂在没有单位的 `Player` 上就丢了这一层），所以此时只能显示空态。
 */
import { observer } from 'mobx-react-lite';
import { Flex, theme } from 'antd';
import { EmptyState, PlayerAttributesPanel, SectionCard } from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';

export const AttributesPanel = observer(function AttributesPanel() {
  const root = useRootStore();
  const { token } = theme.useToken();
  const unit = root.world.playerUnit;

  return (
    <Flex vertical gap={token.paddingSM} data-testid="attributes-panel">
      <SectionCard
        title="角色属性"
        description="数值全部来自服务端（已换算 / 已取整），随 Buff、升级、换装实时更新。"
      >
        {unit === undefined ? (
          <EmptyState
            description="暂无角色属性"
            hint="属性由战斗世界里的玩家单位算出 —— 选择角色（会自动进入）后即可看到"
          />
        ) : (
          <PlayerAttributesPanel unit={unit} />
        )}
      </SectionCard>
    </Flex>
  );
});
