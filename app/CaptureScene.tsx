import {useEffect, useRef, useState} from 'react';
import {Box, Camera, Download, Layers3, Orbit, Pause, Play, RotateCcw} from 'lucide-react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {readCrownSamples, disposeSamples} from './captureSamples';
import './capture.css';

const media = import.meta.env.BASE_URL + 'capture17/';
type Actions = { reset: () => void; photograph: (id: string) => void; overhead: () => void; samples: () => Promise<void>; motion: (enabled: boolean) => void };

function disposeModel(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  textures.forEach(t => { t.dispose(); t.source.data?.close?.(); });
  materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose());
}

export default function CaptureScene() {
  const mount = useRef<HTMLDivElement>(null);
  const actions = useRef<Actions | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [wind, setWind] = useState(false);
  const [hasWind, setHasWind] = useState(false);
  const [progress, setProgress] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photo, setPhoto] = useState('01');
  const [pointCount, setPointCount] = useState(0);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const node = mount.current;
    if (!open || !node) return;
    let active = true;
    let playing = false;
    let dirty = true;
    let matchedPose: THREE.Quaternion | undefined;
    let samples: Awaited<ReturnType<typeof readCrownSamples>> | undefined;
    let model: THREE.Object3D | undefined;
    let mixer: THREE.AnimationMixer | undefined;
    let renderer: THREE.WebGLRenderer;
    const fail = (text: string) => {
      if (active) { setMessage(text); setReady(false); }
    };
    try {
      renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
    } catch {
      fail('浏览器未能启动 3D 视图。下方可下载模型，或重试。');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb0d7ef);
    const camera = new THREE.PerspectiveCamera(47, 4/3, 0.05, 260);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.addEventListener('change', () => { dirty = true; });
    controls.addEventListener('start', () => { matchedPose = undefined; dirty = true; });
    controls.minDistance = 0.45;
    controls.maxDistance = 130;
    controls.maxPolarAngle = Math.PI - 0.015;
    const onLost = (ev: Event) => { ev.preventDefault(); fail('浏览器中断了 3D 渲染，可重试或下载模型。'); };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    node.appendChild(renderer.domElement);
    const lighting = new THREE.HemisphereLight(0xfff7e4, 0x738061, 1.65);
    const sun = new THREE.DirectionalLight(0xffedc7, 2.7);
    sun.position.set(-18, 24, 9);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, {left: -27, right: 27, top: 25, bottom: -25, near: 0.5, far: 105});
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.normalBias = 0.025;
    scene.add(lighting, sun, sun.target);
    const resize = () => {
      const {width, height} = node.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      dirty = true;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();

    const controller = new AbortController();
    async function load() {
      const response = await fetch(media + 'yungu-lawn.glb', {signal: controller.signal});
      if (!response.ok) throw new Error('GLB HTTP ' + response.status);
      const length = Number(response.headers.get('content-length'));
      let buffer: ArrayBuffer;
      if (response.body && length > 0) {
        const reader = response.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let received = 0;
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          chunks.push(new Uint8Array(value));
          received += value.byteLength;
          if (active) setProgress(Math.min(99, Math.round(100 * received / length)));
        }
        buffer = await new Blob(chunks).arrayBuffer();
      } else {
        buffer = await response.arrayBuffer();
      }
      if (!active) return;
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, media);
      if (!active) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      model.traverse(o => {
        if (o instanceof THREE.Light) o.visible = false;
        if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      scene.add(model);
      scene.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      const matchedTrees: THREE.Object3D[] = [];
      const capturedTreeNames = new Set(['treeforegroundforked','treemidfork','treeleftspreading']);
      model.traverse(node => {
        if (capturedTreeNames.has(node.name.toLowerCase().replace(/[^a-z0-9]/g, ''))) matchedTrees.push(node);
      });
      const cameras = new Map<string, THREE.PerspectiveCamera>();
      model.traverse(node => {
        if (!(node instanceof THREE.PerspectiveCamera)) return;
        const imageId = (node.name + ' ' + (node.parent?.name ?? '')).match(/Photo[ _-]*(\d{2})/i)?.[1];
        if (imageId) cameras.set(imageId, node);
      });
      setPhotos(Array.from(cameras.keys()).sort());
      const reference = cameras.get('01') ?? gltf.cameras[0];
      const refPosition = new THREE.Vector3();
      const target = new THREE.Vector3();
      if (reference instanceof THREE.PerspectiveCamera) {
        reference.getWorldPosition(refPosition);
        reference.getWorldDirection(target);
        target.multiplyScalar(13).add(refPosition);
        camera.fov = reference.fov;
      } else {
        refPosition.copy(center).add(new THREE.Vector3(-5, 1.7, 17));
        target.copy(center);
      }
      function setView(position: THREE.Vector3, focus: THREE.Vector3, captured?: THREE.PerspectiveCamera) {
        matchedPose = undefined;
        controls.reset();
        if (captured) camera.fov = captured.fov;
        else camera.fov = 50;
        camera.position.copy(position);
        controls.target.copy(focus);
        camera.updateProjectionMatrix();
        controls.update();
        if (captured) {
          camera.position.copy(position);
          matchedPose = captured.getWorldQuaternion(new THREE.Quaternion());
          camera.quaternion.copy(matchedPose);
        }
        dirty = true;
      }
      const home = () => { setView(refPosition, target, reference instanceof THREE.PerspectiveCamera ? reference : undefined); setPhoto('01'); };
      home();
      controls.saveState();
      actions.current = {
        reset: home,
        samples: async () => {
          setSampleError(false);
          if (!samples) {
            setSampleBusy(true);
            try {
              const loaded = await readCrownSamples(media, controller.signal);
              if (!active) { disposeSamples(loaded.group); return; }
              samples = loaded;
              samples.group.visible = false;
              scene.add(samples.group);
            } catch {
              if (active) setSampleError(true);
              return;
            } finally {
              if (active) setSampleBusy(false);
            }
          }
          const visible = !samples.group.visible;
          samples.group.visible = visible;
          matchedTrees.forEach(tree => { tree.visible = !visible; });
          setPointCount(visible ? samples.count : 0);
          renderer.shadowMap.needsUpdate = true;
          dirty = true;
        },
        photograph: id => {
          const view = cameras.get(id);
          if (!view) return;
          const pos = view.getWorldPosition(new THREE.Vector3());
          const aim = view.getWorldDirection(new THREE.Vector3()).multiplyScalar(13).add(pos);
          setView(pos, aim, view);
          setPhoto(id);
        },
        overhead: () => setView(new THREE.Vector3(target.x + 3, 36, target.z + 7), new THREE.Vector3(target.x, 0, target.z)),
        motion: enabled => { playing = enabled; }
      };
      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        const tracks = new Set<string>();
        for (const clip of gltf.animations) {
          if (clip.tracks.some(t => tracks.has(t.name))) continue;
          clip.tracks.forEach(t => tracks.add(t.name));
          mixer.clipAction(clip).play();
        }
        setHasWind(tracks.size > 0);
      }
      let last = 0;
      renderer.setAnimationLoop((time: number) => {
        const delta = last ? Math.min(0.06, (time - last) / 1000) : 0;
        last = time;
        if (playing && mixer) {
          mixer.update(delta);
          renderer.shadowMap.needsUpdate = true;
          dirty = true;
        }
        if (!matchedPose) controls.update();
        if (dirty) {
          renderer.render(scene, camera);
          dirty = false;
        }
      });
      setReady(true);
      setProgress(100);
    }
    load().catch(() => fail('模型加载失败，可重试或下载 GLB 文件。'));
    return () => {
      active = false;
      actions.current = null;
      controller.abort();
      observer.disconnect();
      controls.dispose();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      mixer?.stopAllAction();
      if (model) { mixer?.uncacheRoot(model); disposeModel(model); }
      if (samples) disposeSamples(samples.group);
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [open, attempt]);

  const close = () => {
    setOpen(false); setReady(false); setMessage(''); setWind(false); setHasWind(false); setProgress(0); setPhotos([]); setPointCount(0); setSampleBusy(false); setSampleError(false);
  };
  return <section className="capture" aria-label="云谷草坪实拍重建">
    <div className="capture-layout">
      <div className="capture-stage">
        <img className="capture-poster" src={media + 'near-reference.webp'} alt="同一场景的三维渲染，前景路灯与主树分立于步道旁的草坪"/>
        {open && <div className={'capture-webgl' + (ready ? ' loaded' : '')} ref={mount}/>}
        {!open && <button className="capture-enter" onClick={()=>setOpen(true)}><Orbit size={18}/> 进入三维场景</button>}
        {open && !ready && <div className="capture-loading" role="status">{message || (progress >= 98 ? '正在准备三维网格…' : '正在读取场景' + (progress ? ' '+progress+'%' : '…'))}
          {message && <button onClick={()=>{setMessage('');setProgress(0);setAttempt(a=>a+1);}}>重试</button>}
          <button onClick={close}>返回渲染图</button></div>}
      </div>
      <div className="capture-info">
        <h2>草坪与步道</h2>
        <p>前景路灯、分叉乔木和后方草径来自同一组校园实拍。进入三维后可拖动旋转，滚动或双指缩放。</p>
        <dl><dt>采集素材</dt><dd>13 张照片 · 4 段视频</dd><dt>相机配准</dt><dd>29 个视角 · 7,674 个稀疏点</dd><dt>重建范围</dt><dd>乔木、草坪、步道与灯具</dd><dt>可见性</dt><dd>主树冠顶超出画面，背面枝叶按可见冠形补建。</dd><dt>尺度与动力</dt><dd>模型尺寸使用工程估计。树种、地下根形与枝条刚度尚待现场核对。</dd></dl>
        <a className="capture-download" href={media+'yungu-lawn.glb'} download><Download size={16}/> 下载三维资产 <span>GLB</span></a>
        <a className="capture-contact-link" href={media+'contact-world.xml'} download>下载碰撞模型（MuJoCo）</a>
        <a className="capture-contact-link" href="https://github.com/raconiy/westlake-flora-lab/releases/download/yungu-capture17-v1/yungu-campus-scene-source.zip">下载 Blender 工程及生成脚本</a>
      </div>
    </div>
    {ready && <div className="capture-tools">
      <button onClick={()=>actions.current?.reset()}><Camera size={16}/>实拍机位</button>
      {photos.length > 1 && <label className="capture-select">照片机位 <select aria-label="照片机位" value={photo} onChange={e=>actions.current?.photograph(e.target.value)}>{photos.map(id=><option key={id} value={id}>{id}</option>)}</select></label>}
      <button onClick={()=>actions.current?.overhead()}><Layers3 size={16}/>俯看布局</button>
      <button disabled={sampleBusy} aria-pressed={pointCount>0} onClick={()=>void actions.current?.samples()}>{sampleBusy?'读取实拍点…':pointCount?'还原三维树冠':'查看实拍采样点'}</button>
      {sampleError && <span role="status">实拍点读取失败，请重试。</span>}
      {hasWind && <button aria-pressed={wind} onClick={()=>{actions.current?.motion(!wind);setWind(!wind);}}>{wind?<Pause size={16}/>:<Play size={16}/>} {wind?'暂停风动':'播放风动'}</button>}
      <button onClick={close}><RotateCcw size={15}/>返回渲染图</button>
    </div>}
    <div className="capture-footer"><Box size={15}/><span>{pointCount ? '三株近景树 · '+pointCount.toLocaleString()+' 个实拍三角测量点，空白处缺少观测' : open&&ready?'可交互三维网格':'实拍机位 · 三维渲染'}</span></div>
  </section>;
}
