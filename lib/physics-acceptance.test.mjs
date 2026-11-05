import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPlant} from './plant-engine.ts';
import {buildAdditionalPlant} from './additional-species.ts';
import {buildRhizosphere} from './rhizosphere.ts';
import {createBeamDynamics} from './beam-dynamics.ts';
import {physicalPriors} from './physical-priors.ts';
import {woodSections,sectionVolume} from './wood-loads.ts';
import {initialScenario,getSpecies} from './species.ts';

// Acceptance of this representation, NOT field measurements or full FEM.
// Fixed scenario values below are test inputs, not species parameter estimates.
// Primary research supplied with the task:
// https://doi.org/10.1093/jxb/erz288 (distinct reconfiguration mechanisms)
// https://doi.org/10.1111/j.1469-8137.2011.03887.x (species differences).
const speciesIds=['ginkgo','osmanthus','camphor','acer'];
const params={age:12,day:180,seed:42,density:1};
const build=(species,p=params)=>['camphor','acer'].includes(species)?buildAdditionalPlant(species,p):buildPlant(species,p);
const advance=(d,wind,gravity)=>{for(let i=0;i<=120;i++)d.update(i/120,wind,gravity,1);};

// Independent world-vertex triangle sum, including each blade instance.
function actualBladeArea(model){
 let area=0;
 model.group.traverse(mesh=>{
  if(!mesh.isMesh||mesh.userData.organ!=='leaf'||mesh.geometry.type==='CylinderGeometry'||mesh.userData.organPart==='petiole')return;
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index,instance=new THREE.Matrix4(),world=new THREE.Matrix4();
  for(let j=0;j<(mesh.isInstancedMesh?mesh.count:1);j++){
   if(mesh.isInstancedMesh){mesh.getMatrixAt(j,instance);world.multiplyMatrices(mesh.matrixWorld,instance);}else world.copy(mesh.matrixWorld);
   const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
   for(let i=0;i<(index?index.count:p.count);i+=3){
    a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(world);
    b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(world);
    c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(world);
    area+=b.sub(a).cross(c.sub(a)).length()/2;
   }
  }
 });return area;
}

for(const species of speciesIds)test(`${species}: actual wood/leaf mass, 3.2 m/s demand and saturation remain explicit`,t=>{
 const model=build(species),prior=physicalPriors(species,params.age),d=createBeamDynamics(model,prior);
 try{
  model.group.updateMatrixWorld(true);let volume=0,sections=0;
  model.group.traverse(mesh=>{
   if(!mesh.isMesh||mesh.isInstancedMesh)return;
   const records=woodSections(mesh.geometry);sections+=records.filter(s=>new THREE.Vector3(...s.a).distanceToSquared(new THREE.Vector3(...s.b))>0).length;
   volume+=records.reduce((n,s)=>n+sectionVolume(s),0)*Math.abs(mesh.matrixWorld.determinant());
  });
  const bladeArea=actualBladeArea(model),expected=volume*prior.woodDensityKgM3+bladeArea*prior.leafArealMassKgM2;
  assert.ok(Math.abs(d.stats.estimatedMassKg/expected-1)<1e-7,'resolved wood replaces the primary proxy, and leaves are counted once');
  assert.ok(Math.abs(d.stats.leafAreaM2/bladeArea-1)<1e-7);assert.equal(d.stats.countedLeaves,model.leafCount);assert.equal(d.stats.resolvedWoodSegments,sections);
  // At zero elapsed time, static demand must be independent of the integrator.
  d.update(0,3.2,0,1);const windOnly=d.stats.maxUnclampedTargetRad;
  d.update(0,0,9.81,1);const gravityOnly=d.stats.maxUnclampedTargetRad;
  advance(d,3.2,9.81);
  const raw=d.stats.maxUnclampedTargetRad,clipped=d.stats.clampedBranches,index=d.stats.maxTargetBranchIndex,b=model.branches[index];
  assert.equal(d.stats.youngModulusPa,prior.youngModulusPa);assert.equal(d.stats.droppedTimeSeconds,0);
  assert.ok(model.branches.every(b=>b.pivot.quaternion.toArray().every(Number.isFinite)));
  assert.ok(d.stats.maxDeflectionRad<=.28+1e-12);
  assert.equal(d.stats.outOfRange,raw>.28);
  assert.equal(clipped>0,raw>.28);
  if(species==='osmanthus'){
   assert.ok(raw>1&&windOnly>.28&&gravityOnly>.28,'current scaffold/leaf load representation exceeds the linear range even before integration');
  }else assert.ok(raw<.28,'this reproducible scenario remains within the declared per-joint range');
  t.diagnostic(JSON.stringify({species,branches:model.branches.length,massKg:d.stats.estimatedMassKg,windForceN:d.stats.windForceN,leafAreaM2:bladeArea,rawTargetRad:raw,windOnlyRad:windOnly,gravityOnlyRad:gravityOnly,clipped,displayedMaxRad:d.stats.maxDeflectionRad,worstBranch:{index,order:b.order,lengthM:b.length,radiusM:b.radius}}));
  // Range limit is a guard, not a load-dependent E calibration. A different
  // guard changes the bounded pose but must leave the linear demand unchanged.
  if(species==='osmanthus'){
   const wider=createBeamDynamics(model,{...prior,maxDeflectionRad:.5});wider.update(0,3.2,9.81,1);
   assert.ok(Math.abs(wider.stats.maxUnclampedTargetRad/raw-1)<1e-12);assert.ok(wider.stats.clampedBranches>0);wider.dispose();
  }
 }finally{d.dispose();model.dispose();}
});

