import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
const defaults = { age: 18, day: 180, seed: 42, density: 1 };
function boneSignature(model) { return model.branches.map(b => [b.length,b.radius,...b.pivot.position.toArray(),...b.rest.toArray()]); }
test('season changes ginkgo foliage while preserving woody skeleton', () => {
 const summer = buildPlant('ginkgo', defaults);
 const winter = buildPlant('ginkgo', {...defaults,day:15});
 assert.ok(summer.leafCount > 1000); assert.equal(winter.leafCount,0);
 assert.deepEqual(boneSignature(summer), boneSignature(winter));
 summer.dispose();winter.dispose();
});
test('evergreen osmanthus retains leaves and deterministic architecture across seasons', () => {
 const spring = buildPlant('osmanthus', {...defaults,day:120});
 const autumn = buildPlant('osmanthus', {...defaults,day:280});
 assert.equal(spring.leafCount,autumn.leafCount); assert.ok(spring.leafCount>0);
 assert.deepEqual(boneSignature(spring),boneSignature(autumn));
 spring.dispose();autumn.dispose();
});
test('age grows height and introduces branch cohorts', () => {
 const young = buildPlant('ginkgo',{...defaults,age:1});
 const mature = buildPlant('ginkgo',{...defaults,age:30});
 assert.ok(mature.height>young.height); assert.ok(mature.branches.length>young.branches.length);
 young.dispose();mature.dispose();
});
test('seed gives reproducible geometry; changing it changes morphology', () => {
 const a=buildPlant('ginkgo',defaults), b=buildPlant('ginkgo',defaults), c=buildPlant('ginkgo',{...defaults,seed:73});
 assert.deepEqual(boneSignature(a),boneSignature(b)); assert.notDeepEqual(boneSignature(a),boneSignature(c));
 a.dispose();b.dispose();c.dispose();
});
test('wind and gravity produce bounded, finite branch rotations and zero loads restore rest', () => {
 for(const species of ['ginkgo','osmanthus','iris','oxalis']) {
  const model=buildPlant(species,defaults); assert.ok(Number.isFinite(model.height));assert.ok(model.height>0);
  model.update(3,10,9.81,1); assert.ok(model.branches.some(b=>b.pivot.quaternion.angleTo(b.rest)>.00001));
  for(const b of model.branches) assert.ok(b.pivot.quaternion.toArray().every(Number.isFinite));
  model.update(3,0,0,1); for(const b of model.branches) assert.ok(b.pivot.quaternion.angleTo(b.rest)<.00001);
  model.dispose();assert.equal(model.group.children.length,0);
 }
});
test('leaf and flower renderables carry organ labels for skeleton mode', () => {
 for (const [species,day] of [['ginkgo',180],['osmanthus',280],['iris',120],['oxalis',180]]) {
  const model=buildPlant(species,{...defaults,day}); let leaves=0,flowers=0;
  model.group.traverse(o=>{if(o.isMesh && o.userData.organ==='leaf')leaves++;if(o.isMesh && o.userData.organ==='flower')flowers++;});
  assert.ok(leaves>0,`${species} has tagged leaves`);
  if(species!=='ginkgo')assert.ok(flowers>0,`${species} has tagged flowers during its flowering window`);
  model.group.traverse(o=>{o.visible=!['leaf','flower'].includes(o.userData.organ)});
  model.group.traverse(o=>{if(['leaf','flower'].includes(o.userData.organ))assert.equal(o.visible,false)});
  model.dispose();
 }
});
test('tree leaf geometry is centimeter-scale and ginkgo winter loses foliage drag',()=>{
 for(const species of ['ginkgo','osmanthus']) {
  const model=buildPlant(species,defaults);let leaf;
  model.group.traverse(o=>{if(!leaf && o.isInstancedMesh && o.userData.organ==='leaf' && o.userData.connectedBy==='petiole')leaf=o});
  assert.ok(leaf);leaf.geometry.computeBoundingBox();const bb=leaf.geometry.boundingBox;
  const width=bb.max.x-bb.min.x,length=bb.max.y-bb.min.y;
  if(species==='ginkgo')assert.ok(width>=.06 && width<=.085);
  else {assert.ok(width>=.026&&width<=.045);assert.ok(length>=.07&&length<=.145);}
  model.dispose();
 }
 const summer=buildPlant('ginkgo',defaults),winter=buildPlant('ginkgo',{...defaults,day:15});
 summer.update(2,7,0,1);winter.update(2,7,0,1);
 const bend=m=>m.branches.reduce((sum,b)=>sum+b.pivot.quaternion.angleTo(b.rest),0);
 assert.ok(bend(winter)>0,'woody wind drag remains');assert.ok(bend(summer)>bend(winter)*2,'foliage drag falls in winter');
 summer.dispose();winter.dispose();
});

