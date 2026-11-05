'use client';
import {useEffect,useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildPlant,naturalFanBlade} from '../lib/plant-engine';
import {buildAdditionalPlant} from '../lib/additional-species';
import {buildRhizosphere} from '../lib/rhizosphere';
import {createBeamDynamics,type BeamDynamicsStats} from '../lib/beam-dynamics';
import {physicalPriors} from '../lib/physical-priors';
import {createGroundSurface} from '../lib/ground-surface';
import {modelBounds,directionalShadowFrame} from '../lib/scene-framing';
import type {Scenario} from '../lib/species';
type RootStats={rootDepth:number;rootLength:number;rootTips:number;waterStress:number};
type Props={scenario:Scenario;autoFrame:boolean;organView:'plant'|'section'|'root'|'leaf'|'stem';mode:string;resetKey:number;motion:boolean;onStats:(s:{leaves:number;height:number;fps:number})=>void;onRootStats:(s:RootStats)=>void;onPhysicsStats:(s:BeamDynamicsStats)=>void;onError:(s:string)=>void};
export default function PlantScene(props:Props){
 const holder=useRef<HTMLDivElement>(null),live=useRef(props);live.current=props;
 const system=useRef<{rebuild:()=>void;reset:()=>void;mode:()=>void}|null>(null);
 useEffect(()=>{
  if(!holder.current)return;const container=holder.current;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});}catch{props.onError('当前浏览器无法初始化 WebGL，请开启硬件加速。');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.setClearColor(0xe8eee4,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;container.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.001,180);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.7;controls.minDistance=.025;controls.maxDistance=75;
  // Artistic illumination only: restrained sky fill preserves crown depth.
  scene.add(new THREE.HemisphereLight(0xe9f1ff,0x75644e,.75));
  const sun=new THREE.DirectionalLight(0xfff4db,3.1);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);scene.add(sun,sun.target);
  const sunDirection=new THREE.Vector3(-7,13,8).normalize();
  const fill=new THREE.DirectionalLight(0xd9e8f2,.45);fill.position.set(7,4,-6);scene.add(fill);
  const sectionLight=new THREE.DirectionalLight(0xffefda,.85);sectionLight.position.set(-3,2,-6);sectionLight.visible=false;scene.add(sectionLight);
  const ground=createGroundSurface(),stage=ground.group;scene.add(stage);
  const desiredCamera=new THREE.Vector3(),desiredTarget=new THREE.Vector3();let fitting=false,userControlled=false;
  const plantBounds=new THREE.Box3(),rootBounds=new THREE.Box3(),soilBounds=new THREE.Box3(),leafBounds=new THREE.Box3();
  // OrbitControls emits start for drag, touch and wheel. Ownership persists after
  // end, through playback, stage transitions, mode changes and resize.
  const takeCamera=()=>{userControlled=true;fitting=false;};
  controls.addEventListener('start',takeCamera);
  let dynamics:ReturnType<typeof createBeamDynamics>|null=null;let plant:ReturnType<typeof buildPlant>|null=null,soil:ReturnType<typeof buildRhizosphere>|null=null,leafDetail:THREE.Group|null=null,oldKey='',time=0,prior=performance.now(),since=prior,frames=0,raf=0;
  function clearLeaf(){if(!leafDetail)return;scene.remove(leafDetail);leafDetail.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});leafDetail=null;}
  function makeLeaf(){clearLeaf();if(!plant)return;let source:THREE.InstancedMesh|THREE.Mesh|undefined;plant.group.traverse(o=>{if(!source&&o instanceof THREE.Mesh&&o.userData.organ==='leaf'&&o.userData.connectedBy==='petiole')source=o;});if(!source)plant.group.traverse(o=>{if(!source&&o instanceof THREE.Mesh&&o.userData.organ==='leaf')source=o;});if(!source)return;const object=source as THREE.Mesh,geometry=live.current.scenario.species==='ginkgo'?naturalFanBlade(128,12):object.geometry.clone(),material=(Array.isArray(object.material)?object.material[0]:object.material).clone() as THREE.MeshStandardMaterial;
   let petioleLength=.055,petioleRadius=.0007;
   if(object instanceof THREE.InstancedMesh){const matrix=new THREE.Matrix4(),scale=new THREE.Vector3();object.getMatrixAt(0,matrix);scale.setFromMatrixScale(matrix);geometry.scale(scale.x,scale.y,scale.z);if(object.instanceColor){const color=new THREE.Color();object.getColorAt(0,color);material.color.multiply(color);}const petiole=object.parent?.children.find(o=>o instanceof THREE.InstancedMesh&&o.userData.organ==='leaf'&&!o.userData.connectedBy) as THREE.InstancedMesh|undefined;if(petiole){petiole.getMatrixAt(0,matrix);scale.setFromMatrixScale(matrix);petioleLength=scale.y;petioleRadius=scale.x;}}
   const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;material.shadowSide=THREE.DoubleSide;leafDetail=new THREE.Group();leafDetail.add(mesh);const g=new THREE.CylinderGeometry(petioleRadius,petioleRadius*1.15,petioleLength,12),stem=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x828646,roughness:.8}));stem.position.y=-petioleLength/2;stem.castShadow=stem.receiveShadow=true;leafDetail.add(stem);scene.add(leafDetail);
  }
  function stemFocus(){
   const r=Math.max(.008,plant?.branches[0]?.radius||.02),y=Math.max(.015,plant?.height||0)*.22;
   return new THREE.Box3(new THREE.Vector3(-r*4,y-r*4,-r*4),new THREE.Vector3(r*4,y+r*4,r*4));
  }
  function updateShadows(){
   const view=live.current.organView,box=(view==='leaf'?leafBounds:view==='root'?rootBounds:plantBounds).clone();
   if(view==='section')box.union(soilBounds);
   // A conservative wind envelope avoids a per-frame bounds traversal. The
   // detached leaf detail does not participate in the branch dynamics.
   if(view!=='leaf')box.expandByScalar(Math.max(.001,box.getSize(new THREE.Vector3()).length()*.16));
   const frame=directionalShadowFrame(box,sunDirection,sun.shadow.mapSize.x,view==='plant'?stage.position.y:undefined,view==='stem'?stemFocus():undefined);
   sun.position.copy(frame.position);sun.target.position.copy(frame.target);
   Object.assign(sun.shadow.camera,{left:frame.left,right:frame.right,bottom:frame.bottom,top:frame.top,near:frame.near,far:frame.far});
   sun.shadow.normalBias=frame.normalBias;sun.shadow.bias=frame.bias;sun.shadow.camera.updateProjectionMatrix();
  }
  const frameCamera=()=>{if(!plant||userControlled)return;const p=live.current,s=p.scenario,h=Math.max(.015,plant.height);let extent=h,targetY=h*.43;
   if(p.organView==='root'&&soil){const rootSize=rootBounds.isEmpty()?new THREE.Vector3(.04,.04,.04):rootBounds.getSize(new THREE.Vector3()),depth=Math.max(.04,soil.rootDepth),width=Math.max(.04,rootSize.x,rootSize.z),e=Math.max(depth,width*.8/Math.min(1,camera.aspect));desiredTarget.set(0,-depth*.45,0);desiredCamera.set(e*.2,-depth*.45+e*.35,-e*2.15);}
   else if(p.organView==='stem'){const r=Math.max(.008,plant.branches[0]?.radius||.02),y=h*.22;desiredCamera.set(r*4,y+r*1.5,r*6);desiredTarget.set(0,y,0);}
   else if(p.organView==='leaf'&&leafDetail){const size=leafBounds.getSize(new THREE.Vector3()),center=leafBounds.getCenter(new THREE.Vector3());extent=Math.max(size.x/Math.min(1,camera.aspect),size.y)*1.1;desiredCamera.set(extent*.45,center.y+extent*.18,extent*2.1);desiredTarget.copy(center);}
   else {const size=plantBounds.getSize(new THREE.Vector3());extent=Math.max(h,Math.max(size.x,size.z)*.87/Math.min(1,camera.aspect));if(p.organView==='section'&&soil){const depth=Math.min(s.soilDepth,Math.max(.035,soil.rootDepth*1.25)),width=s.age<.15?Math.max(.045,soil.rootDepth*2):s.age<1?Math.max(.1,soil.rootDepth*3):Number(soil.group.userData.profileWidth)||extent;extent=Math.max(h+depth,width*.78/Math.min(1,camera.aspect));targetY=(h-depth)*.43;desiredCamera.set(extent*.8,targetY+extent*.44,-extent*2.1);}else desiredCamera.set(extent*1.0,targetY+extent*.9,extent*1.65);desiredTarget.set(0,targetY,0);}
   if(p.autoFrame&&camera.position.length()>.001){fitting=true;}else{fitting=false;camera.position.copy(desiredCamera);controls.target.copy(desiredTarget);}controls.update();
  };
  const reset=()=>{userControlled=false;fitting=false;frameCamera();};
  function applyMode(){const p=live.current;sectionLight.visible=p.organView==='section'||p.organView==='root';if(!plant)return;plant.group.visible=p.organView!=='leaf'&&p.organView!=='root';if(soil)soil.group.visible=p.organView==='section'||p.organView==='root';if(leafDetail)leafDetail.visible=p.organView==='leaf';stage.visible=p.organView==='plant';plant.group.traverse(o=>{if(['leaf','flower'].includes(o.userData.organ))o.visible=p.mode!=='skeleton';if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if('wireframe'in m)(m as THREE.MeshStandardMaterial).wireframe=p.mode==='wire';});}
  const rebuild=()=>{const p=live.current,s=p.scenario;clearLeaf();dynamics?.dispose();if(plant){scene.remove(plant.group);plant.dispose();}if(soil){scene.remove(soil.group);soil.dispose();}const params={age:s.age,day:s.day,seed:s.seed,density:s.density};plant=['camphor','acer','ophiopogon'].includes(s.species)?buildAdditionalPlant(s.species as 'camphor'|'acer'|'ophiopogon',params):buildPlant(s.species as 'ginkgo'|'osmanthus'|'iris'|'oxalis',params);const rootSpecies=s.species;soil=buildRhizosphere(rootSpecies,{age:s.age,seed:s.seed,moisture:s.moisture,compaction:s.compaction,soilDepth:s.soilDepth,cutaway:true});scene.add(plant.group,soil.group);dynamics=createBeamDynamics(plant,physicalPriors(s.species,s.age));dynamics.update(time,s.wind,s.gravity*9.81,s.stiffness);p.onPhysicsStats({...dynamics.stats});makeLeaf();plantBounds.copy(modelBounds(plant.group));rootBounds.copy(modelBounds(soil.group,o=>o.userData.organ!=='soil'));soilBounds.copy(modelBounds(soil.group));leafBounds.copy(leafDetail?modelBounds(leafDetail):plantBounds);const size=plantBounds.getSize(new THREE.Vector3()),r=Math.max(.08,plant.height*.55,Math.max(size.x,size.z)*.7);ground.resize(r);p.onRootStats({rootDepth:soil.rootDepth,rootLength:soil.rootLength,rootTips:soil.rootTips,waterStress:soil.waterStress});applyMode();updateShadows();const key=`${s.species}:${p.organView}`;if(oldKey!==key){oldKey=key;reset();}else if(p.autoFrame&&!userControlled)frameCamera();prior=performance.now();since=prior;frames=0;p.onStats({height:plant.height,leaves:plant.leafCount,fps:0});};
  system.current={rebuild,reset,mode:applyMode};
  const resize=()=>{const r=container.getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();if(plant)frameCamera();};const observer=new ResizeObserver(resize);observer.observe(container);resize();rebuild();reset();
  const noise=(t:number)=>{const index=Math.floor(t),u=t-index,f=u*u*(3-2*u),hash=(v:number)=>{let n=Math.imul(v+live.current.scenario.seed,1597334677);n=Math.imul(n^(n>>>16),2246822519);return(n>>>0)/4294967295-.5;};return hash(index)*(1-f)+hash(index+1)*f;};
  const animate=(now:number)=>{raf=requestAnimationFrame(animate);const dt=Math.min(.05,(now-prior)/1000);prior=now;if(live.current.motion)time+=dt;const s=live.current.scenario;const gust=s.wind*Math.max(.15,1+.32*noise(time*.65)+.16*noise(time*2.7));dynamics?.update(time,gust,s.gravity*9.81,s.stiffness);if(fitting&&!userControlled){camera.position.lerp(desiredCamera,.10);controls.target.lerp(desiredTarget,.10);if(camera.position.distanceToSquared(desiredCamera)+controls.target.distanceToSquared(desiredTarget)<Math.max(1e-12,desiredCamera.distanceToSquared(desiredTarget)*1e-8))fitting=false;}controls.update();renderer.render(scene,camera);frames++;if(now-since>1800){if(dynamics)live.current.onPhysicsStats({...dynamics.stats});live.current.onStats({height:plant?.height||0,leaves:plant?.leafCount||0,fps:Math.round(frames*1000/(now-since))});frames=0;since=now;}};raf=requestAnimationFrame(animate);
  return()=>{cancelAnimationFrame(raf);observer.disconnect();controls.removeEventListener('start',takeCamera);controls.dispose();clearLeaf();dynamics?.dispose();plant?.dispose();soil?.dispose();ground.dispose();sun.shadow.dispose();sectionLight.shadow.dispose();fill.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();system.current=null;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{system.current?.rebuild();},[props.scenario.species,props.scenario.age,props.scenario.day,props.scenario.seed,props.scenario.density,props.scenario.moisture,props.scenario.compaction,props.scenario.soilDepth,props.organView]);
 useEffect(()=>{system.current?.mode();},[props.mode]);useEffect(()=>{system.current?.reset();},[props.resetKey]);
 return <div className="webgl" ref={holder} role="img" aria-label="可旋转缩放的三维植物、根系与土壤剖面"/>;
}
