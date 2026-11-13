# Agent A 同机位渲染

使用站点发布的 Agent A `scene.glb` 和 `environment.jpg`，以 Three.js 离线生成 18 张 534 × 941 的对比图。每张图读取 Agent B `manifest.json` 对应帧的相机位置、朝向、去畸变焦距和主点。产物保存到 `public/real2sim/scene-20261113/agent-a/renders/<frame>.jpg`，供 Agent B 页面读取。

`registration.json` 记录从 Agent A 到 Agent B 的全局相似变换 `p_B = scale × rotation × p_A + translation`，两边均使用 glTF Y-up 坐标。以两个场景的柱廊底面中心为锚点，参考柱廊朝场地中央的方向和环路尺度，以 18 个机位检视画面后选定统一的旋转和比例。Agent A 的柱廊为椭圆，环路、草坪和树木位置均是目测布局。用同一变换处理所有帧，因此这些偏差会在画面中体现，不能用作像素级配准或测量。

用于本次出图的 Agent A `scene.glb` SHA-256 为 `3e81dbb0bb127804c7b82f1996f564388272114290fe2751278ee3d7de3b6ca6`，Agent B `manifest.json` SHA-256 为 `1127af9f39e6d294135928b9e167086b0b6bf1b6b591e5aa0efb8ca7a67e7246`。

## 复现

在完整的仓库 checkout 根目录运行。临时目录中的链接用于同时提供网页资源和出图脚本。

```bash
render_tmp=$(mktemp -d)
scene_public="$PWD/public/real2sim/scene-20261113"
render_source="$PWD/infra/real2sim/scene-20261113/agent-b/integration/matched-agent-a"
ln -s "$scene_public/agent-a" "$scene_public/agent-b" "$render_tmp/"
ln -s "$render_source" "$render_tmp/render"
cp "$render_source/render.mjs" "$render_tmp/"
npm install --prefix "$render_tmp" --no-audit --no-fund playwright@1.65.0
"$render_tmp/node_modules/.bin/playwright" install chromium
python3 -m http.server 5301 --bind 127.0.0.1 --directory "$render_tmp"
```

在另一终端运行。可用 `CHROME_PATH` 指定本机已安装的 Chrome。

```bash
node /path/to/render_tmp/render.mjs http://127.0.0.1:5301/render/render.html /path/to/output/renders
```