test('3.2 m/s is checked at the actual initial and species-selection defaults too',t=>{
 const cases=[{...initialScenario,label:'initial'},...speciesIds.map(species=>({...initialScenario,species,age:getSpecies(species).defaultAge,day:species==='osmanthus'?270:species==='camphor'?180:305,label:'species-selection'}))];
 for(const p of cases){
  const model=build(p.species,p),d=createBeamDynamics(model,physicalPriors(p.species,p.age));
  try{
   advance(d,p.wind,p.gravity*9.81);
   assert.ok(Number.isFinite(d.stats.maxUnclampedTargetRad)&&Number.isFinite(d.stats.windForceN));
   assert.ok(d.stats.maxDeflectionRad<=.28+1e-12);assert.equal(d.stats.droppedTimeSeconds,0);
   assert.equal(d.stats.clampedBranches>0,d.stats.maxUnclampedTargetRad>.28);
   assert.equal(d.stats.clampedBranches>0,p.label==='species-selection'&&['ginkgo','osmanthus'].includes(p.species),'track which actual defaults exceed the linear guard');
   t.diagnostic(JSON.stringify({scenario:p.label,species:p.species,age:p.age,day:p.day,branches:model.branches.length,rawTargetRad:d.stats.maxUnclampedTargetRad,clipped:d.stats.clampedBranches,displayedMaxRad:d.stats.maxDeflectionRad}));
  }finally{d.dispose();model.dispose();}
 }
});

function basalRing(mesh){
 const g=mesh.geometry,p=g.attributes.position;
 const n=g.type==='CylinderGeometry'?g.parameters.radialSegments:g.userData.woodTube.sides;
 const start=g.type==='CylinderGeometry'?g.parameters.heightSegments*(n+1):0;
 return Array.from({length:n},(_,i)=>new THREE.Vector3().fromBufferAttribute(p,start+i));
}

// Clip actual basal polygon edges against every face of the fixed convex flare.
// This checks geometric intersection, not just matching origins or AABBs.
function ringContact(ring,junction){
 const p=junction.geometry.attributes.position,index=junction.geometry.index,planes=[];
 for(let i=0;i<(index?index.count:p.count);i+=3){
  const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(junction.matrixWorld));
  if(points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).lengthSq()>1e-24)planes.push(new THREE.Plane().setFromCoplanarPoints(...points));
 }
 let intersectingEdges=0;
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length];let lo=0,hi=1;
  for(const plane of planes){
   const da=plane.distanceToPoint(a)-1e-9,db=plane.distanceToPoint(b)-1e-9;
   if(da>0&&db>0){lo=2;break;}
   if(da>0)lo=Math.max(lo,da/(da-db));else if(db>0)hi=Math.min(hi,da/(da-db));
  }
  if(lo<=hi)intersectingEdges++;
 }
 const top=junction.userData.top[1];
 return {intersectingEdges,ringEdges:ring.length,maxAboveFlareM:Math.max(...ring.map(p=>p.y-top)),minAboveFlareM:Math.min(...ring.map(p=>p.y-top))};
}

test('actual basal rings intersect the fixed PlantScene flare without guaranteeing a closed circumference',t=>{
 for(const species of speciesIds)for(const age of [.2,8,12]){
  const p={...params,age},model=build(species,p),joint=model.branches.find(b=>b.order===0);
  // Exactly the PlantScene collar convention; do not substitute branch.radius.
  const shootCollar={position:joint.pivot.position.toArray(),radius:joint.radius*(species==='ginkgo'?1.35:species==='osmanthus'?1:1.4)};
  const roots=buildRhizosphere(species,{...p,moisture:.62,compaction:.25,soilDepth:2.5,cutaway:true,shootCollar});
  const junction=roots.group.getObjectByName('root-shoot-junction');assert.ok(junction);
  const mesh=joint.pivot.children.find(o=>o.isMesh&&!o.isInstancedMesh&&woodSections(o.geometry).length),ring=basalRing(mesh);
  const d=createBeamDynamics(model,physicalPriors(species,age));
  try{
   model.group.updateMatrixWorld(true);roots.group.updateMatrixWorld(true);
   const rest=ringContact(ring.map(p=>p.clone().applyMatrix4(mesh.matrixWorld)),junction);
   for(const [wind,gravity] of [[3.2,9.81],[12,19.62]]){
    advance(d,wind,gravity);model.group.updateMatrixWorld(true);roots.group.updateMatrixWorld(true);
    const contact=ringContact(ring.map(p=>p.clone().applyMatrix4(mesh.matrixWorld)),junction);
    assert.ok(joint.pivot.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...junction.userData.top))<1e-8);
    assert.ok(contact.intersectingEdges>0,`${species}/${age}: basal ring must actually intersect the flare`);
    assert.ok(contact.minAboveFlareM<1e-8,'part of the actual ring reaches the fixed flare');
    if(age===12&&wind===3.2)assert.ok(contact.maxAboveFlareM>1e-6,'fixed pivot is insufficient for circumferential closure');
    if(age===12)assert.equal(ringContact(ring.map(p=>p.clone().applyMatrix4(mesh.matrixWorld).add(new THREE.Vector3(0,1,0))),junction).intersectingEdges,0,'contact check must reject a genuinely lifted ring');
    t.diagnostic(JSON.stringify({species,age,windMS:wind,gravityMS2:gravity,...contact,restMaxAboveFlareM:rest.maxAboveFlareM,loadChangeInMaxAboveFlareM:contact.maxAboveFlareM-rest.maxAboveFlareM}));
   }
  }finally{d.dispose();model.dispose();roots.dispose();}
 }
});
