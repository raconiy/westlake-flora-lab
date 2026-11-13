/* Standalone, same-origin scene viewer. Three.js r180 is supplied by the host. */
const $ = (id) => document.getElementById(id);
const ui = {
  workspace: $('workspace'), stage: $('stage'), host: $('canvas-host'),
  assetList: $('asset-list'), search: $('asset-search'), count: $('asset-count'),
  loadCard: $('load-card'), loadTitle: $('load-title'), loadDetail: $('load-detail'),
  progress: $('load-progress'), status: $('scene-status'), selection: $('selection-card'),
  video: $('reference-video'), fallback: $('reference-fallback'), videoError: $('video-error'),
};
const categories = { buildings: '建筑', plants: '植物', ground: '地面', facilities: '设施', other: '其他' };
const aliases = {
  building: 'buildings', architecture: 'buildings', 建筑: 'buildings',
  plant: 'plants', vegetation: 'plants', tree: 'plants', trees: 'plants', 植物: 'plants', 绿化: 'plants',
  terrain: 'ground', landscape: 'ground', road: 'ground', 地面: 'ground',
  facility: 'facilities', furniture: 'facilities', props: 'facilities', 设施: 'facilities',
};
const state = {
  manifest: null, manifestError: '', assets: [], category: 'all', selected: null,
  isolated: null, visibilitySnapshot: null, ready: false, sceneRoot: null,
  objectAssets: new WeakMap(), presets: [], activePreset: 0,
  localVideoURL: null,
  sourceWidth: 544, sourceHeight: 960, pointerDown: null,
};
let THREE, renderer, scene, camera, controls, raycaster, ground, sun, bounds, sceneScale = 1;
let toastTimer, animationFrame, resizeObserver, destroyed = false;
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const mobileLayout = window.matchMedia('(max-width: 640px)');

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function safeURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, document.baseURI);
    return url.origin === location.origin && /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

function categoryOf(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return categories[key] ? key : aliases[key] || 'other';
}

function message(error) {
  if (error?.target && Number.isFinite(error.target.status)) {
    return error.target.status ? `HTTP ${error.target.status} ${error.target.statusText || ''}`.trim() : '网络请求失败或文件不可访问';
  }
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function toast(text) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

function setLoading(title, detail, value) {
  ui.loadTitle.textContent = title;
  ui.loadDetail.textContent = detail;
  if (Number.isFinite(value)) {
    ui.progress.max = 100;
    ui.progress.value = Math.min(100, Math.max(0, value));
  } else ui.progress.removeAttribute('value');
}

function loadFailure(title, detail) {
  state.ready = false;
  ui.loadCard.hidden = false;
  ui.loadCard.classList.add('failed');
  setLoading(title, detail);
  $('retry-load').hidden = false;
  ui.status.textContent = '三维场景暂不可用 · 实拍参考可独立查看';
}

function setAssetsExpanded(expanded) {
  ui.workspace.classList.toggle('assets-collapsed', !expanded);
  $('toggle-assets').setAttribute('aria-expanded', String(expanded));
  if (!expanded && $('asset-panel').contains(document.activeElement)) $('toggle-assets').focus();
  requestAnimationFrame(resize);
}

function setLayout(layout) {
  ui.workspace.classList.toggle('compare-layout', layout === 'compare');
  document.querySelectorAll('[data-layout]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
  });
  if (layout === 'compare' && window.innerWidth <= 960) setAssetsExpanded(false);
  requestAnimationFrame(resize);
}

