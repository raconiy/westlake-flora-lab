import {rootCollarBridge} from '../lib/root-collar-bridge';
'use client';
import {useEffect,useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildPlant} from '../lib/plant-engine';
import {buildAdditionalPlant} from '../lib/additional-species';
import {buildRhizosphere} from '../lib/rhizosphere';
import {createBeamDynamics,type BeamDynamicsStats} from '../lib/beam-dynamics';
import {physicalPriors} from '../lib/physical-priors';
import {createGroundSurface} from '../lib/ground-surface';
import {createLeafDynamics} from '../lib/leaf-dynamics';
import {createLeafObservation} from '../lib/leaf-observation';
import {modelBounds,directionalShadowFrame,cameraFrameAction,modelGeometryFrame,unionGeometryFrames,perspectiveGeometryFrame,cameraContainsGeometry,perspectiveCameraRange} from '../lib/scene-framing';
import type {Scenario} from '../lib/species';
type RootStats={rootDepth:number;rootLength:number;rootTips:number;waterStress:number;profileDepth:number;profileScope:'local-root-zone-window-not-bedrock';availableSoilDepth:number};
type Props={scenario:Scenario;autoFrame:boolean;organView:'plant'|'section'|'root'|'leaf'|'stem';mode:string;resetKey:number;motion:boolean;onStats:(s:{leaves:number;height:number;fps:number})=>void;onRootStats:(s:RootStats)=>void;onPhysicsStats:(s:BeamDynamicsStats)=>void;onError:(s:string)=>void};
export default function PlantScene(props:Props){
 const holder=useRef<HTMLDivElement>(null),live=useRef(props);live.current=props;
 const system=useRef<{rebuild:()=>void;reset:()=>void;mode:()=>void;view:()=>void}|null>(null);
 useEffect(()=>{
  if(!holder.current)return;const container=holder.current;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});}catch{props.onError('当前浏览器无法初始化 WebGL，请开启硬件加速。');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.setClearColor(0xe8eee4,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;container.appendChild(renderer.domElement);
  let leafShaderFailed=false,leafFallbackPending=false,renderFailed=false,shaderFatal=false;
  // Three reports program-link failures without throwing. Only our injected
  // blade shader can be recovered by restoring the original materials.
  renderer.debug.onShaderError=(gl,_program,vertexShader)=>{
   if(gl.getShaderSource(vertexShader)?.includes('vec2 leafBend(')){
    if(!leafShaderFailed){leafShaderFailed=true;leafFallbackPending=true;}
   }else{shaderFatal=true;failRender('基础材质着色器编译失败，三维渲染已停止。请检查浏览器 WebGL 支持后刷新页面。');}
  };
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.001,180);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.7;
  // Artistic illumination only: restrained sky fill preserves crown depth.
  scene.add(new THREE.HemisphereLight(0xe9f1ff,0x75644e,.75));
  const sun=new THREE.DirectionalLight(0xfff4db,3.1);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);scene.add(sun,sun.target);
  const sunDirection=new THREE.Vector3(-7,13,8).normalize();
  const fill=new THREE.DirectionalLight(0xd9e8f2,.45);fill.position.set(7,4,-6);scene.add(fill);
  const sectionLight=new THREE.DirectionalLight(0xffefda,.85);sectionLight.position.set(-3,2,-6);sectionLight.visible=false;scene.add(sectionLight);
  // A neutral inspection light reveals surface details in the isolated organ
  // view. This is presentation lighting, not simulated leaf transmission or
  // a measured reflectance correction; whole-plant illumination is unchanged.
  const leafStudyLight=new THREE.DirectionalLight(0xffffff,1.5);
  leafStudyLight.position.set(2,3,6);leafStudyLight.visible=false;scene.add(leafStudyLight);
  const ground=createGroundSurface(),stage=ground.group;scene.add(stage);
  const desiredCamera=new THREE.Vector3(),desiredTarget=new THREE.Vector3();let fitting=false,userControlled=false;
  const plantBounds=new THREE.Box3(),rootBounds=new THREE.Box3(),soilBounds=new THREE.Box3(),leafBounds=new THREE.Box3();
  let plantGeometry:ReturnType<typeof modelGeometryFrame>={cells:[],bounds:new THREE.Box3()},soilGeometry=plantGeometry,rootGeometry=plantGeometry,leafGeometry=plantGeometry,sectionGeometry=plantGeometry;
  // OrbitControls emits start for drag, touch and wheel. Ownership persists after
  // end, through playback, stage transitions, mode changes and resize.
  const takeCamera=()=>{userControlled=true;fitting=false;};
  controls.addEventListener('start',takeCamera);
  let collarBridge:ReturnType<typeof rootCollarBridge>=null;
  let leafFlex:ReturnType<typeof createLeafDynamics>|null=null,detailFlex:ReturnType<typeof createLeafDynamics>|null=null;let dynamics:ReturnType<typeof createBeamDynamics>|null=null;let plant:ReturnType<typeof buildPlant>|null=null,soil:ReturnType<typeof buildRhizosphere>|null=null,leafDetail:THREE.Group|null=null,oldKey='',lastBuildKey='',buildFailed=false,time=0,prior=performance.now(),since=prior,frames=0,raf=0;
  function clearLeaf(){detailFlex?.dispose();detailFlex=null;if(!leafDetail)return;scene.remove(leafDetail);leafDetail.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});leafDetail=null;}
  function makeLeaf(){clearLeaf();if(!plant)return;leafDetail=createLeafObservation(plant.group,live.current.scenario.species);if(leafDetail){scene.add(leafDetail);if(!leafShaderFailed)detailFlex=createLeafDynamics(leafDetail);}}
  function stemFocus(){
   const r=Math.max(.008,plant?.branches[0]?.radius||.02),y=Math.max(.015,plant?.height||0)*.22;
   return new THREE.Box3(new THREE.Vector3(-r*4,y-r*4,-r*4),new THREE.Vector3(r*4,y+r*4,r*4));
  }
  function updateShadows(){
   const view=live.current.organView,box=(view==='leaf'?leafBounds:view==='root'?rootBounds:plantBounds).clone();
   if(view==='section')box.union(soilBounds);
   // A conservative wind envelope avoids a per-frame bounds traversal. The
   // detached leaf detail does not participate in the branch dynamics.
   if(view==='leaf')box.expandByScalar(Math.max(.001,box.getSize(new THREE.Vector3()).length()*.14));else box.expandByScalar(Math.max(.001,box.getSize(new THREE.Vector3()).length()*.16));
   const frame=directionalShadowFrame(box,sunDirection,sun.shadow.mapSize.x,view==='plant'?stage.position.y:undefined,view==='stem'?stemFocus():undefined);
   sun.position.copy(frame.position);sun.target.position.copy(frame.target);
   Object.assign(sun.shadow.camera,{left:frame.left,right:frame.right,bottom:frame.bottom,top:frame.top,near:frame.near,far:frame.far});
   sun.shadow.normalBias=frame.normalBias;sun.shadow.bias=frame.bias;sun.shadow.camera.updateProjectionMatrix();
  }
  function observationGeometry(){
   const view=live.current.organView;
   if(view==='stem'){const bounds=stemFocus();return {cells:[bounds],bounds};}
   if(view==='leaf')return leafGeometry;
   if(view==='root')return rootGeometry;
   if(view==='section')return sectionGeometry;
   return plantGeometry;
  }
  const frameCamera=(reclaim=false)=>{
   if(!plant)return;const view=live.current.organView,geometry=observationGeometry(),box=geometry.bounds;
   const direction=view==='root'?new THREE.Vector3(.2,.35,-2.15):view==='section'?new THREE.Vector3(.8,.44,-2.1):view==='leaf'?new THREE.Vector3(.45,.18,2.1):view==='stem'?new THREE.Vector3(4,1.5,6):new THREE.Vector3(1,.9,1.65);
   const frame=perspectiveGeometryFrame(geometry,direction,camera.fov,camera.aspect);
   desiredTarget.copy(frame.target);desiredCamera.copy(frame.position);
   const range=perspectiveCameraRange(box,userControlled&&!reclaim?camera.position:desiredCamera,userControlled&&!reclaim?controls.target:desiredTarget,frame.distance);
   camera.near=range.near;camera.far=range.far;controls.minDistance=range.minDistance;controls.maxDistance=range.maxDistance;camera.updateProjectionMatrix();
   const action=cameraFrameAction(userControlled,live.current.autoFrame,userControlled&&!reclaim||cameraContainsGeometry(geometry,camera),reclaim);
   if(action==='preserve')return;
   fitting=action==='ease';
   if(!fitting){
    // Flush OrbitControls' pending damping before a reset claims ownership.
    controls.enableDamping=false;controls.update();camera.position.copy(desiredCamera);controls.target.copy(desiredTarget);controls.update();controls.enableDamping=true;
   }
  };
  const reset=()=>{if(buildFailed){rebuild();return;}const retry=renderFailed&&!shaderFatal;if(retry)renderFailed=false;userControlled=false;fitting=false;frameCamera(true);if(retry){live.current.onError('');prior=performance.now();raf=requestAnimationFrame(animate);}};
  function applyMode(){const p=live.current;sectionLight.visible=p.organView==='section'||p.organView==='root';leafStudyLight.visible=p.organView==='leaf';if(!plant)return;plant.group.visible=p.organView!=='leaf'&&p.organView!=='root';if(soil){soil.group.visible=['plant','section','root'].includes(p.organView);for(const child of soil.group.children)child.visible=p.organView==='root'?child.userData.organ!=='soil':p.organView!=='plant'||child.userData.organ==='root-collar';}if(leafDetail)leafDetail.visible=p.organView==='leaf';stage.visible=p.organView==='plant';const style=(o:THREE.Object3D)=>{if(o instanceof THREE.Mesh&&['leaf','flower'].includes(o.userData.organ))o.visible=p.mode!=='skeleton';if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if('wireframe'in m)(m as THREE.MeshStandardMaterial).wireframe=p.mode==='wire';};plant.group.traverse(o=>{if(o.name==='woody-seed-establishment')o.visible=p.organView==='section';if(o instanceof THREE.Mesh&&(['root','rhizome'].includes(o.userData.organ)||['rhizome-propagule','rhizome','adventitious-root'].includes(o.userData.role)))o.visible=false;if(o instanceof THREE.Mesh&&['stolon-propagule','stolon-internode'].includes(o.userData.role))o.visible=p.organView==='plant';style(o);});soil?.group.traverse(style);leafDetail?.traverse(style);}
  const rebuild=()=>{const retryBuild=buildFailed;try{const p=live.current,s=p.scenario,buildKey=JSON.stringify([s.species,s.age,s.day,s.seed,s.density,s.moisture,s.compaction,s.soilDepth]);if(buildKey===lastBuildKey)return;clearLeaf();leafFlex?.dispose();leafFlex=null;dynamics?.dispose();if(plant){scene.remove(plant.group);plant.dispose();}if(soil){scene.remove(soil.group);soil.dispose();}plant=null;soil=null;dynamics=null;collarBridge=null;const params={age:s.age,day:s.day,seed:s.seed,density:s.density};plant=['camphor','acer','ophiopogon'].includes(s.species)?buildAdditionalPlant(s.species as 'camphor'|'acer'|'ophiopogon',params):buildPlant(s.species as 'ginkgo'|'osmanthus'|'iris'|'oxalis',params);const rootSpecies=s.species;const rootJoint=plant.branches.find(j=>j.order===0),shootCollar=rootJoint?{position:rootJoint.pivot.position.toArray() as [number,number,number],radius:rootJoint.radius*(s.species==='ginkgo'?1.35:s.species==='osmanthus'?1:1.4)}:undefined;soil=buildRhizosphere(rootSpecies,{age:s.age,seed:s.seed,moisture:s.moisture,compaction:s.compaction,soilDepth:s.soilDepth,density:s.density,shootCollar,cutaway:true});scene.add(plant.group,soil.group);if(!leafShaderFailed)leafFlex=createLeafDynamics(plant.group);dynamics=createBeamDynamics(plant,physicalPriors(s.species,s.age));collarBridge=rootCollarBridge(plant,soil);collarBridge?.update();makeLeaf();plantBounds.copy(modelBounds(plant.group));rootBounds.copy(modelBounds(soil.group,o=>o.userData.organ!=='soil'));soilBounds.copy(modelBounds(soil.group));leafBounds.copy(leafDetail?modelBounds(leafDetail):plantBounds);const size=plantBounds.getSize(new THREE.Vector3()),r=Math.max(.08,plant.height*.55,Math.max(size.x,size.z)*.7);ground.resize(r);p.onRootStats({rootDepth:soil.rootDepth,rootLength:soil.rootLength,rootTips:soil.rootTips,waterStress:soil.waterStress,profileDepth:soil.profileDepth,profileScope:soil.profileScope,availableSoilDepth:soil.availableSoilDepth});buildFailed=false;applyMode();
   // Build-time vertex pass; subsequent framing only visits compact occupied hulls.
   // Underground organs stay hidden in shoot views, as in applyMode above.
   // These two species' establishment meshes are wholly at/below soil zero.
   // Preserve them in section observations, but don't frame a visible seedling
   // around an occluded lateral samara wing or its underground connector.
   const buriedEstablishment=modelGeometryFrame(plant.group,{leafBending:false,include:o=>o.name==='woody-seed-establishment'});
   plantGeometry=modelGeometryFrame(plant.group,{pivots:plant.branches.map(b=>b.pivot),include:o=>o.name!=='woody-seed-establishment'&&!['root','rhizome'].includes(o.userData.organ)&&!['rhizome-propagule','rhizome','adventitious-root'].includes(o.userData.role)});
   const collarPivot=plant.branches.find(b=>b.order===0)?.pivot.getWorldPosition(new THREE.Vector3());
   const collarDisplacement=(mesh:THREE.Mesh)=>{
    if(mesh.userData.organ!=='root-collar'||!collarPivot)return 0;
    // The bridge follows the rotating basal bark ring while its bottom stays
    // fixed. Its interpolation weights are <=1, so a ring chord bounds it.
    const positions=mesh.geometry.getAttribute('position'),point=new THREE.Vector3();let radius=0;
    for(let i=0;i<positions.count;i++)radius=Math.max(radius,point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).distanceTo(collarPivot));
    return 2*Math.sin(.28/2)*radius;
   };
   soilGeometry=modelGeometryFrame(soil.group,{leafBending:false,displacement:collarDisplacement});
   rootGeometry=modelGeometryFrame(soil.group,{include:o=>o.userData.organ!=='soil',leafBending:false,displacement:collarDisplacement});
   const collarGeometry=modelGeometryFrame(soil.group,{include:o=>o.userData.organ==='root-collar',leafBending:false,displacement:collarDisplacement});
   leafGeometry=leafDetail?modelGeometryFrame(leafDetail):plantGeometry;
   sectionGeometry=unionGeometryFrames(plantGeometry,soilGeometry,buriedEstablishment);
   // The aerial collar follows the same basal bark ring already bounded by
   // plantGeometry. Its fixed underground skirt is occluded by soil and must
   // not pull a millimetre seedling camera below/to the side of the subject.
   // Root/section observations keep the entire collar via soilGeometry.

   // Cache the full bounded motion envelope from REST, then apply the actual current load.
   dynamics.update(time,s.wind,s.gravity*9.81,s.stiffness);collarBridge?.update();p.onPhysicsStats({...dynamics.stats});
   updateShadows();const key=`${s.species}:${p.organView}`;if(oldKey!==key){oldKey=key;reset();}else frameCamera();prior=performance.now();since=prior;frames=0;p.onStats({height:plant.height,leaves:plant.leafCount,fps:0});lastBuildKey=buildKey;if(retryBuild&&renderFailed)reset();}catch(error){console.error('PlantScene rebuild failed',error);clearLeaf();leafFlex?.dispose();leafFlex=null;dynamics?.dispose();dynamics=null;collarBridge=null;if(plant){scene.remove(plant.group);plant.dispose();plant=null;}if(soil){scene.remove(soil.group);soil.dispose();soil=null;}buildFailed=true;lastBuildKey='';failRender('植物几何生成失败，已停止场景更新。请使用复位相机重试；参数快照仍保留。');}};
  system.current={rebuild,reset,mode:applyMode,view:()=>{applyMode();updateShadows();reset();}};
  const resize=()=>{const r=container.getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();if(plant)frameCamera();};const observer=new ResizeObserver(resize);observer.observe(container);resize();rebuild();reset();
  const noise=(t:number)=>{const index=Math.floor(t),u=t-index,f=u*u*(3-2*u),hash=(v:number)=>{let n=Math.imul(v+live.current.scenario.seed,1597334677);n=Math.imul(n^(n>>>16),2246822519);return(n>>>0)/4294967295-.5;};return hash(index)*(1-f)+hash(index+1)*f;};
  function failRender(message:string){
   if(renderFailed)return;renderFailed=true;cancelAnimationFrame(raf);raf=0;live.current.onError(message);
  }
  function restoreLeafMaterials(){
   if(!leafFallbackPending)return;
   leafFlex?.dispose();detailFlex?.dispose();leafFlex=null;detailFlex=null;leafFallbackPending=false;
   if(!renderFailed)live.current.onError('叶片弯曲着色器初始化失败，已回退基础材质；枝条力学仍可观察。');
  }
  function animate(now:number){
   raf=0;if(renderFailed)return;
   try{
    restoreLeafMaterials();const dt=Math.min(.05,(now-prior)/1000);prior=now;if(live.current.motion)time+=dt;
    const s=live.current.scenario,gust=s.wind*Math.max(.15,1+.32*noise(time*.65)+.16*noise(time*2.7));
    dynamics?.update(time,gust,s.gravity*9.81,s.stiffness);collarBridge?.update();leafFlex?.update(gust,s.gravity*9.81,s.stiffness);detailFlex?.update(gust,s.gravity*9.81,s.stiffness);
    if(fitting&&!userControlled){camera.position.lerp(desiredCamera,.10);controls.target.lerp(desiredTarget,.10);if(camera.position.distanceToSquared(desiredCamera)+controls.target.distanceToSquared(desiredTarget)<Math.max(1e-12,desiredCamera.distanceToSquared(desiredTarget)*1e-8))fitting=false;}
    controls.update();renderer.render(scene,camera);restoreLeafMaterials();
    if(renderFailed)return;
    frames++;if(now-since>1800){if(dynamics)live.current.onPhysicsStats({...dynamics.stats});live.current.onStats({height:plant?.height||0,leaves:plant?.leafCount||0,fps:Math.round(frames*1000/(now-since))});frames=0;since=now;}
   }catch(error){
    // Some drivers throw after reporting the failed link. Retry once with the
    // confirmed blade patch removed; any failure of the base render is fatal.
    if(leafFallbackPending&&!renderFailed){restoreLeafMaterials();raf=requestAnimationFrame(animate);return;}
    console.error('PlantScene animation failed',error);
    failRender('三维渲染发生异常，已停止更新。请重置视图重试；若仍失败，请检查浏览器 WebGL 支持。');return;
   }
   raf=requestAnimationFrame(animate);
  }
  raf=requestAnimationFrame(animate);
  return()=>{cancelAnimationFrame(raf);observer.disconnect();controls.removeEventListener('start',takeCamera);controls.dispose();clearLeaf();leafFlex?.dispose();dynamics?.dispose();plant?.dispose();soil?.dispose();ground.dispose();sun.shadow.dispose();sectionLight.shadow.dispose();fill.shadow.dispose();leafStudyLight.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();system.current=null;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{system.current?.rebuild();},[props.scenario.species,props.scenario.age,props.scenario.day,props.scenario.seed,props.scenario.density,props.scenario.moisture,props.scenario.compaction,props.scenario.soilDepth]);
 useEffect(()=>{system.current?.view();},[props.organView]);
 useEffect(()=>{system.current?.mode();},[props.mode]);useEffect(()=>{system.current?.reset();},[props.resetKey]);
 return <div className="webgl" ref={holder} role="img" aria-label="可旋转缩放的三维植物、根系与土壤剖面"/>;
}