test('gravity leaves a vertical leader straight and bends inclined branches toward world down', () => {
 const model=buildPlant('osmanthus',defaults),up=new THREE.Vector3(0,1,0);
 model.group.updateMatrixWorld(true);
 const vertical=model.branches[0];
 const inclined=model.branches.find(b=>b.order===1 && up.clone().applyQuaternion(b.pivot.getWorldQuaternion(new THREE.Quaternion())).y<.97);
 assert.ok(inclined,'model has an inclined first-order branch');
 const restDirection=up.clone().applyQuaternion(inclined.pivot.getWorldQuaternion(new THREE.Quaternion()));
 model.update(0,0,9.81,1);model.group.updateMatrixWorld(true);
 assert.ok(vertical.pivot.quaternion.angleTo(vertical.rest)<1e-7,'vertical main axis has no gravity torque');
 const loadedDirection=up.clone().applyQuaternion(inclined.pivot.getWorldQuaternion(new THREE.Quaternion()));
 assert.ok(loadedDirection.y<restDirection.y,'inclined branch turns toward world gravity');
 const restAzimuth=Math.atan2(restDirection.z,restDirection.x),loadedAzimuth=Math.atan2(loadedDirection.z,loadedDirection.x);
 assert.ok(Math.abs(restAzimuth-loadedAzimuth)<1e-6,'gravity does not introduce an arbitrary sideways bend');
 model.update(0,0,0,1);for(const b of model.branches)assert.ok(b.pivot.quaternion.angleTo(b.rest)<1e-7);
 model.dispose();
});

