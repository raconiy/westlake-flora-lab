import {useEffect, useRef, useState} from 'react';
import {Box, Camera, Download, Layers3, Orbit, Wind, RotateCcw} from 'lucide-react';
import * as THREE from 'three';
import {createCaptureAtmosphere, captureSunDirection} from '../lib/capture-atmosphere';
import {applyCaptureMaterials} from '../lib/capture-materials';
import {loadCaptureBackdrop, createDistantTreeLine} from '../lib/capture-backdrop';
import {createCaptureFoliage} from '../lib/capture-foliage';
import {chooseCaptureQuality} from '../lib/capture-quality';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {readCrownSamples, disposeSamples} from './captureSamples';
import {createCaptureWind} from '../lib/capture-wind';
import {createCaptureMeadow} from '../lib/capture-meadow';
import {readCaptureAsset} from './readCaptureAsset';
import './capture.css';

const media = import.meta.env.BASE_URL + 'capture17/';
type Actions = { turf: () => void; side: () => void; reset: () => void; photograph: (id: string) => void; overhead: () => void; samples: () => Promise<void>; projection: (id:string) => Promise<void>; free: () => void };

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
  const startAtTurf = useRef(false);
  const actions = useRef<Actions | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const experiment = useRef({speed: 0, hanging: false, gustRemaining:0, startOnLoad: false});
  const [speed, setSpeed] = useState(0);
  const [hanging, setHanging] = useState(false);
  const [readout, setReadout] = useState({speed:0, maxTipCm:0, testTipCm:0, limited:0});
  const [hasWind, setHasWind] = useState(false);
  const [progress, setProgress] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photo, setPhoto] = useState('01');
  const [pointCount, setPointCount] = useState(0);
  const [blades, setBlades] = useState(0);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState(false);
  const [projected,setProjected] = useState(false);
  const [projectBusy,setProjectBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const node = mount.current;
    if (!open || !node) return;
    let active = true;
    let lastRead = 0;
    let dirty = true;
    let matchedPose: THREE.Quaternion | undefined;
    let samples: Awaited<ReturnType<typeof readCrownSamples>> | undefined;
    let model: THREE.Object3D | undefined;
    const comparisonCache=new Map<string,THREE.Object3D>();
    let comparison:THREE.Object3D|undefined;
    let generation=0;
    let weight: THREE.Group | undefined;
    let meadow: ReturnType<typeof createCaptureMeadow> | undefined;
    let foliage: ReturnType<typeof createCaptureFoliage> | undefined;
    let treeLine: ReturnType<typeof createDistantTreeLine> | undefined;
    let backdrop: Awaited<ReturnType<typeof loadCaptureBackdrop>> | undefined;
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
    const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    const quality = chooseCaptureQuality({
      renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : undefined,
      mobile: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)),
      devicePixelRatio: window.devicePixelRatio, maxTextureSize: renderer.capabilities.maxTextureSize,
      override: new URLSearchParams(window.location.search).get('quality'),
    });
    renderer.setPixelRatio(quality.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    const scene = new THREE.Scene();
    const atmosphere = createCaptureAtmosphere(renderer, scene, quality.shadowMapSize);
    const sun = atmosphere.sun;
    if (import.meta.env.DEV) Object.assign(window, {captureDebug: {renderer, scene, atmosphere, THREE, redraw: () => { dirty = true; renderer.shadowMap.needsUpdate = true; }}});
    const camera = new THREE.PerspectiveCamera(47, 4/3, 0.05, 260);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.addEventListener('change', () => { dirty = true; });
    controls.addEventListener('start', () => { actions.current?.free(); matchedPose = undefined; dirty = true; });
    controls.minDistance = 0.45;
    controls.maxDistance = 130;
    controls.maxPolarAngle = Math.PI - 0.015;
    const onLost = (ev: Event) => { ev.preventDefault(); fail('浏览器中断了 3D 渲染，可重试或下载模型。'); };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    node.appendChild(renderer.domElement);
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
      const buffer = await readCaptureAsset(media+'yungu-lawn.glb?v=7.1',controller.signal,
        fraction=>{if(active)setProgress(Math.min(99,Math.round(100*fraction)));});
      if (!active) return;
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, media);
      if (!active) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      model.traverse(o => {
        if (o instanceof THREE.Light) o.visible = false;
        if (['turfnearvergeblades','capturemeadowstatic'].includes(o.name.replace(/[^a-z0-9]/gi,'').toLowerCase())) o.visible = false;
        if (o instanceof THREE.Mesh) {
          o.castShadow = true; o.receiveShadow = true;
        }
      });
      applyCaptureMaterials(model, renderer.capabilities.getMaxAnisotropy());
      scene.add(model);
      foliage = createCaptureFoliage(model, {perTree: quality.laminaePerTree});
      // The distant scene is appearance only; the lawn stays usable without it.
      loadCaptureBackdrop(media+'backdrop/', controller.signal, renderer.capabilities.getMaxAnisotropy()).then(loaded => {
        if (!active) { loaded.dispose(); return; }
        backdrop = loaded; scene.add(loaded.mesh);
        treeLine = createDistantTreeLine(loaded.mesh.userData.placement.centre, captureSunDirection);
        scene.add(treeLine.mesh);
        // Trees past the backdrop's near limit are already in the photographs;
        // drawing the stand-in models as well would show each of them twice.
        const {centre, azimuth} = loaded.mesh.userData.placement;
        for (const tree of model?.children ?? []) {
          if (!/^tree/i.test(tree.name)) continue;
          const dx = tree.position.x - centre[0], dz = tree.position.z - centre[2], bearing = Math.atan2(dx, -dz);
          if (Math.hypot(dx, dz) > 50 && bearing > azimuth[0] && bearing < azimuth[1]) tree.visible = false;
        }
        renderer.shadowMap.needsUpdate = true; dirty = true;
      }).catch(() => {});
      scene.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      const matchedTrees: THREE.Object3D[] = [];
      const capturedTreeNames = new Set(['treeforegroundforked','treemidfork','treeleftspreading']);
      model.traverse(node => {
        if (capturedTreeNames.has(node.name.toLowerCase().replace(/[^a-z0-9]/g, ''))) matchedTrees.push(node);
      });
      const crownParts:THREE.Object3D[]=[];
      for(const tree of matchedTrees)tree.traverse(o=>{
        if(o.userData.source_photo || /volume.branchlets|volume.leaves|visible.crown|visiblecrown|\.foliage|foliage|blade|leaves/i.test(o.name)) crownParts.push(o);
      });
      const clearProjection=()=>{
        generation++;
        if(comparison)comparison.visible=false;
        comparison=undefined;
        crownParts.forEach(o=>o.visible=true);
        setProjected(false);setProjectBusy(false);dirty=true;renderer.shadowMap.needsUpdate=true;
      };
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
      const returnToMesh = () => {
        clearProjection();
        if (samples) samples.group.visible=false;
        matchedTrees.forEach(tree=>{tree.visible=true;});
        setPointCount(0);
      };
      const home = () => { setView(refPosition, target, reference instanceof THREE.PerspectiveCamera ? reference : undefined); setPhoto('01'); };
      home();
      controls.saveState();
      actions.current = {
        reset: ()=>{returnToMesh();home();},
        free: clearProjection,
        turf: () => { returnToMesh(); setView(new THREE.Vector3(1.65,.19,1.95),new THREE.Vector3(.68,.055,.98)); },
        side: () => { returnToMesh(); setView(new THREE.Vector3(15,4.2,-1.2),new THREE.Vector3(-1,5.2,-4)); },
        projection: async id=>{
          if(comparison){clearProjection();return;}
          const nearest=['01','06','10','13'].reduce((a,b)=>Math.abs(+b-(+id))<Math.abs(+a-(+id))?b:a);
          const view=cameras.get(nearest);
          if(!view)return;
          const version=++generation;
          setProjectBusy(true);setSampleError(false);
          try {
            let object=comparisonCache.get(nearest);
            if(!object){
              const r=await fetch(media+'appearance-'+nearest+'.glb',{signal:controller.signal});
              if(!r.ok)throw Error('Comparison unavailable');
              object=(await new GLTFLoader().parseAsync(await r.arrayBuffer(),media)).scene;
              if(!active||version!==generation){disposeModel(object);return;}
              object.traverse(o=>{if(o instanceof THREE.Mesh)for(const mat of Array.isArray(o.material)?o.material:[o.material])mat.toneMapped=false;});
              scene.add(object);comparisonCache.set(nearest,object);
            }
            if(!active||version!==generation)return;
            if(samples)samples.group.visible=false;
            matchedTrees.forEach(o=>o.visible=true);setPointCount(0);
            const pos=view.getWorldPosition(new THREE.Vector3());
            setView(pos,view.getWorldDirection(new THREE.Vector3()).multiplyScalar(13).add(pos),view);
            setPhoto(nearest);
            crownParts.forEach(o=>o.visible=false);
            comparison=object;object.visible=true;setProjected(true);
            renderer.shadowMap.needsUpdate=true;dirty=true;
          } catch {if(active&&version===generation)setSampleError(true);}
          finally {if(active&&version===generation)setProjectBusy(false);}
        },
        samples: async () => {
          clearProjection();
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
          clearProjection();
          const view = cameras.get(id);
          if (!view) return;
          const pos = view.getWorldPosition(new THREE.Vector3());
          const aim = view.getWorldDirection(new THREE.Vector3()).multiplyScalar(13).add(pos);
          setView(pos, aim, view);
          setPhoto(id);
        },
        overhead: () => {returnToMesh();setView(new THREE.Vector3(target.x + 3, 36, target.z + 7), new THREE.Vector3(target.x, 0, target.z));}
      };
      if (startAtTurf.current) { actions.current.turf(); startAtTurf.current=false; }
      const dynamics = createCaptureWind(model);
      meadow = createCaptureMeadow();
      scene.add(meadow.group);
      setHasWind(dynamics.stats.branchCount>0);
      const tipWorld = new THREE.Vector3();
      if(dynamics.sample) {
        const group = new THREE.Group();
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.24,6),new THREE.MeshStandardMaterial({color:0x534435}));
        const mass = new THREE.Mesh(new THREE.SphereGeometry(.054,12,8),new THREE.MeshStandardMaterial({color:0xc1642d,roughness:.48}));
        cord.position.y=-.12; mass.position.y=-.294;
        group.add(cord,mass);
        group.visible=false; scene.add(group); weight=group;
      }
      let last = 0, prevWind = 0, prevLoad = false;
      renderer.setAnimationLoop((time: number) => {
        const delta = last ? Math.min(.2, (time - last) / 1000) : 0;
        last = time;
        const input=experiment.current;
        if(input.startOnLoad) {input.gustRemaining=3;input.startOnLoad=false;}
        const gust = input.gustRemaining>0 ? Math.min(1,(3-input.gustRemaining+delta)/.3)*6 : 0;
        input.gustRemaining=Math.max(0,input.gustRemaining-delta);
        const airSpeed=Math.min(12,input.speed+gust);
        if (dynamics.stats.moving || airSpeed!==prevWind || input.hanging!==prevLoad) {
          dynamics.step(delta,airSpeed,input.hanging?1:0);
          renderer.shadowMap.needsUpdate=true;
          dirty=true;
        }
        if (foliage?.update(delta, airSpeed)) dirty = true;
        if (meadow?.update(camera, delta, airSpeed)) {
          dirty = true;
        }
        prevWind=airSpeed;prevLoad=input.hanging;
        if(weight && dynamics.sample) {
          weight.visible = input.hanging;
          if (input.hanging) weight.position.copy(dynamics.sample.node.localToWorld(tipWorld.copy(dynamics.sample.restTip)));
        }
        if (time-lastRead>180) {
          lastRead=time;
          if (meadow) setBlades(meadow.stats.blades);
          const next={speed:Math.round(airSpeed*10)/10, maxTipCm:Math.round(dynamics.stats.maxTipCm*10)/10,
            testTipCm:Math.round(dynamics.stats.testTipCm*10)/10, limited:dynamics.stats.limited};
          setReadout(old=>old.speed===next.speed && old.maxTipCm===next.maxTipCm && old.testTipCm===next.testTipCm && old.limited===next.limited?old:next);
        }
        if (!matchedPose) controls.update();
        if (dirty) { renderer.render(scene, camera); dirty=false; }
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
      if (weight) disposeModel(weight);
      meadow?.dispose();
      backdrop?.dispose();
      treeLine?.dispose();
      foliage?.dispose();
      if (model) disposeModel(model);
      if (samples) disposeSamples(samples.group);
      comparisonCache.forEach(disposeModel);
      atmosphere.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [open, attempt]);

  const close = () => {
    startAtTurf.current=false;
    setOpen(false); setReady(false); setMessage(''); setSpeed(0);setHanging(false);setHasWind(false);setReadout({speed:0,maxTipCm:0,testTipCm:0,limited:0});
    experiment.current={speed:0,hanging:false,gustRemaining:0,startOnLoad:false}; setProgress(0); setPhotos([]); setPointCount(0); setSampleBusy(false); setSampleError(false); setProjected(false);setProjectBusy(false);
  };
  const gust = () => {
    if(ready){actions.current?.free();experiment.current.gustRemaining=3;}
    else {experiment.current.startOnLoad=true;setOpen(true);}
  };
  return <section className="capture" aria-label="云谷草坪实拍重建">
    <div className="capture-layout">
      <div className="capture-stage">
        <img className="capture-poster" src={media + 'refine-20261111/after.webp?v=7.1'} alt="同一场景的三维渲染，前景路灯与主树分立于步道旁的草坪"/>
        {open && <div className={'capture-webgl' + (ready ? ' loaded' : '')} ref={mount}/>}
        {!open && <div className="capture-start"><button className="capture-enter" onClick={()=>setOpen(true)}><Orbit size={18}/>进入三维场景</button><button className="capture-enter capture-wind-start" onClick={()=>{startAtTurf.current=true; setOpen(true);}}>近看草坪</button><button className="capture-enter capture-wind-start" onClick={gust}><Wind size={17}/>试一次阵风</button></div>}
        {open && !ready && <div className="capture-loading" role="status">{message || (progress >= 98 ? '正在准备三维网格…' : '正在读取场景' + (progress ? ' '+progress+'%' : '…'))}
          {message && <button onClick={()=>{setMessage('');setProgress(0);setAttempt(a=>a+1);}}>重试</button>}
          <button onClick={close}>返回渲染图</button></div>}
      </div>
      <div className="capture-info">
        <h2>草坪与步道</h2>
        <p>沿步道看前树的弯曲分叉、中树的密冠、左树的侧枝和右侧复干树。进入三维后可切换实拍机位、侧看分枝，也可以贴近地面检查草叶。</p>
        <p><a className="capture-contact-link" href={media+'refine-20261111/index.html'}>R7.1：叶面、草叶和风载修复，以及本轮调用记录 →</a></p>
        <p><a className="capture-contact-link" href={media+'scene-r7/index.html'}>拖动对照实拍与模型，查看五个账号的工作记录 →</a></p>
        <dl><dt>采集素材</dt><dd>13 张照片 · 4 段视频</dd><dt>相机配准</dt><dd>29 个视角 · 7,674 个稀疏点</dd><dt>重建范围</dt><dd>乔木、草坪、步道与灯具</dd><dt>可见性</dt><dd>前树冠顶和左树侧缘超出取景，遮挡部分的分枝和叶片按可见范围推断。</dd><dt>尺度与动力</dt><dd>模型尺寸使用工程估计。树种、地下根形与枝条刚度尚待现场核对。</dd></dl>
        <a className="capture-download" href={media+'yungu-lawn.glb?v=7.1'} download><Download size={16}/> 下载校园场景 <span>GLB</span></a>
        <a className="capture-contact-link" href={media+'contact-world.xml'} download>下载碰撞模型（MuJoCo）</a>
        <a className="capture-contact-link" href={media+'yungu-meadow.glb?v=7'} download>单独下载草叶实例（GLB）</a>
        <a className="capture-contact-link" href={media+'yungu-meadow-full.glb?v=7'} download>下载全密度草坪（离线渲染）</a>
        <a className="capture-contact-link" href="https://github.com/raconiy/westlake-flora-lab/releases/download/yungu-capture17-v7/yungu-campus-scene-source-v7.zip">下载 R7 基线 Blender 工程及生成脚本</a>
        <a className="capture-contact-link" href={media+'scene-r7/dispatch/index.html'}>查看 R7 基线五个账号的派工与回执</a>
      </div>
    </div>
    {ready && <div className="capture-tools">
      <button onClick={()=>actions.current?.reset()}><Camera size={16}/>实拍机位</button>
      {photos.length > 1 && <label className="capture-select">照片机位 <select aria-label="照片机位" value={photo} onChange={e=>actions.current?.photograph(e.target.value)}>{photos.map(id=><option key={id} value={id}>{id}</option>)}</select></label>}
      <button onClick={()=>actions.current?.turf()}>贴近草叶</button>
      <button onClick={()=>actions.current?.side()}>侧看主树</button>
      <button onClick={()=>actions.current?.overhead()}><Layers3 size={16}/>俯看布局</button>
      <button disabled={sampleBusy} aria-pressed={pointCount>0} onClick={()=>void actions.current?.samples()}>{sampleBusy?'读取实拍点…':pointCount?'还原三维树冠':'查看实拍采样点'}</button>
      <button disabled={sampleBusy||projectBusy} aria-pressed={projected} onClick={()=>void actions.current?.projection(photo)}>{projectBusy?'读取照片纹理…':projected?'返回可动冠层':'对照实拍冠层'}</button>
      {sampleError && <span role="status">实拍对照文件读取失败，请重试。</span>}

      <button onClick={close}><RotateCcw size={15}/>返回渲染图</button>
    </div>}
    {ready && hasWind && !projected && !pointCount && <div className="capture-forces">
      <label>背景风速 <input aria-label="背景风速" type="range" min="0" max="10" step=".5" value={speed} onChange={e=>{const v=Number(e.target.value);experiment.current.speed=v;setSpeed(v);}}/><output>{speed.toFixed(1)} m/s</output></label>
      <button onClick={gust}><Wind size={15}/>施加 3 秒阵风</button>
      <button aria-pressed={hanging} onClick={()=>{experiment.current.hanging=!hanging;setHanging(!hanging);}}>{hanging?'卸下砝码':'前树枝端挂载 1 kg'}</button>
      <div className="capture-telemetry">当前气流 <b data-air>{readout.speed.toFixed(1)} m/s</b> · 当前视野草叶 <b data-blades>{blades.toLocaleString()}</b> · 最大枝端位移 <b data-tip>{readout.maxTipCm.toFixed(1)} cm</b>{hanging && <> · 挂载枝端 <b>{readout.testTipCm.toFixed(1)} cm</b></>}{!!readout.limited && <small> · {readout.limited} 个枝组达到小角度模型上限</small>}</div>
    </div>}
    <div className="capture-footer"><Box size={15}/><span>{projected ? '照片 '+photo+' · 纹理来自实拍，局部深度由立体点插值；转动后回到可动模型' : pointCount ? '三株近景树 · '+pointCount.toLocaleString()+' 个多视图采样点，空白处缺少观测' : open&&ready?'可交互三维网格':'实拍机位 · 三维渲染'}</span></div>
  </section>;
}
