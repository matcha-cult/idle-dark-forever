/**
 * LogPanel —— 战斗/系统日志面板。
 *
 * ## 顺序契约（**新在最前**，别搞反）
 *
 * `entries` 按**倒序**给出：`entries[0]` 是最新一条（`world-store.appendEvents` 用
 * 「新条目插到队首」实现）。因此本组件：
 * - 只渲染**头部** `maxItems` 条（`slice(0, maxItems)`）—— 截断必须丢**最旧**的；
 * - 自动滚动时把 `scrollTop` 打到 **0**（顶部）—— 最新一条在顶部，滚到底反而会
 *   把视口钉在最旧的内容上（这正是此前的缺陷：日志倒序 + 滚底 = 永远看不到新条目）。
 *
 * 虚拟滚动按需求简化为「截断 + 自动滚到最新」。理由：战斗日志是「扫一眼最新」场景，
 * 用户几乎不回溯；真虚拟滚动会引入高度测量与主题耦合，收益不成比例。
 *
 * 边界：`entries=[]` 显示空态；`autoScroll=false` 时不抢用户的滚动位置；
 * 效果在 SSR 下不执行（`useEffect`），因此渲染测试只断言 DOM 结构。
 *
 * 颜色纪律：等级色取 antd token（伤害=error、治疗=success、拾取=gold…），零内联 hex。
 */
import { Flex, Typography, theme } from 'antd';
import { useEffect, useRef, type ReactNode } from 'react';

export type LogLevel = 'info' | 'damage' | 'heal' | 'loot' | 'warning' | 'system';

export interface LogEntry {
  /** 稳定 key（服务端事件序号 / 自增）。 */
  id: string;
  text: ReactNode;
  level?: LogLevel;
  /** 展示用时间戳文案（已格式化，组件不做时间计算）。 */
  time?: ReactNode;
}

export interface LogPanelProps {
  entries: readonly LogEntry[];
  /** 最多渲染多少条（取**头部** = 最新的若干条），缺省 200。 */
  maxItems?: number;
  /** 容器高度（px），缺省 240。 */
  height?: number;
  /** 是否自动滚到最新一条（**顶部**），缺省 true。 */
  autoScroll?: boolean;
  /** 空日志文案，缺省「暂无日志」。 */
  emptyText?: ReactNode;
  title?: ReactNode;
}

export function LogPanel(props: LogPanelProps) {
  const { entries, maxItems = 200, height = 240, autoScroll = true, emptyText = '暂无日志', title } = props;
  const { token } = theme.useToken();
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoScroll) return;
    const box = boxRef.current;
    if (box === null) return;
    // 新条目在**顶部** ⇒ 视口必须回到顶部，否则会钉在最旧的内容上。
    box.scrollTop = 0;
  }, [entries, autoScroll]);

  const levelColors: Record<LogLevel, string> = {
    info: token.colorTextSecondary,
    damage: token.colorError,
    heal: token.colorSuccess,
    loot: token.gold,
    warning: token.colorWarning,
    system: token.colorTextTertiary,
  };

  // 截断丢**最旧**的（尾部），保留最新 maxItems 条。
  const visible = entries.length > maxItems ? entries.slice(0, maxItems) : entries;

  return (
    <Flex vertical gap={token.marginXXS} data-testid="log-panel">
      {title}
      <div
        ref={boxRef}
        data-testid="log-panel-body"
        style={{
          height,
          overflowY: 'auto',
          padding: token.paddingXS,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusSM,
          background: token.colorFillQuaternary,
        }}
      >
        {visible.length === 0 ? (
          <Typography.Text style={{ color: token.colorTextTertiary }}>{emptyText}</Typography.Text>
        ) : (
          <Flex vertical gap={0}>
            {visible.map((entry) => (
              <Flex key={entry.id} gap={token.marginXS} align="baseline" data-testid={`log-${entry.id}`}>
                {entry.time === undefined ? null : (
                  <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextQuaternary }}>
                    {entry.time}
                  </Typography.Text>
                )}
                <Typography.Text
                  style={{
                    fontSize: token.fontSizeSM,
                    color: levelColors[entry.level ?? 'info'],
                    wordBreak: 'break-word',
                  }}
                >
                  {entry.text}
                </Typography.Text>
              </Flex>
            ))}
          </Flex>
        )}
      </div>
    </Flex>
  );
}
