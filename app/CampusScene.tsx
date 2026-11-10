'use client';

import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildPlant} from '../lib/plant-engine';
import {buildAdditionalPlant} from '../lib/additional-species';

type CampusSpecies = 'ginkgo'|'osmanthus'|'camphor'|'acer'|'iris'|'oxalis'|'ophiopogon';
type Placement = {id:string; species:CampusSpecies; x:number; z:number; age:number; seed:number; scale:number; density:number};

/** Photo-informed layout prior. Positions and dimensions are engineering priors until a measured site survey is supplied. */
export const yunguCampusLayout: Placement[] = [
  {id:'camphor-01',species:'camphor',x:-8,z:4,age:24,seed:401,scale:1.08,density:.9},
  {id:'camphor-02',species:'camphor',x:0,z:4,age:19,seed:402,scale:.93,density:.86},
  {id:'camphor-03',species:'camphor',x:8,z:4,age:22,seed:403,scale:1.02,density:.9},
  {id:'ginkgo-01',species:'ginkgo',x:-6,z:10,age:17,seed:511,scale:.96,density:.86},
  {id:'ginkgo-02',species:'ginkgo',x:0,z:10,age:13,seed:512,scale:.82,density:.78},
  {id:'ginkgo-03',species:'ginkgo',x:6,z:10,age:16,seed:513,scale:.91,density:.84},
  {id:'osmanthus-01',species:'osmanthus',x:-4,z:-3,age:8,seed:621,scale:.72,density:.9},
  {id:'osmanthus-02',species:'osmanthus',x:4,z:-3,age:10,seed:622,scale:.78,density:.94},
  {id:'acer-01',species:'acer',x:-12,z:9,age:11,seed:731,scale:.8,density:.84},
  {id:'iris-01',species:'iris',x:-10,z:-2,age:2.2,seed:811,scale:.65,density:.7},
  {id:'iris-02',species:'iris',x:10,z:-2,age:2.4,seed:812,scale:.7,density:.72},
  {id:'oxalis-01',species:'oxalis',x:-7,z:-5,age:1.6,seed:821,scale:.8,density:.75},
  {id:'oxalis-02',species:'oxalis',x:7,z:-5,age:1.8,seed:822,scale:.82,density:.78},
  {id:'ophiopogon-01',species:'ophiopogon',x:-2,z:-6,age:4,seed:831,scale:.7,density:.78},
  {id:'ophiopogon-02',species:'ophiopogon',x:2,z:-6,age:4.5,seed:832,scale:.72,density:.8},
];

type Props = {wind:number; day:number; motion:boolean; onError:(message:string)=>void};

function makeLamp(): THREE.Group {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.055,.075,2.8,12), new THREE.MeshStandardMaterial({color:'#56615d',roughness:.62}));
  post.position.y = 1.4;
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(.22,.12,.13,24), new THREE.MeshStandardMaterial({color:'#d6d8c9',roughness:.52,metalness:.08}));
  shade.position.y = 2.84;
  const light = new THREE.PointLight('#fff4ce',2.2,5.5,.9);
  light.position.y = 2.76;
  group.add(post,shade,light);
  group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow=true; object.receiveShadow=true; } });
  return group;
}

export default function CampusScene({wind,day,motion,onError}: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const live = useRef({wind,day,motion});
  live.current = {wind,day,motion};

  useEffect(() => {
    const container = holder.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({antialias:true,alpha:true}); }
    catch { onError('当前浏览器无法初始化 WebGL，请开启硬件加速。'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#b9d6ee');
    const camera = new THREE.PerspectiveCamera(42,1,.05,160);
    camera.position.set(19,13,22);
    const controls = new OrbitControls(camera,renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0,2,3);
    const hemi = new THREE.HemisphereLight('#edf6ff','#6e7658',1.1);
    const sun = new THREE.DirectionalLight('#fff4da',3.2);
    sun.position.set(-14,26,12); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048);
    scene.add(hemi,sun,sun.target);

    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(42,36),new THREE.MeshStandardMaterial({color:'#4c813d',roughness:1}));
    lawn.rotation.x=-Math.PI/2; lawn.receiveShadow=true; scene.add(lawn);
    const path = new THREE.Mesh(new THREE.BoxGeometry(42,.08,4.2),new THREE.MeshStandardMaterial({color:'#b6b9b0',roughness:.9}));
    path.position.set(0,.04,-1); path.receiveShadow=true; scene.add(path);
    const pathJoint = new THREE.Mesh(new THREE.BoxGeometry(42,.085,.08),new THREE.MeshStandardMaterial({color:'#9fa39d',roughness:1}));
    pathJoint.position.set(0,.085,.4); scene.add(pathJoint);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(42,.14,.18),new THREE.MeshStandardMaterial({color:'#d4d5cd',roughness:.94}));
    curb.position.set(0,.07,1.15); scene.add(curb);

    const models: {model: ReturnType<typeof buildPlant>; base: THREE.Vector3; scale:number}[] = [];
    for (const item of yunguCampusLayout) {
      const params = {age:item.age,day:live.current.day,seed:item.seed,density:item.density};
      const model = ['camphor','acer','ophiopogon'].includes(item.species)
        ? buildAdditionalPlant(item.species as 'camphor'|'acer'|'ophiopogon',params)
        : buildPlant(item.species as 'ginkgo'|'osmanthus'|'iris'|'oxalis',params);
      const base = new THREE.Vector3(item.x,0,item.z);
      model.group.position.copy(base); model.group.scale.setScalar(item.scale);
      model.group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow=true; object.receiveShadow=true; } });
      scene.add(model.group); models.push({model,base,scale:item.scale});
    }
    for (const x of [-10,10]) { const lamp=makeLamp(); lamp.position.set(x,0,-.25); scene.add(lamp); }
    const centerLamp=makeLamp(); centerLamp.position.set(0,0,14); scene.add(centerLamp);
    const bounds = new THREE.Box3(new THREE.Vector3(-16,0,-9),new THREE.Vector3(16,10,17));
    const center=bounds.getCenter(new THREE.Vector3());
    controls.target.set(center.x,2.5,center.z);
    const clock = new THREE.Clock(); let frame=0; let disposed=false;
    const resize=()=>{if(!container||disposed)return;const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();};
    const animate=()=>{if(disposed)return; frame=requestAnimationFrame(animate);const t=clock.getElapsedTime();const current=live.current;for(const entry of models){entry.model.group.position.copy(entry.base);entry.model.update(current.motion?t:0,current.wind,1,1);entry.model.group.position.copy(entry.base);}controls.update();renderer.render(scene,camera);};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();animate();
    return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();for(const entry of models){scene.remove(entry.model.group);entry.model.dispose();}renderer.dispose();renderer.domElement.remove();};
  },[onError]);
  return <div ref={holder} className="campus-scene-canvas" aria-label="云谷校区植物与路灯场景"/>;
}
