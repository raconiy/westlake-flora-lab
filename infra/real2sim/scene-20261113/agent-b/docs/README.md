# Real2Sim scene-20261113 — Agent B（Claude Opus 5.5）

视频 → 可编辑 CG 室外场景。本目录是 Agent B 的 **CG 源码、可复现命令与资产契约**；
网页版在 `public/real2sim/scene-20261113/agent-b/`，研究版资产库与 Blender 源工程在服务器
`/root/real2sim/scene-20261113/agent-b/`（大文件不进 Git，见“发布方式”）。

> 作者：Agent B，模型 **Claude Opus 5.5**（`claude-opus-5-5`）。另一位 AI（Agent A）的目录、源码和进程均未改动。

## 输入

| 项 | 值 |
|---|---|
| 视频 | `/root/real2sim/scene-20261113/inputs/6e5f0026…/video.mp4`（只读） |
| SHA-256 | `6e5f00262487a188cd7673340a61fbcd581644d800090dc1050cd7e962275248`（已复核） |
| 规格 | 33,422,694 bytes，286.3 s，544×960，30 fps |

输入分辨率很低：门窗、叶形、树皮等细部是**按代码生成的合理结构**，不是从视频恢复的实拍细节。

## 流程（全部在服务器运行）

1. **抽帧**：3 fps（859 帧）`frames/f3/`。
2. **相机**：pycolmap 4.2 SIFT + 顺序匹配 + 增量 SfM → 859/859 帧注册，重投影 0.54 px（`scripts/recon/sfm.py`）。
3. **语义**：SAM3.1 文本提示逐帧分割（天空/建筑/草坪/铺装/道路/路缘/树/路灯/垃圾桶/花箱/人）（`segment_sam3.py`）。
4. **深度**：DA3-Nested-Giant，输入已求解位姿 → 稠密深度与 SfM 尺度一致（与稀疏点中位比 0.986）（`depth_da3.py`）。
5. **世界坐标**：地面 RANSAC 定重力方向；尺度 = 手持高度 1.51 m（经斑马线周期≈1.0 m 校核，约 ±5 %；DA3 度量深度给出 +23 %，与标线不符，未采用）（`world_frame.py`）。
6. **融合与测量**：带标签稠密点云 4,600 万点 → 正射影像/高度/类别栅格；逐棵树（位置、树高、冠幅剖面、调色板）、圆形建筑（半径 38.83 m、偏心上部鼓座）、路灯/垃圾桶/花箱、远景建筑、铺装方向（沿环形切向，3 处误差 ≤2.5°）、太阳方向（13 帧三角测量：高度角 36.6°）。
7. **CG 生成**（`cg/`）：树（空间殖民 + 管道模型 + 叶卡，LAI 物理密度）、建筑（参数化 + 实例化构件）、地面（约束三角剖分 + 极坐标铺装 UV + 参数化道路）、设施、视频天空穹顶、程序纹理（颜色按视频标定）。
8. **构建**：每个资产 → `.blend`（可编辑源工程）+ 研究版 `.glb` + 网页版 glTF（`cg/blender/build_assets.py`）。
9. **装配**：`scenes/scene_agentb.json`（instance_id / asset_id / 位置 / 旋转 / 缩放 / 父子组）→ `scenes/scene_agentb_research.blend`。
10. **渲染对照**：Cycles/OptiX，使用求解出的真实机位与内参（含 fx≠fy 像素比），输出同机位“视频 | CG”对照与指标。
11. **网页导出**：gltfpack（meshopt 压缩、实例化）→ 站点 `public/…/agent-b/`。

## 一键复现

```bash
cd /root/real2sim/scene-20261113/agent-b
scripts/setup_env.sh                       # 克隆只读 conda 环境到 envs/（torch 2.8 cu128）+ Blender 4.5.3
# 重建（约 15 min，8×RTX 5090）
envs/da3/bin/python scripts/recon/sfm.py frames/f3 - runs/sfm_f3
for i in 0 1 2 3 4 5; do CUDA_VISIBLE_DEVICES=$((i+2)) envs/sam3/bin/python scripts/recon/segment_sam3.py frames/f3 runs/seg_f3 $i 6 & done; wait
envs/da3/bin/python -c "import pycolmap; pycolmap.undistort_images('runs/undist','runs/sfm_f3/0','frames/f3')"
for i in 0 1 2 3 4 5 6 7; do CUDA_VISIBLE_DEVICES=$i envs/da3/bin/python scripts/recon/depth_da3.py runs/undist runs/depth $i 8 & done; wait
envs/da3/bin/python scripts/recon/world_frame.py 1.51
envs/da3/bin/python scripts/recon/fuse.py 2 && envs/da3/bin/python scripts/recon/raster.py 0.1 70
envs/da3/bin/python scripts/recon/measure_materials.py
envs/da3/bin/python scripts/recon/extract_trees.py && envs/da3/bin/python scripts/recon/refine_trees.py
envs/da3/bin/python scripts/recon/measure_rotunda.py && envs/da3/bin/python scripts/recon/detect_objects.py
envs/da3/bin/python cg/environment/build_sky.py
# 生成全部资产 → 构建 → 装配 → 同机位渲染对照（约 10 min）
scripts/run_iteration.sh <tag>
# 新视角连续漫游
scripts/render_novel.sh 180 32
# 网页版导出到站点
envs/da3/bin/python cg/web/export_web.py <tag>
```