function renderAssetList() {
  const focused = document.activeElement;
  const focusedRow = focused?.closest?.('.asset-row');
  const focusId = focusedRow?.dataset.assetId;
  const focusType = focused?.className === 'asset-download' ? 'download' : focused?.type === 'checkbox' ? 'check' : 'select';
  const scrollTop = ui.assetList.scrollTop;
  let restoreFocus;
  const query = ui.search.value.trim().toLocaleLowerCase();
  ui.assetList.replaceChildren();
  const filtered = state.assets.filter((asset) =>
    (state.category === 'all' || asset.category === state.category) &&
    `${asset.name} ${asset.id} ${categories[asset.category]}`.toLocaleLowerCase().includes(query));
  ui.count.textContent = String(state.assets.length);
  ui.count.title = `共 ${state.assets.length} 项资产；当前筛选 ${filtered.length} 项`;
  if (state.manifestError) {
    ui.assetList.append(node('p', 'list-message error', state.manifestError));
  }
  if (!filtered.length) {
    ui.assetList.append(node('p', 'list-message', state.assets.length ? '没有匹配的资产，试试其他名称或类别。' : '暂无可用资产条目。场景就绪后将尝试读取 GLB 资产节点。'));
  }
  for (const asset of filtered) {
    const row = node('div', 'asset-row');
    row.dataset.assetId = asset.id;
    row.classList.toggle('selected', state.selected === asset);
    row.classList.toggle('is-hidden', !asset.visible);
    const label = node('label', 'asset-check');
    const check = node('input');
    check.type = 'checkbox';
    check.checked = asset.visible;
    check.disabled = !state.ready || !asset.roots.length;
    check.setAttribute('aria-label', `显示${asset.name}`);
    check.addEventListener('change', () => {
      const visible = check.checked;
      restoreIsolationSnapshot();
      setAssetVisible(asset, visible);
      if (!asset.visible && state.selected === asset) selectAsset(null);
      renderAssetList();
    });
    label.append(check);
    const select = node('button', 'asset-select');
    select.type = 'button';
    select.disabled = !state.ready || !asset.roots.length;
    select.setAttribute('aria-pressed', String(state.selected === asset));
    select.title = asset.roots.length ? `选择并定位：${asset.name}` : '尚未找到对应场景节点';
    const symbol = node('span', 'asset-symbol');
    symbol.append(icon('cube'));
    const copy = node('span', 'asset-copy');
    copy.append(node('span', 'asset-name', asset.name));
    copy.append(node('span', 'asset-type', `${categories[asset.category]}${state.ready && !asset.roots.length ? ' · 未关联' : ''}`));
    select.append(symbol, copy);
    select.addEventListener('click', () => {
      if (state.isolated && state.isolated !== asset) restoreIsolationSnapshot();
      if (!asset.visible) setAssetVisible(asset, true);
      selectAsset(asset, true);
      if (mobileLayout.matches) setAssetsExpanded(false);
    });
    row.append(label, select);
    const assetURL = safeURL(asset.file);
    if (assetURL) {
      const download = node('a', 'asset-download');
      download.href = assetURL;
      download.download = '';
      download.title = `下载 ${asset.name} · GLB`;
      download.setAttribute('aria-label', `下载${asset.name}的独立 GLB`);
      download.append(icon('download'));
      row.append(download);
      if (focusId === asset.id && focusType === 'download') restoreFocus = download;
    }
    if (focusId === asset.id && focusType !== 'download') restoreFocus = focusType === 'check' ? check : select;
    ui.assetList.append(row);
  }
  ui.assetList.scrollTop = scrollTop;
  restoreFocus?.focus({ preventScroll: true });
  $('restore-assets').disabled = !state.ready || !state.assets.some((asset) => asset.roots.length);
}

