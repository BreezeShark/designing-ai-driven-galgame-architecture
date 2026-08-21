#!/usr/bin/env python3
"""
模型引导脚本：从 npm registry 下载并重组抠图用的 ISNet 人像分割模型。

沙箱环境里 GitHub release / HuggingFace 等模型源不可达，但 npm registry 可达。
@imgly/background-removal-node 这个 npm 包的 tarball 里以分块形式内置了
ISNet 分割模型（模型本身是开源权重，ONNX 格式，可直接用 onnxruntime 推理），
本脚本负责：下载 tarball -> 按分块清单重组出 .onnx -> 校验哈希。

输出：.models/isnet-medium.onnx（约 88MB，推荐）
      .models/isnet-small.onnx （约 44MB，体积敏感时用）

模型文件已在 .gitignore 中，不会提交进仓库；删掉后重跑本脚本即可恢复。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = REPO_ROOT / ".models"

NPM_PACKAGE = "@imgly/background-removal-node"
NPM_VERSION = "1.4.5"
NPM_TARBALL = f"https://registry.npmjs.org/{NPM_PACKAGE}/-/background-removal-node-{NPM_VERSION}.tgz"

# tarball 内 chunk 清单 -> 模型输出 的映射
MODEL_MAP = {
    "isnet-medium.onnx": "/models/medium",
    "isnet-small.onnx": "/models/small",
}


def http_get(url: str, dest: Path) -> None:
    """优先用 curl（本环境里 Python 的证书校验会被中间人代理挡住），失败再退回 urllib。"""
    try:
        subprocess.run(
            ["curl", "-fsSL", "--retry", "3", "--max-time", "600", "-o", str(dest), url],
            check=True,
        )
        return
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    with urllib.request.urlopen(url, timeout=600) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f)


def main() -> int:
    MODELS_DIR.mkdir(exist_ok=True)

    done: list[Path] = []
    missing: list[str] = []
    for filename in MODEL_MAP:
        p = MODELS_DIR / filename
        if p.exists() and p.stat().st_size > 1_000_000:
            done.append(p)
        else:
            missing.append(filename)

    if not missing:
        for p in done:
            print(f"已就绪：{p.relative_to(REPO_ROOT)} ({p.stat().st_size/1e6:.0f} MB)")
        return 0

    with tempfile.TemporaryDirectory(prefix="cutout-model-") as td:
        tdp = Path(td)
        tarball = tdp / "pkg.tgz"
        print(f"下载 {NPM_PACKAGE}@{NPM_VERSION}（约 108MB，可能需要一两分钟）…")
        http_get(NPM_TARBALL, tarball)

        pkg_dir = tdp / "pkg"
        pkg_dir.mkdir()
        with tarfile.open(tarball, "r:gz") as tf:
            tf.extractall(pkg_dir, filter="data")
        pkg_root = pkg_dir / "package"
        resources = json.loads((pkg_root / "dist" / "resources.json").read_text())

        for filename, resource_key in MODEL_MAP.items():
            chunks = resources[resource_key]["chunks"]
            out = MODELS_DIR / filename
            h_all = hashlib.sha256()
            with open(out, "wb") as f:
                for chunk in sorted(chunks, key=lambda c: c["offsets"][0]):
                    data = (pkg_root / "dist" / chunk["hash"]).read_bytes()
                    s, e = chunk["offsets"]
                    payload = data[: e - s]
                    assert hashlib.sha256(payload).hexdigest() == chunk["hash"], f"分块校验失败：{chunk['hash']}"
                    f.write(payload)
                    h_all.update(payload)
            print(f"重组完成：{out.relative_to(REPO_ROOT)} ({out.stat().st_size/1e6:.0f} MB, sha256={h_all.hexdigest()[:16]}…)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