test('ginkgo has connected petioles, curved tapered wood, and hypogeal early stages',()=>{
 const seed=buildPlant('ginkgo',{...defaults,age:0});assert.equal(seed.leafCount,0);assert.match(seed.stageLabel,/种子/);let seedCoat=false;seed.group.traverse(o=>{if(o.userData.organ==='seed')seedCoat=true});assert.ok(seedCoat);seed.dispose();
 const seedling=buildPlant('ginkgo',{...defaults,age:.2});assert.ok(seedling.leafCount>0);assert.match(seedling.stageLabel,/幼苗/);seedling.dispose();
 const mature=buildPlant('ginkgo',defaults);let blades=0,petioles=0,hasBarkMap=false;
 mature.group.traverse(o=>{if(o.isInstancedMesh&&o.userData.connectedBy==='petiole')blades+=o.count;else if(o.isInstancedMesh&&o.userData.organ==='leaf')petioles+=o.count;if(o.isMesh&&o.material.map&&o.material.bumpMap)hasBarkMap=true});
 assert.equal(blades,petioles,'every blade has a supporting petiole');assert.equal(blades,mature.leafCount);assert.ok(hasBarkMap);assert.match(mature.group.userData.reproduction,/not-modeled/);mature.dispose();
});
test('ginkgo seedling leaves alternate around the stem and the terminal bud remains millimetre scale',()=>{
 const p=buildPlant('ginkgo',{...defaults,age:.5});let leaves,bud;
 p.group.traverse(o=>{if(o.isInstancedMesh&&o.userData.connectedBy==='petiole')leaves=o;if(o.name==='terminal-bud')bud=o});
 assert.ok(leaves&&leaves.count>=4);const points=[],m=new THREE.Matrix4();
 for(let i=0;i<leaves.count;i++){leaves.getMatrixAt(i,m);points.push(new THREE.Vector3().setFromMatrixPosition(m));}
 assert.ok(points.some(v=>v.x<-.003)&&points.some(v=>v.x>.003),'true leaves do not all emerge on one side');
 assert.ok(points.some(v=>v.z<-.003)&&points.some(v=>v.z>.003),'spiral phyllotaxis occupies both depth directions');
 assert.ok(bud);assert.ok(bud.scale.y*2<.004,'seedling terminal bud is below 4 mm long');
 p.dispose();
});
test('ginkgo fan surfaces predominantly face the sky without enlarging the blade',()=>{
 const p=buildPlant('ginkgo',defaults);p.group.updateMatrixWorld(true);let upward=0,count=0;const local=new THREE.Matrix4(),world=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3();
 p.group.traverse(o=>{if(!o.isInstancedMesh||o.userData.connectedBy!=='petiole')return;for(let i=0;i<o.count;i+=Math.max(1,Math.floor(o.count/25))){o.getMatrixAt(i,local);world.multiplyMatrices(o.matrixWorld,local);normalMatrix.getNormalMatrix(world);const normal=new THREE.Vector3(0,0,1).applyNormalMatrix(normalMatrix);if(normal.y>.35)upward++;count++;}});
 assert.ok(upward/count>.75,'surface orientation exposes broad fans rather than needle-like edges');
 assert.ok(p.leafCount>17000,'crown fills via connected fine shoots and leaves, not oversized blades');p.dispose();
});
test('expanding adult ginkgo crown fills a measurable area deficit using connected fine-shoot cohorts',()=>{
 const summer=buildPlant('ginkgo',{...defaults,age:45,day:120}),winter=buildPlant('ginkgo',{...defaults,age:45,day:15}),m=summer.group.userData.canopyMetrics;
 assert.ok(m.connectedFineShootCohorts>1000,'adult canopy gains actual supporting terminal shoots');
 assert.ok(m.oneSidedLeafAreaM2>150);assert.ok(m.projectedCrownAreaM2>50);assert.ok(m.leafAreaRatio>=2&&m.leafAreaRatio<=3.5,'one-sided mesh area / crown projection is in engineering density range');
 assert.ok(m.potentialLeafCount<=m.maxLeafBudget);assert.ok(summer.leafCount>80000);assert.equal(winter.leafCount,0);
 assert.equal(winter.group.userData.canopyMetrics.oneSidedLeafAreaM2,0);assert.equal(winter.group.userData.canopyMetrics.connectedFineShootCohorts,m.connectedFineShootCohorts);
 assert.deepEqual(boneSignature(summer),boneSignature(winter));let draw=0,petioles=0,blades=0;
 summer.group.traverse(o=>{if(o.isMesh)draw++;if(o.isInstancedMesh&&o.userData.connectedBy==='petiole')blades+=o.count;else if(o.isInstancedMesh&&o.userData.organ==='leaf')petioles+=o.count});
 assert.equal(petioles,blades,'every additional blade retains its physical petiole');assert.ok(draw<=112,'cohorts remain merged/instanced');
 assert.match(m.calibration,/not measured stand LAI/);summer.dispose();winter.dispose();
});

