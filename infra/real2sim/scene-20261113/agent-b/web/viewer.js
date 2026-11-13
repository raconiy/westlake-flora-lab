// Agent B (Claude Opus 5.5) — standalone viewer for the editable video-to-CG scene.
// Loads manifest.json (assets, instances, reference cameras) and every asset as its own glTF.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = new URL('./', import.meta.url);
const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const url = (p) => new URL(p, BASE).href;

let manifest;
try { manifest = await fetch(url('manifest.json'), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }); }
catch (e) { status('场景清单读取失败：' + e.message); throw e; }

// ---------- renderer / scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = manifest.lighting.web_exposure ?? 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;

const sky = await new THREE.TextureLoader().loadAsync(url(manifest.lighting.sky_image));
sky.mapping = THREE.EquirectangularReflectionMapping; sky.colorSpace = THREE.SRGBColorSpace;
scene.background = sky; scene.environment = sky;
// Blender equirect u = atan2(y,-x) vs three u = atan2(z,x) (glTF axes): a 180 deg yaw apart
scene.backgroundRotation.set(0, Math.PI, 0); scene.environmentRotation.set(0, Math.PI, 0);
scene.environmentIntensity = manifest.lighting.env_intensity ?? 1.0;
const sd = new THREE.Vector3(...manifest.lighting.sun_dir_gltf).normalize();
const sun = new THREE.DirectionalLight(0xfff6ea, manifest.lighting.sun_intensity ?? 1.4);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
const sc = sun.shadow.camera; sc.left = -170; sc.right = 170; sc.top = 170; sc.bottom = -170; sc.near = 1; sc.far = 900;
scene.add(sun, sun.target);
const center = new THREE.Vector3(...manifest.scene_center_gltf);
sun.target.position.copy(center); sun.position.copy(center).addScaledVector(sd, 400);

