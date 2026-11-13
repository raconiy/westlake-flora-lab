# Agent A 同长度仿真视频

服务器生成命令使用 Blender 4.0.2 与 EEVEE，加载 `revision2/integration/final-scene/appearance-scene.blend`，输出 `544x960`、`30 fps`、`286.325 s` 的 H.264 视频。

当前 COLMAP 相机注册仍包含断开的组件，因此视频采用显式标注的推断环绕路径；路径边界排除了天空/环境大球，只使用场景几何拟合。`--sample-fps 2 --no-interpolate` 的研究版保持采样帧到 30 fps，保持源视频时长与画幅，不把插帧伪影当作实拍运动。