function normalizeAsset(asset, index, used) {
  if (!asset || typeof asset !== 'object') return null;
  let id = String(asset.id ?? `asset-${index + 1}`);
  if (used.has(id)) id = `${id}-${index + 1}`;
  used.add(id);
  return {
    id, name: typeof asset.name === 'string' ? asset.name : id,
    category: categoryOf(asset.category), file: typeof asset.file === 'string' ? asset.file : '',
    objectName: typeof asset.objectName === 'string' ? asset.objectName : '',
    roots: [], visible: true,
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '实拍视频';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

async function loadManifest() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('./assets-manifest.json', { cache: 'no-cache', credentials: 'same-origin', redirect: 'error', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('清单格式不是对象');
    state.manifest = data;
    if (typeof data.scene_id === 'string') $('scene-id').textContent = data.scene_id;
    if (typeof data.title === 'string') document.title = `${data.title} | Real2Sim CG 对比`;
    const used = new Set();
    state.assets = Array.isArray(data.assets) ? data.assets.map((asset, index) => normalizeAsset(asset, index, used)).filter(Boolean) : [];
    const source = data.source;
    if (source && typeof source === 'object') {
      if (Number.isFinite(source.width) && source.width > 0 && Number.isFinite(source.height) && source.height > 0) {
        state.sourceWidth = source.width;
        state.sourceHeight = source.height;
        const dimensions = `${source.width} × ${source.height}`;
        $('source-size').textContent = dimensions;
        $('footer-input').textContent = dimensions;
        $('reference-media').style.aspectRatio = `${source.width} / ${source.height}`;
      }
      if (Number.isFinite(source.duration) && source.duration >= 0 && !Number.isFinite(ui.video.duration)) {
        $('source-duration').textContent = formatDuration(source.duration);
      }
      // The contracted reference.mp4 is authoritative; source.video is descriptive metadata.
    }
    const notes = Array.isArray(data.notes) ? data.notes.filter((note) => typeof note === 'string') : [];
    if (typeof data.status === 'string' && data.status) notes.push(`清单状态：${data.status}`);
    if (notes.length) {
      $('manifest-notes').replaceChildren(...notes.map((note) => node('li', '', note)));
    }
  } catch (error) {
    const detail = controller.signal.aborted ? '请求超过 12 秒，已停止等待' : message(error);
    state.manifestError = `资产清单暂不可用（${detail}）。GLB 场景将独立加载。`;
  } finally {
    clearTimeout(timeout);
  }
  renderAssetList();
}

async function createEngine() {
  const modules = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js'), import('three/addons/loaders/GLTFLoader.js'),
  ]);
  THREE = modules[0];
  const { OrbitControls } = modules[1];
  const { GLTFLoader } = modules[2];
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#cbd8df');
  camera = new THREE.PerspectiveCamera(43, 1, 0.1, 10000);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  new THREE.TextureLoader().load('./environment.jpg', (texture) => {
    if (destroyed) { texture.dispose(); return; }
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(texture).texture;
    scene.background = texture;
    scene.environmentIntensity = 0.75;
    scene.backgroundBlurriness = 0.035;
    pmrem.dispose();
  });
  renderer.shadowMap.enabled = true;
  $('shadows').checked = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', '三维重建场景；拖动旋转，滚轮缩放，右键平移');
  renderer.domElement.setAttribute('tabindex', '0');
  ui.host.append(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.maxPolarAngle = Math.PI / 2 - 0.012;
  controls.enablePan = true;
  controls.addEventListener('start', () => markPreset(-1));
  raycaster = new THREE.Raycaster();

  // Broad, neutral fill with a warm key and gentle cool fill, without hemisphere tint.
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  sun = new THREE.DirectionalLight(0xfff9ef, 2.1);
  sun.position.set(-60, 110, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.00008;
  sun.shadow.blurSamples = 8;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xe8f0ff, 0.4);
  fill.position.set(50, 35, -60);
  scene.add(fill);

  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    cancelAnimationFrame(animationFrame);
    state.ready = false;
    ['reset-view', 'capture-view', 'shadows'].forEach((id) => { $(id).disabled = true; });
    loadFailure('图形上下文已中断', '浏览器暂时释放了 GPU 资源。请重新加载场景。');
    ui.stage.classList.remove('ready');
    renderAssetList();
  });
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(ui.host);
  renderer.domElement.addEventListener('pointerdown', (event) => {
    state.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId, button: event.button };
  });
  renderer.domElement.addEventListener('pointerup', pick);
  renderer.domElement.addEventListener('pointercancel', () => { state.pointerDown = null; });
  renderer.domElement.addEventListener('keydown', (event) => {
    if (event.target !== renderer.domElement) return;
    if (event.key === 'Escape') selectAsset(null);
    if (event.key.toLowerCase() === 'r' || event.key === 'Home') {
      event.preventDefault();
      applyPreset(0);
    }
  });
  resize();
  animate();
  return GLTFLoader;
}

