#!/usr/bin/env python3
"""
立绘抠图脚本（人物背景移除，现实照片风格立绘用）

扫描 love_girls/<角色名>/ 下的图片（jpg / jpeg / png / webp / heic 转出的 jpg），
用本地 ISNet 人像分割模型（onnxruntime 推理，完全离线）把背景抠掉，
输出透明背景立绘到 public/images/characters/<角色名>/<原文件名>.webp

特性：
- 幂等：默认跳过已抠过的图（输出已存在则跳过），加 --force 全部重抠
- 自动 EXIF 转正、裁掉多余透明边、四周留 2% 留白、压到最长边 1600
- 输出带 alpha 的 webp（体积小、浏览器全支持）；加 --png 输出 PNG
- 以后往 love_girls/<角色名>/ 里加了新图，再跑一遍即可只处理新图

用法：
    python3 scripts/cutout.py               # 只处理新增图片
    python3 scripts/cutout.py --force       # 全部重新抠
    python3 scripts/cutout.py --model small # 用小模型（更省内存，质量略降）
    python3 scripts/cutout.py --png         # 输出 PNG 而不是 webp
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent
INPUT_ROOT = REPO_ROOT / "love_girls"
OUTPUT_ROOT = REPO_ROOT / "public" / "images" / "characters"
MODELS_DIR = REPO_ROOT / ".models"

MODEL_FILES = {
    "medium": MODELS_DIR / "isnet-medium.onnx",
    "small": MODELS_DIR / "isnet-small.onnx",
}
SUPPORTED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MARGIN_RATIO = 0.02      # 裁剪时人物边界外的留白比例
MAX_LONG_EDGE = 1600     # 输出立绘最长边
INPUT_SIZE = 1024        # ISNet 输入分辨率


def build_mask(session: ort.InferenceSession, im: Image.Image) -> Image.Image:
    """跑 ISNet 得到与原图同尺寸的软 alpha mask。"""
    sq = im.resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR)
    arr = (np.asarray(sq, dtype=np.float32) - 128.0) / 256.0  # [-0.5, 0.5]
    arr = arr.transpose(2, 0, 1)[None]
    pred = session.run(None, {session.get_inputs()[0].name: arr})[0][0, 0]
    pred = np.clip(pred, 0.0, 1.0)
    return Image.fromarray((pred * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)


def crop_to_content(img: Image.Image) -> Image.Image:
    """裁掉全透明边缘，四周留 2% 留白，并限制最长边。"""
    bbox = img.getchannel("A").getbbox()
    if bbox:
        l, t, r, b = bbox
        m = int(min(img.width, img.height) * MARGIN_RATIO)
        img = img.crop((max(0, l - m), max(0, t - m), min(img.width, r + m), min(img.height, b + m)))
    if max(img.width, img.height) > MAX_LONG_EDGE:
        s = MAX_LONG_EDGE / max(img.width, img.height)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    return img


def main() -> int:
    ap = argparse.ArgumentParser(description="love_girls 立绘批量抠图")
    ap.add_argument("--force", action="store_true", help="忽略已有输出，全部重抠")
    ap.add_argument("--model", choices=["medium", "small"], default="medium")
    ap.add_argument("--png", action="store_true", help="输出 PNG（默认 webp）")
    ap.add_argument("--only", help="只处理指定角色文件夹，如：--only 林知鸢")
    args = ap.parse_args()
    out_ext = "png" if args.png else "webp"

    if not INPUT_ROOT.is_dir():
        print(f"找不到输入目录：{INPUT_ROOT}", file=sys.stderr)
        return 1

    model_path = MODEL_FILES[args.model]
    if not model_path.exists():
        print(f"缺少模型文件 {model_path.relative_to(REPO_ROOT)}，先运行：", file=sys.stderr)
        print("  python3 scripts/fetch_model.py   （或 bash scripts/cutout.sh 会自动处理）", file=sys.stderr)
        return 1

    girl_dirs = sorted(p for p in INPUT_ROOT.iterdir() if p.is_dir())
    if args.only:
        girl_dirs = [p for p in girl_dirs if p.name == args.only]
    if not girl_dirs:
        print("love_girls/ 下没有角色文件夹", file=sys.stderr)
        return 1

    print(f"加载模型 {model_path.name} …")
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])

    total = done = skipped = failed = 0
    for girl_dir in girl_dirs:
        images = sorted(
            p for p in girl_dir.iterdir()
            if p.is_file() and p.suffix.lower() in SUPPORTED_EXT and not p.name.startswith(".")
        )
        if not images:
            print(f"[{girl_dir.name}] 没有图片，跳过")
            continue

        out_dir = OUTPUT_ROOT / girl_dir.name
        out_dir.mkdir(parents=True, exist_ok=True)

        for src in images:
            total += 1
            dst = out_dir / (src.stem + "." + out_ext)
            if dst.exists() and not args.force:
                skipped += 1
                continue
            try:
                with Image.open(src) as im:
                    im = ImageOps.exif_transpose(im).convert("RGB")
                rgba = im.convert("RGBA")
                rgba.putalpha(build_mask(session, im))
                rgba = crop_to_content(rgba)
                if out_ext == "webp":
                    rgba.save(dst, "WEBP", quality=90, method=6)
                else:
                    rgba.save(dst, "PNG", optimize=True)
                done += 1
                print(f"[{girl_dir.name}] {src.name} -> {dst.relative_to(REPO_ROOT)} ({rgba.width}x{rgba.height})")
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print(f"  !! 失败：{src.name}: {exc}", file=sys.stderr)

    print(f"\n完成：新抠 {done} 张，跳过 {skipped} 张，失败 {failed} 张，共扫描 {total} 张")
    print(f"输出目录：{OUTPUT_ROOT.relative_to(REPO_ROOT)}/")
    return 0 if failed == 0 and (done + skipped) > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
