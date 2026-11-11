'use client';

import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildPlant} from '../lib/plant-engine';
import {buildAdditionalPlant} from '../lib/additional-species';

import {campusLamps, campusPaving, lampRadii, yunguCampusLayout} from '../lib/campus-layout';
export {yunguCampusLayout} from '../lib/campus-layout';

type Props = {wind:number; day:number; motion:boolean; onError:(message:string)=>void};

function makeLamp(): THREE.Group {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.055,lampRadii.postBase,2.8,12), new THREE.MeshStandardMaterial({color:'#56615d',roughness:.62}));
  post.position.y = 1.4;
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(lampRadii.shade,.12,.13,24), new THREE.MeshStandardMaterial({color:'#d6d8c9',roughness:.52,metalness:.08}));
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
    for (const slab of campusPaving) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(slab.width,slab.height,slab.depth),
        new THREE.MeshStandardMaterial({color:slab.color,roughness:slab.roughness}),
      );
      mesh.name = slab.id;
      mesh.position.set(slab.x,slab.y,slab.z);
      mesh.receiveShadow = slab.id === 'walkway';
      scene.add(mesh);
    }

    const models: {model: ReturnType<typeof buildPlant>; base: THREE.Vector3; scale:number}[] = [];
    for (const item of yunguCampusLayout) {
      const params = {age:item.age,day:live.current.day,seed:item.seed,density:item.density};
      const model = ['camphor','acer','ophiopogon'].includes(item.species)
        ? buildAdditionalPlant(item.species as 'camphor'|'acer'|'ophiopogon',params)
        : buildPlant(item.species as 'ginkgo'|'osmanthus'|'iris'|'oxalis',params);
      const base = new THREE.Vector3(item.x,0,item.z);
      // Individual trees keep their own seed-driven crown geometry, but a
      // planted stand also has deterministic whole-tree azimuth variation.
      // This changes exposure and silhouette without moving the root collar,
      // branch sockets or any growth-time material node.
      const azimuth = (((item.seed * 37) % 360) - 180) * Math.PI / 180;
      model.group.position.copy(base); model.group.rotation.y = azimuth; model.group.scale.setScalar(item.scale);
      model.group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow=true; object.receiveShadow=true; } });
      scene.add(model.group); models.push({model,base,scale:item.scale});
    }
    for (const item of campusLamps) {
      const lamp = makeLamp();
      lamp.name = item.id;
      lamp.position.set(item.x,0,item.z);
      scene.add(lamp);
    }
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