function resize() {
  if (!renderer || !camera || destroyed) return;
  const width = Math.max(1, ui.host.clientWidth);
  const height = Math.max(1, ui.host.clientHeight);
  const aspect = width / height;
  if (renderer.domElement.width !== Math.round(width * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
  }
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function animate() {
  if (destroyed) return;
  animationFrame = requestAnimationFrame(animate);
  if (document.hidden) return;
  controls.update();
  renderer.render(scene, camera);
}

function validBox(box) {
  return box && !box.isEmpty() && [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite);
}

async function loadScene(GLTFLoader) {
  setLoading('正在载入 CG 场景', '请求 scene.glb，等待文件大小…');
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    // Embedded glTF resources and decoder blobs are local. Forbid remote asset requests.
    if (/^(data:|blob:)/i.test(url)) return url;
    const localURL = safeURL(url);
    if (!localURL) throw new Error('场景引用了非同源资源，已停止加载');
    return localURL;
  });
  const missingResources = [];
  manager.onError = (url) => { missingResources.push(String(url)); };
  const loader = new GLTFLoader(manager);
  const { DRACOLoader } = await import('./vendor/DRACOLoader.js');
  const draco = new DRACOLoader(manager).setDecoderPath('./vendor/draco/').setWorkerLimit(2);
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync('./scene.glb', (event) => {
    if (event.lengthComputable && event.total > 0) {
      const percent = event.loaded / event.total * 100;
      setLoading(percent >= 100 ? '正在解析三维资产' : '正在载入 CG 场景', `${(event.loaded / 1048576).toFixed(1)} / ${(event.total / 1048576).toFixed(1)} MB · ${Math.floor(percent)}%`, percent);
    } else {
      setLoading('正在载入 CG 场景', `${(event.loaded / 1048576).toFixed(1)} MB 已接收 · 文件总大小未知`);
    }
  });
  draco.dispose();
  if (destroyed) return;
  state.sceneRoot = gltf.scene;
  state.sceneRoot.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(state.sceneRoot);
  if (!validBox(bounds)) throw new Error('scene.glb 中没有可用于取景的有效几何体');
  const size = bounds.getSize(new THREE.Vector3());
  sceneScale = Math.max(size.x, size.y, size.z, 0.001);
  const center = bounds.getCenter(new THREE.Vector3());
  state.sceneRoot.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    // Keep authored glTF materials and texture color spaces intact.
  });
  scene.add(state.sceneRoot);
  configureEnvironment(center, size);
  bindAssets();
  // Thin pavers and turf receive tree/building shadows without casting self-shadow acne.
  for (const asset of state.assets) {
    if (asset.category === 'ground') for (const root of asset.roots) root.traverse((object) => {
      if (object.isMesh) object.castShadow = false;
    });
  }
  createPresets();
  state.ready = true;
  applyPreset(0);
  ui.stage.classList.add('ready');
  ui.loadCard.hidden = true;
  ['reset-view', 'capture-view', 'shadows'].forEach((id) => { $(id).disabled = false; });
  renderAssetList();
  const linked = state.assets.filter((asset) => asset.roots.length).length;
  ui.status.textContent = `场景已加载${linked ? ` · ${linked} 项资产可检查` : ''}${missingResources.length ? ' · 存在缺失资源' : ''}`;
  if (missingResources.length) toast('场景部分纹理或资源未能载入，当前画面可能不完整。');
}

function configureEnvironment(center, size) {
  // Retain the Blender-exported Y-up transform. The support plane sits below the authored ground.
  const span = Math.max(size.x, size.z, sceneScale * 0.4);
  ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 10, span * 10), new THREE.MeshStandardMaterial({ color: '#aab1a1', roughness: 1, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, bounds.min.y - sceneScale * 0.0015, center.z);
  ground.receiveShadow = true;
  ground.name = '__viewer_support_ground';
  scene.add(ground);
  scene.fog = new THREE.Fog('#d9e0dc', sceneScale * 4, sceneScale * 18);
  sun.position.copy(center).add(new THREE.Vector3(-0.5, 1.1, 0.65).multiplyScalar(sceneScale));
  sun.target.position.copy(center);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = shadowCamera.bottom = -sceneScale * 0.65;
  shadowCamera.right = shadowCamera.top = sceneScale * 0.65;
  shadowCamera.near = sceneScale * 0.01;
  shadowCamera.far = sceneScale * 4;
  shadowCamera.updateProjectionMatrix();
  sun.shadow.normalBias = sceneScale * 0.00025;
  camera.near = Math.max(sceneScale / 20000, 0.001);
  camera.far = sceneScale * 100;
  camera.updateProjectionMatrix();
  controls.minDistance = sceneScale * 0.012;
  controls.maxDistance = sceneScale * 5;
}

