#!/bin/sh
# cxq-backend 常驻看门狗：进程崩溃/被回收后自动拉起（幂等，多实例安全）
# 环境说明：沙箱工具会话的 env 可能被注入模板 DATABASE_URL（sqlite），
# 故先显式 source 本目录 .env，shell 变量优先级高于继承环境，确保用 Neon 真串。
LOG=/home/z/my-project/.zscripts/mini-service-cxq-backend.log
cd /home/z/my-project/mini-services/cxq-backend || exit 1
set -a; . ./.env; set +a
echo "[watchdog] $(date '+%F %T') 看门狗启动 (pid=$$)" >> "$LOG"
while true; do
  # 端口已被占用（容器启动链或另一看门狗已拉起）→ 静默等待，避免双实例互踩
  if curl -s -m 1 "http://127.0.0.1:${PORT:-3100}/health" > /dev/null 2>&1; then
    sleep 2
    continue
  fi
  echo "[watchdog] $(date '+%F %T') 拉起 bun src/main.ts" >> "$LOG"
  bun src/main.ts >> "$LOG" 2>&1
  echo "[watchdog] $(date '+%F %T') 进程退出(code=$?)，1s 后重试" >> "$LOG"
  sleep 1
done
