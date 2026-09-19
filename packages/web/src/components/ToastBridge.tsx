/**
 * ToastBridge —— 容器层：把 `ToastStore` 的队列交给 antd `message` 展示。
 *
 * 为什么必须走 `App.useApp()`：antd 的静态 `message.*` / `Modal.confirm` 会脱离
 * `ConfigProvider` 上下文，主题与 locale 失效（工程硬约束）。
 *
 * 单向数据流：Store 判定（业务失败 / 传输异常分支）→ 排队 → 本组件 `consume()` 后交给 antd。
 * 渲染 `null`，不产出 DOM。
 */
import { App } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useRootStore } from '../app/root-context.js';

export const ToastBridge = observer(function ToastBridge() {
  const { toast } = useRootStore();
  const { message } = App.useApp();
  const pendingCount = toast.toasts.length;

  useEffect(() => {
    if (pendingCount === 0) return;
    for (const item of toast.consume()) {
      const text = item.message === undefined ? item.title : `${item.title}（${item.message}）`;
      if (item.level === 'error') void message.error(text);
      else if (item.level === 'success') void message.success(text);
      else void message.info(text);
    }
  }, [toast, pendingCount, message]);

  return null;
});