function bindAssets() {
  const root = state.sceneRoot;
  const byId = new Map(state.assets.map((asset) => [asset.id, asset]));
  const byName = new Map(state.assets.map((asset) => [asset.name, asset]));
  const byObject = new Map(state.assets.filter((asset) => asset.objectName).map((asset) => [asset.objectName, asset]));
  const used = new Set(state.assets.map((asset) => asset.id));
  root.traverse((object) => {
    const metadata = object.userData || {};
    const explicitId = metadata.asset_id === undefined ? null : String(metadata.asset_id);
    const metadataName = typeof metadata.name === 'string' ? metadata.name : '';
    let asset = (explicitId && byId.get(explicitId)) || byObject.get(object.name) ||
      (metadataName && (byName.get(metadataName) || byId.get(metadataName))) || byName.get(object.name) || byId.get(object.name);
    if (!asset && explicitId) {
      asset = normalizeAsset({ id: explicitId, name: metadataName || object.name || explicitId, category: metadata.category }, state.assets.length, used);
      state.assets.push(asset);
      byId.set(explicitId, asset);
      byName.set(asset.name, asset);
    }
    if (asset) {
      asset.roots.push(object);
      state.objectAssets.set(object, asset);
    }
  });
  if (!state.assets.length) {
    // No manifest or asset metadata: expose actual exported top-level geometric nodes.
    const candidates = root.children.filter((object) => {
      let mesh = false;
      object.traverse((child) => { if (child.isMesh) mesh = true; });
      return mesh;
    });
    for (const object of candidates) {
      const asset = normalizeAsset({ id: object.uuid, name: object.name || '未命名场景节点', category: object.userData?.category }, state.assets.length, used);
      asset.roots.push(object);
      state.assets.push(asset);
      state.objectAssets.set(object, asset);
    }
  }
  for (const asset of state.assets) {
    const rootSet = new Set(asset.roots);
    asset.roots = asset.roots.filter((object) => {
      for (let parent = object.parent; parent && parent !== root.parent; parent = parent.parent) {
        if (rootSet.has(parent)) return false;
      }
      return true;
    });
    asset.visible = asset.roots.length ? asset.roots.some((object) => object.visible) : true;
  }
}

function fitView(box, direction, padding = 1.18) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, sceneScale * 0.01);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const distance = radius / Math.sin(limitingFov / 2) * padding;
  return { position: center.clone().add(direction.clone().normalize().multiplyScalar(distance)), target: center };
}

function createPresets() {
  const vector = (values) => Array.isArray(values) && values.length === 3 && values.every(Number.isFinite);
  const views = Array.isArray(state.manifest?.views) ? state.manifest.views.filter((view) =>
    view && vector(view.position) && vector(view.target) &&
    new THREE.Vector3(...view.position).distanceToSquared(new THREE.Vector3(...view.target)) > 1e-10) : [];
  // Supplied positions use the same Y-up world coordinates as the exported GLB.
  state.presets = views.slice(0, 4).map((view, index) => ({
    name: typeof view.name === 'string' ? view.name : `视角 ${index + 1}`,
    position: new THREE.Vector3(...view.position), target: new THREE.Vector3(...view.target), supplied: true,
  }));
  const defaults = [
    { name: '主视角', direction: new THREE.Vector3(0.9, 0.58, 1.25) },
    { name: '庭院侧览', direction: new THREE.Vector3(-1.1, 0.48, 0.85) },
    { name: '鸟瞰', direction: new THREE.Vector3(0.4, 1.6, 0.65) },
  ];
  while (state.presets.length < 3) {
    const fallback = defaults[state.presets.length];
    state.presets.push({ ...fallback, ...fitView(bounds, fallback.direction), supplied: false });
  }
  $('view-presets').replaceChildren();
  state.presets.forEach((preset, index) => {
    const button = node('button', '', preset.name);
    button.type = 'button';
    button.title = preset.supplied ? '场景清单提供的视角；未声明与实拍标定对齐' : '依据场景包围盒自动取景';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => applyPreset(index));
    $('view-presets').append(button);
  });
  const free = node('button', '', '自由');
  free.type = 'button';
  free.title = '保持当前相机，可自由旋转、缩放和平移';
  free.setAttribute('aria-pressed', 'false');
  free.addEventListener('click', () => { markPreset(-1); toast(coarsePointer ? '单指旋转，双指缩放或平移。' : '拖动旋转，滚轮缩放，右键平移。'); });
  $('view-presets').append(free);
}

