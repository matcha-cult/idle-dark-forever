/**
 * ErrorBoundary —— 渲染期异常的兜底容器（本包唯一的类组件）。
 *
 * 为什么必须有：React 18 里 render / 生命周期抛出的未捕获异常会让 React **卸载整棵树**，
 * 屏幕只剩白，且用户拿不到任何错误文字。包一层 boundary 后，白屏变成一张可读、可复制的
 * 错误卡片——它**不是修复**，而是把「不可诊断」变成「可诊断」。
 *
 * 约定：
 * - 只依赖 `antd` + `react`，不 import 任何业务包；
 * - 颜色只走 antd token / 语义色，禁内联 hex；
 * - `onError` 是**唯一对外出口**（打点 / 上报），本组件不自己上报；
 * - 不用静态 `Modal.confirm`；重试按钮受控（`onReset` 由调用方决定如何复位）。
 *
 * 边界：子节点正常时**不产生任何额外 DOM 包裹**（不破坏父级布局与查询）；
 *      `componentStack` 为空（非渲染期抛错）时只显示 message。
 */
import { Button, Flex, Result, Typography } from 'antd';
import { Component, Fragment } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 卡片标题，缺省「此区域渲染出错」。 */
  title?: ReactNode;
  /** 出错回调（打点 / 上报 / 追加 console.error）。 */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** 是否展示 React 组件栈，缺省 true。 */
  showStack?: boolean;
  /** 自定义兜底渲染；返回 `null` 表示仍用默认卡片。 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 「重新加载页面」按钮，缺省显示。 */
  reloadText?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** React 的组件栈（`ErrorInfo.componentStack`），与 `error.stack` 不是一回事。 */
  componentStack: string | null;
  /** 用于强制重挂子树的 key。 */
  attempt: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, componentStack: null, attempt: 0 };

  /** render 期抛错 → React 用返回值合并进 state（必须与 `error` 同名）。 */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 组件栈只在提交阶段拿得到（getDerivedStateFromError 是纯函数，拿不到 ErrorInfo）
    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    this.setState((prev) => ({ error: null, componentStack: null, attempt: prev.attempt + 1 }));
  };

  override render(): ReactNode {
    const { children, title = '此区域渲染出错', showStack = true, fallback, reloadText = '重新加载页面' } = this.props;
    const { error, componentStack, attempt } = this.state;
    if (error === null) return <Fragment key={attempt}>{children}</Fragment>;

    const custom = fallback?.(error, this.reset);
    if (custom !== undefined && custom !== null) return custom;

    return (
      <Result
        status="error"
        data-testid="error-boundary"
        title={title}
        subTitle={`${error.name}: ${error.message}`}
        extra={
          <Flex vertical gap={8} style={{ textAlign: 'left' }}>
            {showStack && componentStack !== null ? (
              <Typography.Paragraph
                data-testid="error-boundary-stack"
                style={{ whiteSpace: 'pre-wrap', marginBottom: 0, fontSize: 12 }}
              >
                {componentStack}
              </Typography.Paragraph>
            ) : null}
            <Flex gap={8}>
              <Button type="primary" danger onClick={this.reset} data-testid="error-boundary-reset">
                重试
              </Button>
              <Button
                data-testid="error-boundary-reload"
                onClick={() => {
                  if (typeof window !== 'undefined') window.location.reload();
                }}
              >
                {reloadText}
              </Button>
            </Flex>
          </Flex>
        }
      />
    );
  }
}
