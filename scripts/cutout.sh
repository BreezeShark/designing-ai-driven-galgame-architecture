#!/usr/bin/env bash
# 立绘抠图：love_girls/<角色名>/*.jpg -> public/images/characters/<角色名>/*.webp（透明背景）
#
# 用法：
#   bash scripts/cutout.sh            # 只处理新增的图片（第一次跑会自动装依赖+模型）
#   bash scripts/cutout.sh --force    # 全部重新抠
#   bash scripts/cutout.sh --model small   # 小模型（更省内存）
#   bash scripts/cutout.sh --png      # 输出 PNG 而不是 webp
#   bash scripts/cutout.sh --only 林知鸢
#
# 也可以通过 npm 跑：npm run cutout [-- 参数]
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${REPO_ROOT}/.venv-cutout"

# 首次运行：准备 Python 环境（依赖只装在仓库里的虚拟环境中，不污染系统）
if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "首次运行：创建 Python 虚拟环境并安装 onnxruntime / pillow（约 1 分钟）…"
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --quiet --upgrade pip
  "$VENV_DIR/bin/pip" install --quiet onnxruntime pillow numpy
fi

# 模型缺失时自动从 npm registry 引导下载（详见 scripts/fetch_model.py）
if [ ! -f "$REPO_ROOT/.models/isnet-medium.onnx" ] && [ ! -f "$REPO_ROOT/.models/isnet-small.onnx" ]; then
  "$VENV_DIR/bin/python" "$REPO_ROOT/scripts/fetch_model.py"
fi

exec "$VENV_DIR/bin/python" "$REPO_ROOT/scripts/cutout.py" "$@"