function markPreset(index) {
  state.activePreset = index;
  [...$('view-presets').children].forEach((button, buttonIndex) => {
    button.setAttribute('aria-pressed', String(index === -1 ? buttonIndex === state.presets.length : buttonIndex === index));
  });
}

function applyPreset(index) {
  if (!state.ready) return;
  const preset = state.presets[index];
  if (!preset) return;
  // Recalculate automatic framing for narrow or fullscreen viewports.
  const view = preset.supplied ? preset : fitView(bounds, preset.direction);
  setCamera(view.position, view.target);
  markPreset(index);
}

function setCamera(position, target) {
  controls.enabled = false;
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update(); // Flush any drag inertia before applying a supplied camera pose.
  camera.position.copy(position);
  controls.target.copy(target);
  const distance = camera.position.distanceTo(target);
  controls.maxDistance = Math.max(sceneScale * 5, distance * 2);
  controls.minDistance = Math.min(sceneScale * 0.012, distance * 0.5);
  // Let valid supplied views below the usual orbit limit display without clamping.
  const polar = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target)).phi;
  controls.maxPolarAngle = Math.max(Math.PI / 2 - 0.012, polar + 0.001);
  camera.lookAt(target);
  controls.update();
  controls.enableDamping = damping;
  controls.enabled = true;
}

function assetBox(asset) {
  const box = new THREE.Box3();
  for (const root of asset.roots) box.union(new THREE.Box3().setFromObject(root));
  return validBox(box) ? box : null;
}

let highlight;
function selectAsset(asset, focus = false) {
  state.selected = asset;
  if (highlight) {
    scene.remove(highlight);
    highlight.geometry.dispose();
    highlight.material.dispose();
    highlight = null;
  }
  ui.selection.hidden = !asset;
  if (asset) {
    $('selected-name').textContent = asset.name;
    $('selected-category').textContent = categories[asset.category];
    $('isolate-asset').textContent = state.isolated === asset ? '退出隔离' : '仅显示此项';
    const box = assetBox(asset);
    if (box) {
      highlight = new THREE.Box3Helper(box, 0xb7c991);
      highlight.material.depthTest = false;
      highlight.material.transparent = true;
      highlight.material.opacity = 0.7;
      highlight.renderOrder = 10;
      scene.add(highlight);
      if (focus) {
        const direction = camera.position.clone().sub(controls.target).normalize();
        const view = fitView(box, direction, 1.5);
        setCamera(view.position, view.target);
        markPreset(-1);
      }
    }
  }
  renderAssetList();
}

function pick(event) {
  const start = state.pointerDown;
  state.pointerDown = null;
  if (!state.ready || !start || event.pointerId !== start.id || start.button !== 0 ||
    Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 || performance.now() - start.time > 700) return;
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const hits = raycaster.intersectObject(state.sceneRoot, true).filter((hit) => {
    for (let object = hit.object; object; object = object.parent) if (!object.visible) return false;
    return true;
  });
  for (const hit of hits) {
    for (let object = hit.object; object && object !== scene; object = object.parent) {
      const asset = state.objectAssets.get(object);
      if (asset) { selectAsset(asset); return; }
    }
    // The first visible surface occludes objects behind it, even if it is not an asset.
    break;
  }
  selectAsset(null);
}

function setAssetVisible(asset, visible) {
  asset.visible = visible;
  asset.roots.forEach((root) => { root.visible = visible; });
}

function endIsolation() {
  state.isolated = null;
  state.visibilitySnapshot = null;
  $('isolate-asset').textContent = '仅显示此项';
}

function restoreIsolationSnapshot() {
  if (!state.isolated) return;
  for (const asset of state.assets) setAssetVisible(asset, state.visibilitySnapshot?.get(asset.id) ?? true);
  endIsolation();
}

function restoreVisibility() {
  for (const asset of state.assets) setAssetVisible(asset, true);
  endIsolation();
  renderAssetList();
}