单个资产可单独再生成，例如只重建 3 棵树：`envs/da3/bin/python cg/trees/build_trees.py 12,13,40`，再
`blender -b --factory-startup -P cg/blender/build_assets.py -- assets/trees/tree_13_red_maple/tree_13_red_maple_research.json`。

## 资产契约

* 每个资产独立目录：`<asset_id>_research.{json,parts.npz,blend,glb}`、`<asset_id>_web.{json,parts.npz,blend}`、网页 `<asset_id>.glb`。
* `json` 记录：asset_id、类别、生成器、全部参数与随机种子、pivot 定义、测量值与来源、推断项。
* Blender 层级：根 Empty `<asset_id>`（pivot）→ 子对象 `<asset_id>.<part>`（如 `trunk_branches`、`leaves`、`trunk_whitewash`、`pier`（40 个链接实例）、`glass_wall`、`upper_fin` …）。
* 坐标：米，+Z 向上（glTF 导出为 +Y 向上：`x_gltf=x, y_gltf=z, z_gltf=-y`）。树 pivot = 根颈落地点；建筑 = 基底中心；地面 = 区域质心地面高度；设施 = 接地点中心。
* 材质分区使用稳定材质名（`cg/blender/materials.py`）；纹理共享在 `assets/textures/`（含 `textures.json` 物理尺寸）。

## 实测 vs 推断（重要）

| 实测（来自视频重建） | 推断 / 生成 |
|---|---|
| 相机轨迹、内参；地面高程；草坪/铺装/道路/路缘轮廓 | 内部草坪（未拍到）与远侧半幅道路、远侧人行道 |
| 70 株树的落点、树高、冠幅剖面（12 方位×7 层）、叶色调色板 | 物种（目视推断）、分枝结构、叶形、树皮 |
| 圆形建筑外半径、上部鼓座半径/偏心、高度；铺装缝方向与板尺寸 | 柱子数量 40（±4）、柱截面、玻璃退进、背面立面 |
| 路灯 42 盏位置与高度；花箱、垃圾桶位置；太阳方向 | 设施具体造型；远景建筑进深、屋顶、立面图案 |
| 天空（视频天空像素重投影） | 天顶未拍到区域平滑补全 |

## 发布方式

* Git：CG 源码、配置、文档、网页版（压缩 glb、贴图、参考帧/对照图）。
* 服务器：研究版资产库（逐叶树木、`.blend` 源工程）、中间结果（点云、深度、分割）、环境与缓存。
* 密码/凭据与缓存不进 Git。

## 迭代记录（同机位 18 帧，视频 vs CG 平均绝对像素差，sRGB 0–255）

| 迭代 | 主要修改 | mean \|diff\| |
|---|---|---|
| iter01 | 首次装配：地面、圆形建筑、70 株树、程序天空 | 39.87 |
| iter02 | 视频天空穹顶、路灯/花箱/垃圾桶、远景建筑、叶片覆盖率修正 | 47.96（天空曝光未标定） |
| iter03 | 西南道路参数化（路缘线实测）、移除误检建筑、叶色提亮 | 38.38 |
| iter04 | 叶片辐亮度→反照率反演、草坪色、白色尖塔、三角剖分加固 | 39.30 |
| iter05 | 圆形建筑旁道路（以建筑中心极坐标）、天顶补全、草坪蓝色抑制 | 37.67 |
| iter06 | 树冠亮度按同机位标定（×7.2） | 36.81 |
| iter07 | 拓扑定义细枝（修复无叶树）、叶片高光降低、白石反照率 | 36.38 |
| iter08 | 宏观色彩变化、草坪 4 m 贴图、地形扩至 1.5 km | 39.65（远处草地挡住天际线） |
| iter09 | 近/远地形拆分、草坪去高光 | 40.93（粗三角形穿出路面——已定位） |
| iter10 | 地形三角形 4 m²、下沉余量 | **37.04** |

剩余主要差异（诚实记录）：远景建筑为低细节体块；树冠逐片叶卡在近景可见；视频中的人、自行车、标识牌未建模；草坪缺少真实草叶的微观起伏。