test('osmanthus progresses from a seed through true-leaf seedling to gradual branching',()=>{
 const stages=[0,.04,.2,1,3,18].map(age=>buildPlant('osmanthus',{...defaults,age}));
 const [seed,sprout,seedling,yearling,juvenile,adult]=stages;
 assert.equal(seed.branches.length,0,'age zero has a seed, not a woody stump');assert.equal(seed.leafCount,0);
 assert.ok(seed.group.children.some(o=>o.userData.organ==='seed'));assert.match(seed.stageLabel,/种子/);
 assert.equal(sprout.leafCount,0);assert.equal(sprout.branches.length,1);assert.match(sprout.stageLabel,/胚根与芽/);
 assert.ok(seedling.leafCount>=2&&seedling.leafCount<=4);assert.equal(seedling.branches.length,1);assert.match(seedling.stageLabel,/真叶幼苗/);
 assert.ok(yearling.leafCount>=8&&yearling.leafCount<=24,'one year does not instantiate 784 leaves');
 assert.ok(yearling.branches.length<=3&&yearling.branches.every(b=>b.order<=1),'descendant axes have their own birth times');
 assert.ok(juvenile.leafCount>yearling.leafCount);assert.ok(adult.leafCount>1000);
 assert.ok(juvenile.height>yearling.height&&adult.height>juvenile.height);
 assert.equal(seed.group.userData.priors.calibration,'uncalibrated-engineering-prior');
 assert.match(seed.group.userData.priors.source,/not empirical/);assert.ok(seed.group.userData.priors.thresholds.branching);
 for(const m of stages)m.dispose();
});

test('osmanthus geometry stays continuous across germination, leaf and branch cohort boundaries',()=>{
 for(const age of [.012,.035,.10,.12,.25,.30,.8,.9,1,1.45,2.4,2.95]) {
  const a=buildPlant('osmanthus',{...defaults,age:age-1e-5}),b=buildPlant('osmanthus',{...defaults,age:age+1e-5});
  const ba=new THREE.Box3().setFromObject(a.group),bb=new THREE.Box3().setFromObject(b.group);
  assert.ok(ba.min.distanceTo(bb.min)<.0002&&ba.max.distanceTo(bb.max)<.0002,`bounds remain continuous at ${age} years`);
  // Compare persistent axes by their deterministic phase; new axes start at zero size.
  const previous=new Map(a.branches.map(j=>[j.phase,j]));
  for(const j of b.branches) {
   const old=previous.get(j.phase);
   if(old){assert.ok(Math.abs(j.length-old.length)<.0001);assert.ok(Math.abs(j.radius-old.radius)<.00001);assert.ok(j.pivot.position.distanceTo(old.pivot.position)<.0001);}
   else {assert.ok(j.length<1e-6);assert.ok(j.radius<1e-6);}
  }
  a.dispose();b.dispose();
 }
});

test('every osmanthus blade has an axis-connected petiole and pairs are opposite decussate',()=>{
 for(const [age,density] of [[.2,1],[1,1],[18,.15],[18,1],[18,2]]) {
  const model=buildPlant('osmanthus',{...defaults,age,density});model.update(2,7,9.81,1);model.group.updateMatrixWorld(true);
  const joints=new Map(model.branches.map(b=>[b.pivot,b]));let count=0;
  model.group.traverse(o=>{
   if(!o.isInstancedMesh||o.userData.connectedBy!=='petiole')return;
   const stalk=o.parent.children.find(s=>s.userData.role==='petiole');assert.ok(stalk);assert.equal(stalk.count,o.count);assert.equal(o.count%2,0);
   let previousDirection;
   for(let i=0;i<o.count;i+=2){
    const starts=[],directions=[];
    for(let side=0;side<2;side++){
     const pm=new THREE.Matrix4(),lm=new THREE.Matrix4();stalk.getMatrixAt(i+side,pm);o.getMatrixAt(i+side,lm);
     const start=new THREE.Vector3(0,-.5,0).applyMatrix4(pm),tip=new THREE.Vector3(0,.5,0).applyMatrix4(pm),base=new THREE.Vector3().applyMatrix4(lm);
     assert.ok(Math.hypot(start.x,start.z)<2e-6,'petiole emerges on the supporting branch centreline');
     assert.ok(start.y>=0&&start.y<=joints.get(o.parent).length,'attachment lies within the actual branch');
     assert.ok(tip.distanceTo(base)<2e-6,'petiole tip coincides with blade base');
     assert.ok(tip.clone().applyMatrix4(stalk.matrixWorld).distanceTo(base.clone().applyMatrix4(o.matrixWorld))<2e-6,'wind/gravity preserve the connection');
     starts.push(start);directions.push(tip.clone().sub(start).setY(0).normalize());count++;
    }
    assert.ok(starts[0].distanceTo(starts[1])<2e-6,'both leaves share exactly one node');
    assert.ok(directions[0].dot(directions[1])<-.9999,'pair members point in opposite directions');
    if(previousDirection)assert.ok(Math.abs(previousDirection.dot(directions[0]))<.0001,'successive pair planes differ by 90 degrees');
    previousDirection=directions[0];
   }
  });
  assert.equal(count,model.leafCount);model.dispose();
 }
});