function toggleIsolation() {
  const selected = state.selected;
  if (!selected || !state.ready) return;
  if (state.isolated === selected) {
    restoreIsolationSnapshot();
  } else {
    if (!state.isolated) state.visibilitySnapshot = new Map(state.assets.map((asset) => [asset.id, asset.visible]));
    state.isolated = selected;
    for (const asset of state.assets) setAssetVisible(asset, asset === selected);
    // Nested asset roots need their ancestors visible to be rendered.
    for (const root of selected.roots) {
      for (let parent = root.parent; parent && parent !== scene; parent = parent.parent) parent.visible = true;
    }
    $('isolate-asset').textContent = '退出隔离';
  }
  renderAssetList();
}

function showVideoError(text) {
  ui.videoError.textContent = text;
  ui.videoError.hidden = false;
  ui.video.hidden = true;
  ui.fallback.hidden = false;
  if (ui.fallback.complete && !ui.fallback.naturalWidth) {
    showReferenceEmpty();
  }
}

function showReferenceEmpty() {
  ui.fallback.hidden = true;
  $('reference-empty').hidden = false;
  ui.videoError.textContent = state.localVideoURL ? '本地视频无法播放，原始参考截图也暂不可用。请尝试其他视频。' : '参考视频与截图暂不可用。可选择本地视频进行对照。';
  ui.videoError.hidden = false;
}

function prepareVideo() {
  ui.videoError.hidden = true;
  ui.fallback.hidden = true;
  $('reference-empty').hidden = true;
  ui.video.hidden = false;
}

function setupReference() {
  ui.video.addEventListener('error', () => {
    if (ui.video.error?.code === 1) return;
    showVideoError(state.localVideoURL ? '本地视频无法解码，请选择浏览器支持的 MP4 或 WebM。' : 'reference.mp4 暂不可用或格式不受支持，已切换至参考截图。');
  });
  const source = ui.video.querySelector('source');
  source?.addEventListener('error', () => {
    if (!state.localVideoURL) showVideoError('reference.mp4 暂不可用或格式不受支持，已切换至参考截图。');
  });
  ui.fallback.addEventListener('error', () => {
    if (ui.video.hidden) showReferenceEmpty();
  });
  ui.video.addEventListener('loadedmetadata', () => {
    prepareVideo();
    $('source-duration').textContent = formatDuration(ui.video.duration);
    if (ui.video.videoWidth && ui.video.videoHeight) {
      $('source-size').textContent = `${ui.video.videoWidth} × ${ui.video.videoHeight}${state.localVideoURL ? ' · 本地' : ''}`;
    }
  });
  $('local-video').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type && !file.type.startsWith('video/')) {
      toast('请选择视频文件。');
      event.target.value = '';
      return;
    }
    ui.video.pause();
    if (state.localVideoURL) URL.revokeObjectURL(state.localVideoURL);
    state.localVideoURL = URL.createObjectURL(file);
    prepareVideo();
    ui.video.src = state.localVideoURL;
    ui.video.load();
    $('local-file-note').textContent = `${file.name} · 仅本地播放，未上传`;
    $('revert-video').hidden = false;
    $('source-duration').textContent = '正在读取';
    event.target.value = '';
  });
  $('revert-video').addEventListener('click', () => {
    ui.video.pause();
    ui.video.removeAttribute('src');
    if (state.localVideoURL) URL.revokeObjectURL(state.localVideoURL);
    state.localVideoURL = null;
    prepareVideo();
    ui.video.load();
    $('source-size').textContent = `${state.sourceWidth} × ${state.sourceHeight}`;
    $('source-duration').textContent = formatDuration(state.manifest?.source?.duration);
    $('local-file-note').textContent = '仅在此浏览器播放，不上传文件。';
    $('revert-video').hidden = true;
  });
  // Media errors can precede execution of a module script.
  if (ui.video.error || source?.networkState === 3 || ui.video.networkState === 3) {
    showVideoError('reference.mp4 暂不可用或格式不受支持，已切换至参考截图。');
  }
  if (ui.video.readyState >= 1) {
    $('source-duration').textContent = formatDuration(ui.video.duration);
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (ui.stage.requestFullscreen) await ui.stage.requestFullscreen();
    else toast('此浏览器不支持场景全屏，可横屏查看。');
  } catch { toast('暂时无法进入全屏，请重试或使用浏览器全屏。'); }
}

