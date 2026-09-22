/**
 * WalletPanel —— 钱包（**独立导航域**，R1 的展示面）。
 *
 * 背景：通货 / 精华 / 一般等价物已由服务端移入 `Player.wallet`（`GoodData.wallet === true`），
 * **不占背包格**、无容量上限、永不 `handled:'lost'`（`AGENTS.md` §19）。服务端早在
 * `PlayerStateDto.wallet` 下发（`player-dto.ts#walletDtoOf`），但前端一直没有入口 ——
 * 本面板就是那个入口。
 *
 * 纪律：
 * - 数值与文案**全部**读服务端字段（`name` / `count` / `key`），前端零推导；
 * - 服务端已过滤数量 > 0、已按 `goodOrder` 排序，前端**不排序**，只按 key 命名空间分三段展示；
 * - 不写回、不本地增删（钱包唯一写者是服务端）。
 *
 * 刷新：钱包没有自己的推送通道（不像 `inventory` 有 `(inventory, changed)`），
 * 而 `gainedGold` 之类的 tick 增量按纪律**不写回** `PlayerStateDto`。因此进入本域时
 * 主动 `player.load()` 拉一次全量角色态（服务端权威、幂等），保证打开就是最新。
 */
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { Flex, Typography, theme } from 'antd';
import { EmptyState, SectionCard, StatList, formatAmount } from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';
import {
  WALLET_GROUP_LABELS,
  WALLET_GROUP_ORDER,
  groupWalletEntries,
} from './wallet-groups.js';

export const WalletPanel = observer(function WalletPanel() {
  const root = useRootStore();
  const { player } = root;
  const { token } = theme.useToken();

  useEffect(() => {
    // 进入钱包域即刷新一次（服务端权威）；`load()` 对同一角色是幂等的。
    void player.load();
  }, [player]);

  const wallet = player.wallet;
  const groups = groupWalletEntries(wallet);

  return (
    <Flex vertical gap={token.paddingSM} data-testid="wallet-panel">
      <SectionCard
        title="钱包"
        description="通货与精华不占背包格、无容量上限，掉落必达、永不丢失。"
        loading={player.loading}
      >
        {wallet.length === 0 ? (
          <EmptyState
            description="钱包还是空的"
            hint="击杀怪物或通关地图会掉落通货与精华，它们会直接进入钱包"
          />
        ) : (
          <Flex vertical gap={token.paddingSM} data-testid="wallet-groups">
            {WALLET_GROUP_ORDER.map((groupKey) => {
              const entries = groups[groupKey];
              if (entries.length === 0) return null;
              return (
                <Flex
                  key={groupKey}
                  vertical
                  gap={token.marginXXS}
                  data-testid={`wallet-group-${groupKey}`}
                >
                  <Typography.Text strong>{WALLET_GROUP_LABELS[groupKey]}</Typography.Text>
                  <StatList
                    items={entries.map((entry) => ({
                      key: entry.key,
                      label: entry.name,
                      value: formatAmount(entry.count),
                      hint: entry.key,
                    }))}
                  />
                </Flex>
              );
            })}
          </Flex>
        )}
      </SectionCard>
    </Flex>
  );
});
