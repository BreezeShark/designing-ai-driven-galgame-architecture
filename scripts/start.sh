#!/usr/bin/env bash
# ============================================================
# 一键本地部署脚本
#
# 自动完成：
#   1. Node 版本检查（≥ 18）
#   2. 数据库准备：已有可用 DATABASE_URL 则直接复用；
#      否则优先 Docker（postgres:16），没有 Docker 则退回本机 PostgreSQL
#   3. 生成 / 更新 .env 的 DATABASE_URL
#   4. 缺少 node_modules 时自动 npm install
#   5. 用与 DATABASE_URL 一致的临时 drizzle 配置执行 drizzle-kit push 建表
#   6. 启动服务器（dev / build / start）
#
# 用法：
#   bash scripts/start.sh            # 等于 dev
#   bash scripts/start.sh dev        # 开发模式（默认）
#   bash scripts/start.sh build      # 生产构建 + 启动
#   bash scripts/start.sh start      # 仅启动生产服务器（需先 build）
#   加 --docker / --local 指定数据库来源
#
# 对应 npm 脚本：npm run start:local / start:local:prod
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

DB_NAME="app_db"
DB_USER="postgres"
DB_PASSWORD="postgres"
DB_HOST="127.0.0.1"
DB_PORT="5432"
DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
DOCKER_CONTAINER="galgame-postgres"

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
一键本地部署脚本：自动装依赖 / 起数据库 / 建表 / 启动

用法:
  bash scripts/start.sh [dev|build|start] [--docker|--local]
  npm run start:local          # 等价 bash scripts/start.sh dev
  npm run start:local:prod     # 等价 bash scripts/start.sh build

参数:
  dev       开发模式启动（默认）
  build     生产构建 + 启动
  start     仅启动生产服务器（需先 build）
  --docker  数据库优先使用 Docker（postgres:16）
  --local   数据库优先使用本机 PostgreSQL

说明:
  已有可用 DATABASE_URL（环境变量或 .env）时会直接复用，不会覆盖；
  已配置但不可达时会报错并提示，指定 --docker / --local 可改用自动准备的本地库。
EOF
}

# ---------- 0. 参数解析 ----------
MODE="dev"
DB_SOURCE="auto" # auto | docker | local
while [ $# -gt 0 ]; do
  case "$1" in
    dev|build|start) MODE="$1" ;;
    --docker) DB_SOURCE="docker" ;;
    --local)  DB_SOURCE="local" ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数：$1"; usage; exit 1 ;;
  esac
  shift
done

# ---------- 1. Node 检查 ----------
step "检查 Node.js 环境（要求 ≥ 18）"
if ! command -v node >/dev/null 2>&1; then
  error "未找到 node，请先安装 Node.js 18+（https://nodejs.org）"
  exit 1
fi
NODE_MAJOR="$(node -e 'console.log(Number(process.versions.node.split(".")[0]))')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js 版本过低（当前 $(node -v)），需要 ≥ 18"
  exit 1
fi
info "Node $(node -v)"

# ---------- 数据库工具函数 ----------
# 检测 postgres URL 的 host:port 是否可达（TCP 层，不依赖任何 npm 包）
db_reachable() {
  node -e '
    const m = String(process.argv[1]).match(/^[a-z0-9+]+:\/\/(?:[^:@/]+(?::[^@/]*)?@)?\[?([^:/[\]]+)\]?(?::([0-9]+))?/i);
    if (!m) process.exit(1);
    const net = require("node:net");
    const host = m[1];
    const port = Number(m[2] || "5432");
    const sock = net.connect({ host, port }, () => { sock.destroy(); process.exit(0); });
    sock.setTimeout(2000, () => { sock.destroy(); process.exit(1); });
    sock.on("error", () => process.exit(1));
  ' "$1"
}

# 等待数据库就绪：$1 = URL，$2 = 最多等待秒数
wait_for_db() {
  local url="$1" tries="${2:-60}" i=0
  while [ "$i" -lt "$tries" ]; do
    if db_reachable "$url"; then return 0; fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

# 以 postgres 超级用户执行 psql/createdb（幂等，尽力而为）
pg_admin() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -c "$1" >/dev/null 2>&1 || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n -u postgres bash -c "$1" >/dev/null 2>&1 || true
  else
    PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -c "$1" >/dev/null 2>&1 || true
  fi
}

# Docker 路径：拉取 / 复用 postgres:16 容器
ensure_docker_db() {
  if ! command -v docker >/dev/null 2>&1; then
    error "未找到 docker。请安装 Docker 后用 --docker，或改用 --local（本机 PostgreSQL）。"
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    error "docker 守护进程未运行，请先启动 Docker。"
    return 1
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$DOCKER_CONTAINER"; then
    if ! docker ps --format '{{.Names}}' | grep -qx "$DOCKER_CONTAINER"; then
      step "启动已有容器 $DOCKER_CONTAINER"
      docker start "$DOCKER_CONTAINER" >/dev/null
    fi
  else
    step "用 Docker 拉取并启动 postgres:16（容器 ${DOCKER_CONTAINER}，端口 ${DB_PORT}）"
    if ! docker run -d --name "$DOCKER_CONTAINER" \
      -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASSWORD" -e POSTGRES_DB="$DB_NAME" \
      -p "${DB_PORT}:5432" postgres:16 >/dev/null 2>&1; then
      error "Docker 容器启动失败（端口 ${DB_PORT} 可能已被占用）。请释放端口后重试，或改用 --local。"
      return 1
    fi
  fi
  step "等待数据库就绪（最多 90 秒）"
  wait_for_db "$DB_URL" 90
}