// ---------- groups / assets ----------
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const catGroups = {}; const instances = new Map(); // instance_id -> {root, inst}
for (const c of manifest.categories) { const g = new THREE.Group(); g.name = c.id; scene.add(g); catGroups[c.id] = g; }
const assetCache = new Map();
async function loadAsset(aid) {
  if (!assetCache.has(aid)) assetCache.set(aid, loader.loadAsync(url(manifest.assets[aid].file)).then((g) => {
    g.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const m = o.material; if (m && m.alphaTest > 0) { m.side = THREE.DoubleSide; m.alphaToCoverage = true; }
        if (m && /glass/.test(m.name)) { m.envMapIntensity = 1.5; }
      }
    });
    return g.scene;
  }));
  return assetCache.get(aid);
}
function place(inst, src) {
  const root = src.clone(true);
  root.name = inst.instance_id; root.userData = { instance_id: inst.instance_id, asset_id: inst.asset_id };
  root.position.fromArray(inst.position_gltf);
  root.rotation.set(...inst.rotation_gltf_euler_deg.map(THREE.MathUtils.degToRad), 'XYZ');
  root.scale.fromArray(inst.scale);
  catGroups[inst.category].add(root); instances.set(inst.instance_id, { root, inst });
  root.traverse((o) => { o.userData.instance_id = inst.instance_id; });
}
// ---------- UI: categories, list ----------
const catBox = $('cats');
for (const c of manifest.categories) {
  const n = manifest.instances.filter((i) => i.category === c.id).length;
  const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" checked data-cat="${c.id}"> ${c.label} <small>${n}</small>`;
  l.querySelector('input').addEventListener('change', (e) => { catGroups[c.id].visible = e.target.checked; }); catBox.appendChild(l);
}
const list = $('assets');
function renderList() {
  const q = $('search').value.trim().toLowerCase(); list.innerHTML = ''; let n = 0;
  for (const inst of manifest.instances) {
    const a = manifest.assets[inst.asset_id]; const hay = `${inst.instance_id} ${inst.asset_id} ${a.label || ''} ${inst.category}`.toLowerCase();
    if (q && !hay.includes(q)) continue; n++;
    const li = document.createElement('li'); li.dataset.iid = inst.instance_id; if (selected === inst.instance_id) li.className = 'sel';
    const rec = instances.get(inst.instance_id); const vis = rec ? rec.root.visible : true;
    li.innerHTML = `<input type="checkbox" ${vis ? 'checked' : ''} title="显示/隐藏"><span class="id">${inst.asset_id}</span><span class="tag">${a.short || inst.category}</span>`;
    li.querySelector('input').addEventListener('click', (e) => { e.stopPropagation(); const r = instances.get(inst.instance_id); if (r) r.root.visible = e.target.checked; });
    li.addEventListener('click', () => select(inst.instance_id, true)); list.appendChild(li);
  }
  $('assetcount').textContent = `${n} / ${manifest.instances.length}`;
}
$('search').addEventListener('input', renderList);
// ---------- selection ----------
let selected = null; const box = new THREE.Box3Helper(new THREE.Box3(), 0xffc400); box.visible = false; scene.add(box);
function bboxOf(id) { const r = instances.get(id); return r ? new THREE.Box3().setFromObject(r.root) : null; }
function select(id, focus) {
  selected = id; const r = instances.get(id);
  if (!r) { $('info').classList.add('hidden'); box.visible = false; renderList(); return; }
  box.box.copy(bboxOf(id)); box.visible = true;
  const a = manifest.assets[r.inst.asset_id]; $('info-title').textContent = r.inst.asset_id;
  const rows = [['instance_id', r.inst.instance_id], ['类别', r.inst.category], ['说明', a.label || '—'], ...(a.facts || []),
    ['位置 (glTF, m)', r.inst.position_gltf.map((v) => v.toFixed(2)).join(', ')], ['pivot', a.pivot || '—'], ['来源', a.provenance || '—'],
    ['推断/估计', (a.inferred || []).join('；') || '—'], ['网页文件', `<a href="${url(a.file)}" target="_blank" rel="noreferrer">${a.file}</a>`], ['研究版/源工程', (a.research_files || []).join('<br>')]];
  $('info-body').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join(''); $('info').classList.remove('hidden');
  renderList(); if (focus) frame(box.box);
}
function frame(b) { const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3()).length();
  exitCam(); controls.target.copy(c); const dir = camera.position.clone().sub(controls.target).normalize(); if (dir.y < 0.15) dir.y = 0.35; dir.normalize();
  camera.position.copy(c).addScaledVector(dir, Math.max(s * 1.3, 8)); controls.update(); }
$('info-close').onclick = () => select(null);
$('btn-focus').onclick = () => selected && frame(bboxOf(selected));
$('btn-hide').onclick = () => { const r = instances.get(selected); if (r) { r.root.visible = false; renderList(); } };
$('btn-isolate').onclick = () => { for (const [id, r] of instances) r.root.visible = id === selected; renderList(); selected && frame(bboxOf(selected)); };
$('btn-showall').onclick = () => { for (const [, r] of instances) r.root.visible = true; for (const g of Object.values(catGroups)) g.visible = true;
  catBox.querySelectorAll('input').forEach((i) => { i.checked = true; }); renderList(); };
