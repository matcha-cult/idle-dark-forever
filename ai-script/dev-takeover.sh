#!/usr/bin/env bash
# 托管启动器：等用户停掉他自己的 3100/5273 后，自动以本会话的后台任务启动 `pnpm dev`。
#
# 为什么不能直接起：`dev.config.json` 的 strictPort 让 Vite 端口被占时直接失败；
# 而且用户那两个进程在别的 PID namespace（AGENTS §7.8），本会话够不到、也杀不掉。
#
# 为什么不能自己先起一套到备用端口：`pnpm dev:server` 里的 `tsc -p --watch` 会写
# `packages/server/dist`，两个 watcher 抢写会让 `node --watch` 连续重启（AGENTS §15.1）。
set -u

REPO=/home/nbb/projects/idle-dark-forever
PORTS="3100 5273"
TIMEOUT_S=1800      # 30 分钟
SETTLE=2            # 需要连续 N 次都空闲才算稳定（躲开"正在重启"的假空闲）

port_free() {
  node -e "const n=require('net');const s=n.createServer();
s.on('error',()=>process.exit(1));
s.listen($1,'127.0.0.1',()=>{s.close();process.exit(0)})" 2>/dev/null
}

all_free() {
  for p in $PORTS; do port_free "$p" || return 1; done
  return 0
}

deadline=$(( $(date +%s) + TIMEOUT_S ))
streak=0
last_beat=0

echo "[takeover] 等待端口释放：$PORTS（超时 ${TIMEOUT_S}s，需连续 ${SETTLE} 次空闲）"
while :; do
  if all_free; then
    streak=$(( streak + 1 ))
    if [ "$streak" -ge "$SETTLE" ]; then
      echo "[takeover] $PORTS 已稳定释放 → 启动 pnpm dev"
      break
    fi
  else
    streak=0
  fi

  now=$(date +%s)
  if [ $(( now - last_beat )) -ge 30 ]; then
    last_beat=$now
    printf '[takeover] %s 状态：' "$(date -u +%H:%M:%SZ)"
    for p in $PORTS; do port_free "$p" && printf '%s=FREE ' "$p" || printf '%s=busy ' "$p"; done
    echo "(剩余 $(( deadline - now ))s)"
  fi

  if [ "$now" -ge "$deadline" ]; then
    echo "[takeover] 超时：$PORTS 仍未释放，未启动任何进程。"
    exit 3
  fi
  sleep 3
done

cd "$REPO" || exit 4
echo "[takeover] cwd=$REPO  命令=pnpm dev  (expRate/端口取自 dev.config.json)"
exec pnpm dev
