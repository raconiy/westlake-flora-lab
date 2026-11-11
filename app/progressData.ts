export type ProgressStatus = 'done' | 'active' | 'queued' | 'blocked';

export type ProgressEvidence = {
  label: string;
  href: string;
  kind: 'site' | 'comparison' | 'dispatch' | 'release' | 'local';
};

export type ProgressTask = {
  id: string;
  phase: string;
  title: string;
  owner: string;
  status: ProgressStatus;
  progress: number;
  updatedAt: string;
  summary: string;
  evidence: ProgressEvidence[];
  metrics?: Array<{ label: string; value: string }>;
  blocker?: string;
};

/**
 * Public-safe project ledger. It deliberately contains no email, password,
 * access token, 2FA seed, private host path, or worker credential.
 * Account-level proof remains in the redacted dispatch record linked below.
 */
export const progressMeta = {
  version: 'R7.1',
  campus: '西湖大学·云谷校区',
  updatedAt: '2026-11-11T21:43:53+08:00',
  release: '23b49752dc7c21d9197368253588b1efb38f7db4cc5a8c9f94c52821c0e94dc5',
  model: 'gpt-6.1-sol / high',
  publicNote: '状态来自已发布证据与可复核测试；“完成”表示本阶段交付，不代表照片级真实。',
};

export const progressTasks: ProgressTask[] = [
  {
    id: 'scene-capture17',
    phase: '01 · 场景重建',
    title: '云谷草坪与路灯空间配准',
    owner: '场景配准 · 集成与发布',
    status: 'done',
    progress: 100,
    updatedAt: '2026-11-10 22:20',
    summary: '13 个相机视角与 4 个视频片段已整理为可浏览的植物/草坪/路灯场景；建筑物保持为拍摄参照，不作为资产交付。',
    evidence: [
      { label: '打开公网场景', href: 'https://raconiy.github.io/westlake-flora-lab/#reconstruction', kind: 'site' },
      { label: '照片对照页', href: 'https://raconiy.github.io/westlake-flora-lab/capture17/scene-r7/index.html', kind: 'comparison' },
    ],
    metrics: [
      { label: '验收视角', value: '13' },
      { label: '渲染卡数', value: '8 × RTX 5090' },
      { label: 'CI', value: '2 次成功' },
    ],
  },
  {
    id: 'grass-lod-wind',
    phase: '02 · 地被与风场',
    title: '真实草叶、远近密度与风动',
    owner: '地被形态 · 枝叶力学',
    status: 'done',
    progress: 100,
    updatedAt: '2026-11-10 21:42',
    summary: '实拍草坪保留原有几何。R7.1 为布局实验加入 111,433 个固定草根、弯曲草叶与步道排除区；实拍枝条加入持续阵风载荷，停止风后弹性回位。',
    evidence: [
      { label: '草叶近景', href: 'https://raconiy.github.io/westlake-flora-lab/capture17/scene-r7/index.html#grass', kind: 'comparison' },
      { label: '公网操作记录', href: 'https://raconiy.github.io/westlake-flora-lab/capture17/scene-r7/dispatch/index.html', kind: 'dispatch' },
    ],
    metrics: [
      { label: '完整草叶', value: '42,893,277' },
      { label: '近景深度覆盖', value: '89.8%' },
      { label: '风速示例', value: '4.7 m/s' },
    ],
    blocker: '区域亮度/纹理仍有视觉回归，当前版本保留了覆盖率提升带来的取舍。',
  },
  {
    id: 'leaf-attachment',
    phase: '03 · 植物器官',
    title: '枝叶持久性与叶柄连接',
    owner: '植物形态 · 还原评估',
    status: 'done',
    progress: 100,
    updatedAt: '2026-11-10 20:56',
    summary: '实拍重建的 77 片悬空叶已重新挂接；R7.1 进一步修复 430 个叶网格的内部分面法线。位置、叶柄与木质节点保持不变。这是静态资产修复，不表示已验证整株生长历史。',
    evidence: [
      { label: '五账号派发记录', href: 'https://raconiy.github.io/westlake-flora-lab/capture17/scene-r7/dispatch/index.html', kind: 'dispatch' },
      { label: '下载源工程', href: 'https://github.com/raconiy/westlake-flora-lab/releases/download/yungu-capture17-v7/yungu-campus-scene-source-v7.zip', kind: 'release' },
    ],
    metrics: [
      { label: '修复叶网格', value: '430' },
      { label: '原有顶点移动', value: '0' },
      { label: '木质节点移动', value: '0' },
    ],
  },
  {
    id: 'bark-material',
    phase: '04 · 材质与光照',
    title: '树皮纹理与叶面连续受光',
    owner: '材质与光照',
    status: 'done',
    progress: 100,
    updatedAt: '2026-11-10 20:18',
    summary: '前景树皮改为原生分辨率采样并启用各向异性过滤，保留纵向纹理；反照率和背面/分叉仍标注为估计值。',
    evidence: [
      { label: 'R7 场景', href: 'https://raconiy.github.io/westlake-flora-lab/#reconstruction', kind: 'site' },
      { label: '源工程发布', href: 'https://github.com/raconiy/westlake-flora-lab/releases/tag/yungu-capture17-v7', kind: 'release' },
    ],
    metrics: [
      { label: '纹理过滤', value: '各向异性 ×8' },
      { label: '主干变换', value: '字节级保持' },
      { label: '发布提交', value: '1a5b58e3' },
    ],
  },
  {
    id: 'biology-calibration',
    phase: '05 · 生长与物理',
    title: '生长阶段、根系与力学参数校准',
    owner: '生长与物候 · 枝叶力学',
    status: 'active',
    progress: 48,
    updatedAt: '2026-11-11 05:56',
    summary: '保留持久节点、重力下垂、风动和根区窗口；下一轮需要校园实测胸径、树高、根区土层与枝条曲率来替换工程先验。',
    evidence: [
      { label: '公网生长实验室', href: 'https://raconiy.github.io/westlake-flora-lab/#lab', kind: 'site' },
      { label: '五账号协作记录', href: 'https://raconiy.github.io/westlake-flora-lab/capture17/scene-r7/dispatch/index.html', kind: 'dispatch' },
    ],
    metrics: [
      { label: '模型参数', value: '可调、可保存' },
      { label: '风场', value: '世界空间共享' },
      { label: '实测校准', value: '待采集' },
    ],
    blocker: '现场测量尚未接入；当前参数属于文献约束 + 工程先验，不能称为完全真实。',
  },
  {
    id: 'next-refine',
    phase: '06 · 下一轮派发',
    title: '继续修复冠形、草地与接地',
    owner: '任务协调 · 交互设计',
    status: 'active',
    progress: 0,
    updatedAt: '2026-11-11',
    summary: '把当前最明显的三类缺陷拆成可复现任务：树枝曲率与冠形、草叶覆盖密度、根—干—地面接触。每项都绑定对照图、几何指标和回归测试；失败任务保留，未经验收不标记完成。',
    evidence: [
      { label: '进入协作中枢', href: 'https://raconiy.github.io/westlake-flora-lab/#swarm', kind: 'site' },
      { label: '查看本轮修复与真实派发记录', href: 'https://raconiy.github.io/westlake-flora-lab/capture17/refine-20261111/index.html', kind: 'dispatch' },
    ],
    metrics: [
      { label: '分派规则', value: '建议→任务→验证' },
      { label: '本轮缺陷', value: '冠形 / 草地 / 接地' },
      { label: '失败记录', value: '保留' },
      { label: '公开口径', value: '证据优先' },
    ],
  },
];