$('btn-panel').onclick = () => { const p = $('panel'); p.classList.toggle('hidden'); $('btn-panel').setAttribute('aria-expanded', String(!p.classList.contains('hidden'))); };
const ray = new THREE.Raycaster(); let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
  const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.visible && h.object.userData.instance_id && isVisible(h.object));
  select(hit ? hit.object.userData.instance_id : null, false);
});
function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
// ---------- reference cameras ----------
const K = manifest.camera_intrinsics; let camIdx = -1;
const camBox = $('cams');
manifest.reference_views.forEach((v, i) => { const b = document.createElement('button'); b.title = `视频帧 ${v.frame}`; b.innerHTML = `<img loading="lazy" src="${url(v.image)}" alt="frame ${v.frame}">`; b.onclick = () => enterCam(i); camBox.appendChild(b); });
function enterCam(i) {
  camIdx = (i + manifest.reference_views.length) % manifest.reference_views.length; const v = manifest.reference_views[camIdx];
  controls.enabled = false; camera.position.fromArray(v.position_gltf); camera.quaternion.fromArray(v.quaternion_gltf);
  camera.fov = K.vfov_deg; camera.updateProjectionMatrix();
  $('refimg').src = url(v.image); $('refwrap').classList.remove('hidden'); $('campanel').classList.remove('hidden');
  $('camtitle').textContent = `实拍机位 · 帧 ${v.frame}`; applyOverlay(); resize(); updateTriad(v);
}
// three-way strip: video frame | Agent A (only if its page publishes a matching render) | Agent B Cycles render
async function updateTriad(v) {
  $('triad-ref').src = url(v.image);
  if (v.cg_render) $('triad-b').src = url(v.cg_render);
  const a = $('triad-a'); const aUrl = new URL(`../agent-a/renders/${v.frame}.jpg`, BASE).href;
  let ok = false; try { ok = (await fetch(aUrl, { method: 'HEAD' })).ok; } catch { ok = false; }
  if (ok) { a.src = aUrl; a.style.display = ''; $('triad-a-cap').textContent = 'Agent A'; const p = a.parentElement.querySelector('.pending'); if (p) p.remove(); }
  else { a.style.display = 'none'; if (!a.parentElement.querySelector('.pending')) { const d = document.createElement('div'); d.className = 'pending'; d.textContent = 'Agent A：待接入（同机位结果由 Agent A 主控页提供）'; a.parentElement.prepend(d); } }
}
function exitCam() { if (camIdx < 0) return; camIdx = -1; controls.enabled = true; camera.fov = 55; $('refwrap').classList.add('hidden'); $('campanel').classList.add('hidden');
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); controls.target.copy(camera.position).addScaledVector(f, 20); controls.update(); resize(); }
function applyOverlay() { $('refimg').style.opacity = $('refopacity').value; }
$('refopacity').addEventListener('input', applyOverlay);
$('btn-exitcam').onclick = exitCam; $('btn-prevcam').onclick = () => enterCam(camIdx - 1); $('btn-nextcam').onclick = () => enterCam(camIdx + 1);
if (manifest.reference_views.length) updateTriad(manifest.reference_views[Math.floor(manifest.reference_views.length / 2)]);
function overview() { exitCam(); controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(-150, 140, 160)); controls.update(); }
$('btn-overview').onclick = overview;
// ---------- resize / loop ----------
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  // overlay image: same vertical FOV, horizontal extent from fx (non-square pixels in the solved camera)
  const img = $('refimg'); img.style.height = h + 'px'; img.style.width = (h * (K.width / K.fx) / (K.height / K.fy)) + 'px';
}
new ResizeObserver(resize).observe(canvas); resize(); overview();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
// ---------- progressive load: ground, buildings, props, trees ----------
const order = ['ground', 'building', 'prop', 'tree'];
const todo = [...manifest.instances].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
let done = 0; const t0 = performance.now(); renderList();
const queue = [...todo]; const workers = Array.from({ length: 6 }, async () => {
  while (queue.length) { const inst = queue.shift();
    try { place(inst, await loadAsset(inst.asset_id)); } catch (e) { console.warn('asset failed', inst.asset_id, e); }
    done++; status(`已加载 ${done}/${todo.length} 个资产实例 · ${manifest.agent_label}`); }
});
await Promise.all(workers); renderList();
status(`已加载 ${done} 个实例（${Object.keys(manifest.assets).length} 个独立资产）· ${((performance.now() - t0) / 1000).toFixed(1)} s · ${manifest.agent_label} · 视频 SHA-256 ${manifest.source_video.sha256.slice(0, 12)}…`);
window.__agentb = { scene, instances, manifest, ready: true };