function capture() {
  if (!state.ready) return;
  try {
    // Render immediately before capture; preserveDrawingBuffer is intentionally off.
    renderer.render(scene, camera);
    renderer.domElement.toBlob((blob) => {
      if (!blob) { toast('画面保存失败，请重试。'); return; }
      const url = URL.createObjectURL(blob);
      const download = node('a');
      download.href = url;
      const id = String(state.manifest?.scene_id || 'scene-20261113').replace(/[^a-zA-Z0-9_-]/g, '_');
      download.download = `${id}-agent-a-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      toast('已保存当前 3D 画面，不含参考视频与界面。');
    }, 'image/png');
  } catch (error) { toast(`无法保存画面：${message(error)}`); }
}

function setupUI() {
  document.querySelectorAll('[data-layout]').forEach((button) => {
    button.addEventListener('click', () => setLayout(button.dataset.layout));
  });
  $('toggle-assets').addEventListener('click', () => setAssetsExpanded(ui.workspace.classList.contains('assets-collapsed')));
  $('close-assets').addEventListener('click', () => setAssetsExpanded(false));
  if (mobileLayout.matches) setAssetsExpanded(false);
  ui.search.addEventListener('input', renderAssetList);
  document.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.category = button.dataset.category;
      document.querySelectorAll('[data-category]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      renderAssetList();
    });
  });
  $('restore-assets').addEventListener('click', restoreVisibility);
  $('clear-selection').addEventListener('click', () => selectAsset(null));
  $('isolate-asset').addEventListener('click', toggleIsolation);
  $('reset-view').addEventListener('click', () => { selectAsset(null); applyPreset(0); });
  $('fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '场景全屏');
    $('fullscreen').title = document.fullscreenElement ? '退出全屏' : '场景全屏';
    $('toggle-assets').disabled = Boolean(document.fullscreenElement);
    $('toggle-assets').title = document.fullscreenElement ? '退出全屏后可打开资产列表' : '资产列表';
    requestAnimationFrame(resize);
  });
  $('capture-view').addEventListener('click', capture);
  $('shadows').addEventListener('change', (event) => {
    if (!renderer) return;
    renderer.shadowMap.enabled = event.target.checked;
    // Light shadow defines are compiled into materials; force an update after toggling.
    scene.traverse((object) => {
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => { material.needsUpdate = true; });
    });
  });
  $('retry-load').addEventListener('click', () => location.reload());
  $('overview-image').addEventListener('error', () => { $('overview-image').hidden = true; });
  $('toggle-notes').addEventListener('click', () => {
    const expanded = $('toggle-notes').getAttribute('aria-expanded') !== 'true';
    $('toggle-notes').setAttribute('aria-expanded', String(expanded));
    $('toggle-notes').lastElementChild.textContent = expanded ? '－' : '＋';
    $('scene-notes').hidden = !expanded;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selected) selectAsset(null);
  });
  window.addEventListener('resize', resize, { passive: true });
  if (coarsePointer) $('orbit-hint').textContent = '单指旋转 · 双指缩放 / 平移';
}

async function boot() {
  setupUI();
  setupReference();
  // Failure of the manifest must never block the renderer or video controls.
  const [manifestResult, engineResult] = await Promise.allSettled([loadManifest(), createEngine()]);
  if (manifestResult.status === 'rejected') {
    state.manifestError = `清单解析失败：${message(manifestResult.reason)}`;
    renderAssetList();
  }
  if (engineResult.status === 'rejected') {
    loadFailure('三维引擎未能启动', `请确认 vendor 目录包含 Three.js r180 及配套模块，并使用支持 WebGL 2 的浏览器。${message(engineResult.reason)}`);
    return;
  }
  try {
    await loadScene(engineResult.value);
  } catch (error) {
    const detail = message(error);
    loadFailure('三维场景加载失败', `请确认 scene.glb 与场景资源可访问。${detail.includes('404') ? '服务器未找到文件（404）。' : detail}`);
    renderAssetList();
  }
}

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  destroyed = true;
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  controls?.dispose();
  renderer?.dispose();
  if (state.localVideoURL) URL.revokeObjectURL(state.localVideoURL);
});

boot().catch((error) => loadFailure('查看器启动失败', message(error)));
