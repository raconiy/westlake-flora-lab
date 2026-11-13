# Agent B 接入说明（给主控 / Agent A）

Agent B（Claude Opus 5.5）只新增两处隔离路径，**未修改任何公共文件**（`app/page.tsx`、导航、样式、`vite.config.ts` 均未改动）：

| 路径 | 内容 |
|---|---|
| `public/real2sim/scene-20261113/agent-b/` | 独立展示模块：`index.html` + `viewer.js` + `style.css`、`vendor/`（three r180，来自仓库 node_modules）、`manifest.json`、`scene.json`、`assets/*.glb`（121 个独立资产，meshopt 压缩）、`refs/`（去畸变视频参考帧）、`renders/`（同机位 Cycles 渲染）、`sky.jpg`、`evidence/` |
| `infra/real2sim/scene-20261113/agent-b/` | CG 源码（`cg/`）、重建与流程脚本（`scripts/`）、网页源（`web/`）、文档（`docs/`）、测量结果（`measurements/`）、场景装配配置（`scenes/scene_agentb.json`）、接入补丁（`integration/`） |

## 模块入口与约定

* 入口：`${import.meta.env.BASE_URL}real2sim/scene-20261113/agent-b/index.html`（全部资源相对路径，部署在 `/westlake-flora-lab/` 下可用）。
* 与 Agent A 现有做法一致：主页面 `ComparisonScene` 用 iframe 嵌入。
* `manifest.json`：`schema = agentb-scene-manifest/1`，含 `status`、`version`、`source_video.sha256`、`coordinate_frame`（单位、轴向、尺度方法与不确定度）、`camera_intrinsics`、`lighting`、`assets`、`instances`、`reference_views`。
* 三方对比：模块内“三方对比 · 当前机位”会探测 `../agent-a/renders/<frame>.jpg`；若 Agent A 提供同名同机位渲染即自动显示，否则显示“待接入”，**不伪造结果**。帧号与 `reference_views[].frame` 相同（去畸变 534×941，pycolmap 机位）。

## 最小接入补丁

`integration/agent-b-comparison-switch.patch`：在现有“新场景对比”页加一个 Agent A / Agent B 切换（iframe 源切换），`#comparison-b` 直达 Agent B。应用：

```bash
git apply infra/real2sim/scene-20261113/agent-b/integration/agent-b-comparison-switch.patch
```

也可以按主控自己的布局并排放置两个 iframe；Agent B 模块不依赖父页面的任何状态。

## 体积与发布

* 网页版约 70 MB（单文件最大约 1.3 MB），适合直接随 GitHub Pages 发布。
* 研究版（逐叶树木、Blender 源工程 `.blend`、完整场景 `.blend`，约 4.7 GB）留在服务器 `/root/real2sim/scene-20261113/agent-b/`，不进 Git。
