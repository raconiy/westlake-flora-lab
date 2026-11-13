# scene-20261113 · Agent A 可编辑 CG 场景源码

这份源码使用 Blender Python 生成、装配和导出室外建筑、植物、地面与设施。网站提供独立 GLB 资产与完整场景的交互查看；本目录及独立下载包 source.zip 提供 CG 生成代码、参数、元数据和程序化材质纹理，不包含视频、模型权重或大型场景产物。

## 实拍证据与精度边界

- 原始输入为 H.264 竖屏视频，**544 × 960 像素**，约 30 fps，时长 **286.325 秒**。低分辨率会限制窗框、叶片、表面纹理和远处细节的辨认。
- 原片 SHA-256：6e5f00262487a188cd7673340a61fbcd581644d800090dc1050cd7e962275248。
- 场景的尺寸、位置、建筑平面、植物树高和树冠轮廓来自目视推估，使用“估计米”作为单位，**不是测绘或标定后的实测尺度**。
- 视频未观察到的建筑背面、被遮挡区域、枝叶和微观材质采用保守的程序化补全。生成细节不代表从实拍中恢复的真实细节。
- 当前交付定位为可编辑的外观原型；不宣称达到测量级复原。碰撞、完整物理属性和大规模仿真测试尚未接入。
- cg/*/metadata.json 记录各模块的尺度说明、固定种子和不确定性。柱廊的后续立面细化由 refine_architecture.py 在装配阶段应用，模块初始元数据不等于最终细化后的每项形状描述。

## 28 个独立资产

本场景保留 **28 个语义资产根节点**：2 个建筑资产、6 个地面及设施资产、20 个植物资产（10 株绿叶乔木、4 株秋色乔木、6 株灌木）。草叶、铺砖、窗构件等细部可属于各自资产内部的网格或层级，不将每个细部计算为一个独立下载资产。

装配脚本为每个根资产导出独立 GLB，并生成资产清单与放置矩阵。植物保留枝干与叶片子层级；资产可以分别选择、隐藏、移动、替换和重新导出。坐标为 Blender 的 Z-up、XY 地面；网页 glTF 使用 Y-up，转换关系为 (x, y, z) → (x, z, -y)。

目录内容：

- cg/architecture/：建筑参数化几何与元数据。
- cg/terrain/：草坪、广场、道路、步道、灯具、垃圾箱和标识等。
- cg/vegetation/：逐株固定随机种子的植物几何、元数据和树皮微细节贴图。
- assets/textures/：石材、混凝土、沥青、草地和树皮的程序化纹理；这些不是从原片直接恢复的高精度纹理。
- scripts/：装配、立面细化、材质细化、纹理生成、渲染、网站资源准备和源码打包脚本；若已生成，还包括 refine_environment.py 的云层和反射环境细化。
- viewer/ 或 agents/viewer/：配套静态查看器的 index.html、style.css、viewer.js；保持服务器的相对布局。
- environment.jpg（若存在）：配套环境贴图，可能位于 assets/ 或 assets/textures/。
- source-manifest.json：打包时的文件清单、字节数和 SHA-256。original_sha256 是服务器输入源码的哈希；便携路径改写后，打包文件的 sha256 可能不同。

## 在服务器上重新生成

运行环境：Blender 4.x（服务器当前命令为 Blender 4.0.2）、Python 3。仅在重新生成纹理时需要 NumPy 和 Pillow；已有纹理随包提供。渲染脚本使用 Cycles + **NVIDIA OptiX**，没有可用的 OptiX GPU 时会明确报错，不会静默切换到 CPU。

下载包解压后，进入包含本 README 的 agent-a 目录。仓库内对应目录为 infra/real2sim/scene-20261113/agent-a。以下命令在服务器执行：

~~~bash
cd /path/to/extracted/agent-a
mkdir -p scenes exports renders
blender --background --factory-startup --python scripts/assemble_scene.py
~~~

打包后的脚本默认以本包根目录读写素材。需要使用其他运行目录时，将 REAL2SIM_ROOT 设为拥有 cg/、scripts/ 和 assets/textures/ 的完整工作目录：

~~~bash
export REAL2SIM_ROOT=/path/to/server/agent-a
mkdir -p "$REAL2SIM_ROOT/scenes" "$REAL2SIM_ROOT/exports" "$REAL2SIM_ROOT/renders"
blender --background --factory-startup --python scripts/assemble_scene.py
~~~

装配会依次调用三个 CG 模块、应用立面及材质细化，写出：

- scenes/scene-agent-a.blend：可编辑的 Blender 场景。
- scenes/assembly.json：资产与场景放置矩阵。
- exports/assets/*.glb：28 个独立资产。
- exports/scene.glb：完整场景。
- exports/assets-manifest.json：资产、尺度、参考来源和预设视角。

可选的纹理再生成命令如下。它会覆盖运行目录中的程序化纹理，因此通常可直接使用随包提供的版本：

~~~bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install numpy pillow
python scripts/create_textures.py
~~~

## 渲染

先完成装配。在包根目录执行以下命令；若使用其他工作目录，将 REAL2SIM_ROOT 改为该目录：

~~~bash
export REAL2SIM_ROOT="$PWD"
CG_SAMPLES=64 blender --background "$REAL2SIM_ROOT/scenes/scene-agent-a.blend" \
  --python scripts/render_scene.py
~~~

脚本输出 overview、architecture、landscape 和 aerial 四个视角的 PNG 及渲染记录，默认 1440 × 900。通过 CG_VIEW 可只渲染一个视角：

~~~bash
CG_SAMPLES=64 CG_VIEW=architecture \
  blender --background "$REAL2SIM_ROOT/scenes/scene-agent-a.blend" \
  --python scripts/render_scene.py
~~~

这些相机是布局检查和展示预设，并非已标定为与实拍逐帧严格一致的相机。GPU 应与同服务器上的其他任务协调使用。

## 网站资源与 build

网站源码位于独立的 westlake-flora-lab 仓库；本 CG 下载包不是完整的网站源码或依赖包。仓库地址：

https://github.com/raconiy/westlake-flora-lab

在服务器网站 checkout 中安装依赖并构建：

~~~bash
cd /path/to/server/westlake-flora-lab
npm ci
npm run build
~~~

网站要求 Node.js ≥ 22.13.0。构建脚本执行 TypeScript 检查和 Vite build，结果位于仓库的 dist/。发布入口使用项目的 BASE_URL；Agent A 资源位于 public/real2sim/scene-20261113/agent-a/。

scripts/prepare_web.py 用于原始完整工作目录中的网站资源准备。它额外需要 repo/、viewer/（旧布局为 agents/viewer/）、exports/、frames/ 和 source/ 下已有的原片，因而不能仅凭这个源码包直接完成该步骤。查看器的三个源文件随 source.zip 提供，但原片、参考帧和依赖不放入源码包。在这些输入已具备的服务器工作目录中：

~~~bash
REAL2SIM_ROOT=/path/to/full-agent-a python3 /path/to/extracted/agent-a/scripts/prepare_web.py
cd /path/to/full-agent-a/repo
npm run build
~~~

## 同步源码与生成独立下载包

package_source.py 在**执行时**读取最新的三个 CG 模块、六个处理脚本和纹理，并包含已存在的环境细化脚本、环境贴图和静态查看器源码，只改写打包副本中的硬编码工作根路径。源模块、运行中的脚本、应用页面和查看器不被修改。打包脚本自身也包含在源码中。

仅验证当前输入、Python 语法、JSON、资产数、可疑凭据和内存中的 ZIP 完整性：

~~~bash
python3 scripts/package_source.py \
  --source-root /path/to/full-agent-a \
  --repo /path/to/server/westlake-flora-lab \
  --check-only
~~~

最终生成前，应结束本轮 CG 源码与纹理修改，再运行：

~~~bash
python3 scripts/package_source.py \
  --source-root /path/to/full-agent-a \
  --repo /path/to/server/westlake-flora-lab
~~~

输出为网站仓库内的：

- infra/real2sim/scene-20261113/agent-a/：可提交、可复现的 CG 源码目录。
- public/real2sim/scene-20261113/agent-a/source.zip：独立公开下载包，内部顶层目录为 agent-a/。

源码打包按明确的文件和扩展名白名单进行。**不包含模型 API 密钥、dispatcher、.env、依赖目录、模型权重、缓存、视频、参考帧、事件日志、渲染图、GLB 或 .blend 大文件**。纹理、几何及装配均可在生成后独立编辑；原视频只作为另行管理的输入与网页参考资源。