# 本机 PostgreSQL 路径：检测 / 启动 / 补全账号与数据库
ensure_local_db() {
  if ! command -v pg_isready >/dev/null 2>&1; then
    error "未找到本机 PostgreSQL（pg_isready 不存在）。请安装 PostgreSQL 后用 --local，或改用 --docker。"
    return 1
  fi
  if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
    step "尝试启动本机 PostgreSQL"
    if command -v pg_ctlcluster >/dev/null 2>&1; then
      local v
      for v in 16 15 14 13; do
        if [ -d "/etc/postgresql/$v" ]; then
          pg_ctlcluster "$v" main start >/dev/null 2>&1 || true
          break
        fi
      done
    elif command -v systemctl >/dev/null 2>&1; then
      systemctl start postgresql >/dev/null 2>&1 || true
    elif command -v brew >/dev/null 2>&1; then
      brew services start postgresql@16 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1 || true
    fi
    sleep 2
  fi
  if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
    error "本机 PostgreSQL 未能启动。请手动启动后重试，或改用 --docker。"
    return 1
  fi
  # 幂等补全：postgres 用户密码 + app_db 数据库
  pg_admin "psql -c \"ALTER USER ${DB_USER} PASSWORD '${DB_PASSWORD}';\""
  pg_admin "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1 || createdb '${DB_NAME}'"
  step "等待数据库就绪（最多 10 秒）"
  wait_for_db "$DB_URL" 10
}

# ---------- 2. 数据库准备 ----------
step "准备数据库"
EXISTING_URL="${DATABASE_URL:-}"
if [ -z "$EXISTING_URL" ] && [ -f .env ]; then
  EXISTING_URL="$(grep -E '^DATABASE_URL=.+' .env | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi

RESOLVED_URL=""
if [ -n "$EXISTING_URL" ]; then
  if db_reachable "$EXISTING_URL"; then
    RESOLVED_URL="$EXISTING_URL"
    info "复用已有 DATABASE_URL（数据库可达）"
  elif [ "$DB_SOURCE" = "auto" ]; then
    error "DATABASE_URL 已配置但数据库不可达：$EXISTING_URL"
    error "请先启动对应的数据库，或使用 --docker / --local 让脚本自动准备本地数据库。"
    exit 1
  else
    warn "DATABASE_URL 已配置但不可达，按 --${DB_SOURCE} 准备新的本地数据库"
  fi
fi

if [ -z "$RESOLVED_URL" ]; then
  case "$DB_SOURCE" in
    docker)
      ensure_docker_db || exit 1
      ;;
    local)
      ensure_local_db || exit 1
      ;;
    auto)
      if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        step "检测到 Docker，优先使用 Docker 数据库"
        ensure_docker_db || { warn "Docker 数据库准备失败，尝试本机 PostgreSQL"; ensure_local_db || exit 1; }
      else
        step "未检测到 Docker，使用本机 PostgreSQL"
        ensure_local_db || exit 1
      fi
      ;;
  esac
  RESOLVED_URL="$DB_URL"
  info "已准备本地数据库：$DB_URL"
fi

# ---------- 3. 写入 .env ----------
step "准备 .env"
if [ ! -f .env ]; then
  cat > .env <<'EOF'
# 由 scripts/start.sh 自动生成（可手动修改）
# AI 配置均为可选，详见 .env.example
EOF
fi
# 仅当本次由脚本负责生成数据库时才写入；复用已有 URL 时保持 .env 不动
if [ "$RESOLVED_URL" != "$EXISTING_URL" ]; then
  awk -v v="$RESOLVED_URL" '
    /^DATABASE_URL=/ { print "DATABASE_URL=" v; found=1; next }
    { print }
    END { if (!found) print "DATABASE_URL=" v }
  ' .env > .env.tmp && mv .env.tmp .env
  info "已写入 .env 的 DATABASE_URL"
fi
export DATABASE_URL="$RESOLVED_URL"

# ---------- 4. 安装依赖 ----------
if [ ! -d node_modules ]; then
  step "安装 npm 依赖（首次运行可能需要几分钟）"
  npm install
else
  info "node_modules 已存在，跳过安装"
fi

# ---------- 5. drizzle-kit push 建表 ----------
step "执行 drizzle-kit push 建表"
TMP_CONFIG="$(mktemp /tmp/galgame-drizzle-config.XXXXXX.json)"
trap 'rm -f "${TMP_CONFIG:-}"' EXIT
cat > "$TMP_CONFIG" <<EOF
{
  "dialect": "postgresql",
  "schema": "$ROOT_DIR/src/db/schema.ts",
  "dbCredentials": { "url": "$RESOLVED_URL" }
}
EOF
npx drizzle-kit push --config="$TMP_CONFIG" --force
info "数据库表结构就绪"

# ---------- 6. 启动服务器 ----------
case "$MODE" in
  dev)
    step "启动开发服务器 → http://localhost:3000"
    npm run dev
    ;;
  build)
    step "生产构建"
    npm run build
    step "启动生产服务器 → http://localhost:3000"
    npm run start
    ;;
  start)
    step "启动生产服务器 → http://localhost:3000"
    npm run start
    ;;
esac