test('each four-lobed osmanthus flower shares a centre and normal and connects to a leaf axil',()=>{
 const model=buildPlant('osmanthus',{...defaults,age:8,day:280});model.update(2,6,9.81,1);model.group.updateMatrixWorld(true);let count=0;
 model.group.traverse(o=>{
  if(!o.isInstancedMesh||o.userData.role!=='corolla-lobes')return;
  const stalks=o.parent.children.find(s=>s.userData.role==='axillary-peduncle'),cores=o.parent.children.find(s=>s.userData.role==='center');
  const leaves=o.parent.children.find(s=>s.userData.connectedBy==='petiole');assert.ok(leaves);
  assert.equal(o.count%4,0);assert.equal(stalks.count,o.count/4);assert.equal(cores.count,stalks.count);
  for(let f=0;f<stalks.count;f++){
   const sm=new THREE.Matrix4(),cm=new THREE.Matrix4();stalks.getMatrixAt(f,sm);cores.getMatrixAt(f,cm);
   const start=new THREE.Vector3(0,-.5,0).applyMatrix4(sm),tip=new THREE.Vector3(0,.5,0).applyMatrix4(sm),center=new THREE.Vector3().applyMatrix4(cm);
   assert.ok(Math.hypot(start.x,start.z)<2e-6);assert.ok(leaves.userData.nodes.some(n=>start.distanceTo(new THREE.Vector3(...n.attachment))<2e-6),'flower peduncle starts at a real leaf node');
   assert.ok(center.distanceTo(tip)<2e-6);const normals=[],rays=[];
   for(let p=0;p<4;p++){
    const m=new THREE.Matrix4();o.getMatrixAt(f*4+p,m);
    assert.ok(new THREE.Vector3().applyMatrix4(m).distanceTo(center)<2e-6,'all four lobes have the same flower centre');
    normals.push(new THREE.Vector3(0,0,1).transformDirection(m));rays.push(new THREE.Vector3(0,1,0).transformDirection(m));
    assert.ok(new THREE.Vector3().applyMatrix4(m).applyMatrix4(o.matrixWorld).distanceTo(tip.clone().applyMatrix4(stalks.matrixWorld))<2e-6);
   }
   assert.ok(normals.every(n=>n.dot(normals[0])>.99999));assert.ok(Math.abs(rays[0].dot(rays[1]))<.00001);assert.ok(rays[0].dot(rays[2])<-.99999);count++;
  }
 });
 assert.ok(count>0);model.dispose();
});

test('osmanthus dispose releases shared geometries, materials and instance resources exactly once',()=>{
 for(const age of [0,.04,.2,1,18]){
  const model=buildPlant('osmanthus',{...defaults,age,day:280}),geometries=new Set(),materials=new Set(),instances=new Set();
  model.group.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}if(o.isInstancedMesh)instances.add(o);});
  let g=0,m=0,i=0;for(const x of geometries)x.addEventListener('dispose',()=>g++);for(const x of materials)x.addEventListener('dispose',()=>m++);for(const x of instances)x.addEventListener('dispose',()=>i++);
  model.dispose();model.dispose();assert.equal(g,geometries.size);assert.equal(m,materials.size);assert.equal(i,instances.size);assert.equal(model.group.children.length,0);
 }
});
