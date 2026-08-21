# love_girls/ —— 女主角立绘素材目录

这里的照片就是两位女主角的**实际立绘**（现实风格真人照片，不用二次元立绘）。

## 目录约定

```
love_girls/
├── 林知鸢/     ← 女主一的立绘照片（jpg / png / webp 都行）
└── 江心妍/     ← 女主二的立绘照片
```

**一个文件夹 = 一位女主角**，文件夹名就是她的名字。想加第三位女主，
新建一个以她名字命名的文件夹、把照片丢进去，再跑一次抠图、在游戏
「设置」页添加角色即可。

## 以后加了新照片怎么办

直接把图片丢进对应文件夹，然后在仓库根目录跑：

```bash
npm run cutout          # 只会处理新增的图片（已抠过的自动跳过）
```

抠好的透明底立绘会输出到 `public/images/characters/<名字>/`（webp 格式，
带透明通道），游戏里直接可用。其他用法：

```bash
npm run cutout -- --force          # 全部重新抠
npm run cutout -- --only 林知鸢     # 只处理某一位
npm run cutout -- --png            # 输出 PNG 而不是 webp
npm run cutout -- --model small    # 用小模型（更省内存，质量略降）
```

## 换某个角色默认用的那张立绘

默认立绘取的是每个文件夹里文件名排序的第一张。想换：
- 改 `src/lib/data/characters.ts` 里的 `avatarUrl`（指向
  `public/images/characters/<名字>/<文件名>.webp`，对旧数据库不会自动生效），或
- 直接在游戏「设置」页里改角色的立绘地址 / 上传。

## 抠图是怎么做的

`scripts/cutout.py` 用本地 ISNet 人像分割模型（onnxruntime，完全离线）把
背景抠成透明。模型文件在 `.models/`（不进 git），丢了的话 `npm run cutout`
会自动通过 `scripts/fetch_model.py` 重新获取。

建议照片尽量是：单人、光线均匀、人物和背景分得开的，抠图效果最好；
两人合照或人群背景的照片会出现主体被切碎/误删的情况。
