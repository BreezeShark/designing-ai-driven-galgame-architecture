#!/usr/bin/env bash
# ============================================================
# 重启服务脚本
#
# 改完 .env（或任何配置）后，用它重启 Next.js 服务，让新配置生效。
# 默认后台启动开发服务器：PID 写入 .run/server.pid，日志写入 .logs/server.log。
#
# 用法：
#   bash scripts/restart.sh                 # 重启开发服务器（端口 3000）
#   bash scripts/restart.sh prod            # 重启生产服务器（需先 npm run build）
#   bash scripts/restart.sh --port 3001     # 指定端口
#   bash scripts/restart.sh --foreground    # 前台运行（日志打到当前终端，Ctrl+C 退出）
#   bash scripts/restart.sh stop            # 只停止，不重启
#   bash scripts/restart.sh status          # 查看运行状态
#
# 对应 npm 脚本：npm run restart / restart:prod
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

MODE="dev"           # dev | prod
PORT="3000"
FOREGROUND=0
ACTION="restart"     # restart | stop | status

PID_DIR=".run"
PID_FILE="$PID_DIR/server.pid"
LOG_DIR=".logs"
LOG_FILE="$LOG_DIR/server.log"

# 颜色输出（非 tty 或 NO_COLOR 时禁用）
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_CYAN='\033[36m'; C_DIM='\033[2m'; C_RESET='\033[0m'
else
  C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''; C_DIM=''; C_RESET=''
fi

info()  { printf "${C_GREEN}[✓]${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}[!]${C_RESET} %s\n" "$*"; }
error() { printf "${C_RED}[✗]${C_RESET} %s\n" "$*" >&2; }
step()  { printf "${C_CYAN}[…]${C_RESET} %s\n" "$*"; }

usage() {
  cat <<'EOF'
重启服务脚本：改完 .env 后重新加载配置

用法:
  bash scripts/restart.sh [dev|prod] [stop|status] [--port N] [--foreground]

参数:
  dev           重启开发服务器（默认，next dev）
  prod          重启生产服务器（next start，需先 npm run build）
  stop          只停止服务，不重启
  status        查看服务运行状态
  --port N      端口（默认 3000）
  --foreground  前台运行，日志直接打到当前终端（默认后台 + 日志文件）

说明:
  后台模式下 PID 写入 .run/server.pid、日志写入 .logs/server.log；
  脚本会先结束占用端口的旧进程（含 npm 派生的 next/node 子进程），再启动新进程。
EOF
}

# ---------- 参数解析 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    dev|prod) MODE="$1" ;;
    restart)  ACTION="restart" ;;
    stop)     ACTION="stop" ;;
    status)   ACTION="status" ;;
    --port)   PORT="$2"; shift ;;
    --port=*) PORT="${1#--port=}" ;;
    --foreground|-f) FOREGROUND=1 ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数：$1"; usage; exit 1 ;;
  esac
  shift
done

# 端口合法性校验
case "$PORT" in
  ''|*[!0-9]*) error "端口必须是数字：$PORT"; exit 1 ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  error "端口超出范围：$PORT"; exit 1
fi

# ---------- 端口进程探测 ----------
# 输出占用 $PORT 的 PID 列表（每行一个），兼容 macOS(lsof) 与 Linux(fuser/ss)。
port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${port}" -s tcp:LISTEN 2>/dev/null || true
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | grep -oE '[0-9]+' || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 || true
    return 0
  fi
  echo ""
}

# 结束进程（连同其进程组：npm 会派生 next/node 子进程）
kill_group() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  # 负数 PID = 向整个进程组发信号（POSIX，GNU/BSD kill 均支持）
  kill -TERM -"$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
}

stop_server() {
  # 1) PID 文件优先
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      step "停止旧进程（PID $pid）"
      kill_group "$pid"
    fi
    rm -f "$PID_FILE"
  fi

  # 2) 端口兜底：清掉仍占用端口的进程（含未登记 PID 的情况）
  local p
  for p in $(port_pids "$PORT"); do
    [ -n "$p" ] || continue
    step "结束占用端口 ${PORT} 的进程（PID $p）"
    kill "$p" 2>/dev/null || true
  done

  # 3) 等待端口释放，最多 10 秒，超时则强杀
  local i=0
  while [ "$i" -lt 10 ]; do
    [ -z "$(port_pids "$PORT")" ] && break
    sleep 1
    i=$((i + 1))
  done
  if [ "$i" -eq 10 ] && [ -n "$(port_pids "$PORT")" ]; then
    warn "端口 ${PORT} 仍在占用，强制结束"
    for p in $(port_pids "$PORT"); do
      kill -9 "$p" 2>/dev/null || true
    done
    sleep 1
  fi
  return 0
}

start_server() {
  mkdir -p "$PID_DIR" "$LOG_DIR"

  # Next.js 通过 PORT 环境变量决定监听端口
  export PORT="$PORT"

  local cmd
  if [ "$MODE" = "prod" ]; then
    cmd="npm run start"
  else
    cmd="npm run dev"
  fi

  if [ "$FOREGROUND" = "1" ]; then
    step "前台启动（${MODE}）→ http://localhost:${PORT}，Ctrl+C 退出"
    exec $cmd
  fi

  step "后台启动（${MODE}）→ http://localhost:${PORT}"
  nohup $cmd >>"$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  info "已启动，PID=$(cat "$PID_FILE")，日志：$LOG_FILE"

  # 等待端口就绪（最多 60 秒）
  local i=0
  while [ "$i" -lt 60 ]; do
    if [ -n "$(port_pids "$PORT")" ]; then
      info "服务已监听端口 ${PORT}"
      return 0
    fi
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && [ "$i" -ge 3 ]; then
      warn "启动进程已退出，最近日志如下："
      tail -n 30 "$LOG_FILE" 2>/dev/null || true
      return 1
    fi
    sleep 1
    i=$((i + 1))
  done
  warn "等待端口 ${PORT} 就绪超时（60s），请查看日志：$LOG_FILE"
  return 1
}

print_status() {
  local pids
  pids="$(port_pids "$PORT")"
  if [ -n "$pids" ]; then
    info "服务运行中（端口 ${PORT}）：PID $(echo "$pids" | tr '\n' ' ')"
  else
    warn "端口 ${PORT} 无服务监听"
  fi
  if [ -f "$PID_FILE" ]; then
    info "PID 文件：$PID_FILE = $(cat "$PID_FILE")"
  fi
  if [ -f "$LOG_FILE" ]; then
    info "日志文件：$LOG_FILE（最近 5 行）"
    tail -n 5 "$LOG_FILE" 2>/dev/null | sed 's/^/    /' || true
  fi
}

# ---------- 主流程 ----------
case "$ACTION" in
  status)
    print_status
    ;;
  stop)
    if [ -z "$(port_pids "$PORT")" ] && [ ! -f "$PID_FILE" ]; then
      warn "端口 ${PORT} 无服务在运行"
      exit 0
    fi
    stop_server
    info "已停止"
    ;;
  restart)
    step "重启服务（${MODE}，端口 ${PORT}）"
    stop_server
    sleep 1
    start_server
    ;;
esac
