/**
 * LogPanel —— 战斗/系统日志面板。
 *
 * 虚拟滚动按需求**简化为截断 + 自动滚底**：只渲染最后 `maxItems` 条，
 * 提交后把容器 `scrollTop` 打到 `scrollHeight`。理由：战斗日志是「追尾阅读」场景，
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
  /** 最多渲染多少条（取尾部），缺省 200。 */
  maxItems?: number;
  /** 容器高度（px），缺省 240。 */
  height?: number;
  /** 是否自动滚到底部，缺省 true。 */
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
    box.scrollTop = box.scrollHeight;
  }, [entries, autoScroll]);

  const levelColors: Record<LogLevel, string> = {
    info: token.colorTextSecondary,
    damage: token.colorError,
    heal: token.colorSuccess,
    loot: token.gold,
    warning: token.colorWarning,
    system: token.colorTextTertiary,
  };

  const visible = entries.length > maxItems ? entries.slice(entries.length - maxItems) : entries;

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
