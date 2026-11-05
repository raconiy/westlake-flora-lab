import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRhizosphere} from './rhizosphere.ts';
import {buildPlant} from './plant-engine.ts';
const p={age:18,seed:42,moisture:.55,compaction:.2,soilDepth:1.5,cutaway:true};
const signature=m=>{const result=[];m.group.traverse(o=>{if(o.isMesh&&o.userData.organ==='root')result.push([o.userData.order,o.userData.start,o.userData.end,o.userData.radius]);});return result;};
test('root architectures are deterministic, underground, finite and bounded by the supplied soil profile',()=>{
 for(const s of ['ginkgo','osmanthus','iris','oxalis']) {
  const a=buildRhizosphere(s,p),b=buildRhizosphere(s,p),c=buildRhizosphere(s,{...p,seed:137});
  assert.deepEqual(signature(a),signature(b));assert.notDeepEqual(signature(a),signature(c));
  assert.ok(a.rootTips>20);assert.ok(a.rootLength>0);assert.ok(a.rootDepth<=p.soilDepth&&a.rootDepth>0);
  a.group.traverse(o=>{if(o.isMesh&&o.userData.organ==='root') {const v=o.geometry.attributes.position;for(let i=0;i<v.count;i++){assert.ok(Number.isFinite(v.getX(i)));assert.ok(Number.isFinite(v.getY(i)));assert.ok(Number.isFinite(v.getZ(i)));assert.ok(v.getY(i)<0);assert.ok(v.getY(i)>=-p.soilDepth);}}});
  for(const m of [a,b,c])m.dispose();
 }
});
test('compaction and dry-soil scenarios constrain the declared illustrative root expansion and water availability',()=>{
 const normal=buildRhizosphere('ginkgo',p),hard=buildRhizosphere('ginkgo',{...p,compaction:.95}),dry=buildRhizosphere('ginkgo',{...p,moisture:.05});
 assert.ok(hard.availableWater<normal.availableWater);assert.ok(dry.availableWater<normal.availableWater);
 assert.ok(hard.rootLength<normal.rootLength);assert.ok(dry.rootLength<normal.rootLength);
 assert.ok(dry.waterStress>normal.waterStress);assert.equal(normal.group.userData.calibrated,false);
 for(const m of [normal,hard,dry])m.dispose();
});
test('seed age has no roots; fibrous species and woody species expose distinct structural organs',()=>{
 const seed=buildRhizosphere('ginkgo',{...p,age:0});assert.equal(seed.rootLength,0);assert.equal(seed.rootTips,0);seed.dispose();
 for(const [s,organ] of [['iris','rhizome'],['oxalis','stolon']]) {
  const m=buildRhizosphere(s,p);assert.ok(m.group.children.some(o=>o.userData.organ===organ));m.dispose();
 }
});
test('half-cut soil uses three deterministic strata behind z=0; full soil occupies both halves',()=>{
 for(const cutaway of [true,false]) {
  const m=buildRhizosphere('osmanthus',{...p,cutaway});const soil=m.group.children.filter(o=>o.userData.organ==='soil');assert.equal(soil.length,3);
  for(const layer of soil){const b=new THREE.Box3().setFromObject(layer);assert.ok(b.max.y<=0);if(cutaway)assert.ok(b.min.z>=0);else assert.ok(b.min.z<0);assert.ok(layer.geometry.attributes.color.count>0);}
  m.dispose();assert.equal(m.group.children.length,0);m.dispose();
 }
});
test('shallow soil and invalid numeric inputs remain finite without crossing the profile',()=>{
 for(const s of ['ginkgo','osmanthus','iris','oxalis']) {
  const m=buildRhizosphere(s,{age:.02,seed:NaN,moisture:Infinity,compaction:NaN,soilDepth:.05,cutaway:true});
  assert.ok(Number.isFinite(m.rootLength));assert.ok(m.rootDepth<=.05);assert.ok(m.availableWater>=0&&m.availableWater<=1);assert.ok(m.waterStress>=0&&m.waterStress<=1);m.dispose();
 }
});
test('dispose releases every geometry and material exactly once',()=>{
 const m=buildRhizosphere('iris',p);const geometries=new Set(),materials=new Set();m.group.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);materials.add(o.material);}});
 let g=0,mat=0;for(const x of geometries)x.addEventListener('dispose',()=>g++);for(const x of materials)x.addEventListener('dispose',()=>mat++);
 m.dispose();m.dispose();assert.equal(g,geometries.size);assert.equal(mat,materials.size);
});

test('mature roots cannot pierce an extremely shallow imposed soil boundary',()=>{
 for(const species of ['ginkgo','osmanthus','iris','oxalis']){const m=buildRhizosphere(species,{...p,age:80,soilDepth:.05});m.group.traverse(o=>{if(o.isMesh&&['root','rhizome','stolon'].includes(o.userData.organ)){const v=o.geometry.attributes.position;for(let i=0;i<v.count;i++)assert.ok(v.getY(i)>-.05&&v.getY(i)<0);}});m.dispose();}
});


test('a newly germinating ginkgo has one emerging primary radicle before lateral cohorts',()=>{
 const early=buildRhizosphere('ginkgo',{...p,age:.015});
 const later=buildRhizosphere('ginkgo',{...p,age:.04});
 const branching=buildRhizosphere('ginkgo',{...p,age:.15});
 const axes=m=>m.group.children.filter(o=>o.userData.organ==='root');
 assert.equal(axes(early).length,1);assert.equal(axes(early)[0].userData.order,0);
 assert.equal(axes(later).length,1);assert.ok(later.rootLength>early.rootLength);
 assert.ok(axes(later)[0].userData.start[1]<=-.037,"radicle starts at the buried seed lower pole");assert.ok(axes(later)[0].userData.end[1]<-.037,"radicle is visible outside the coat");
 assert.ok(branching.rootTips>1);assert.ok(branching.rootLength>later.rootLength);
 assert.ok(axes(branching).filter(o=>o.userData.order===1).every(o=>o.userData.start[1]<-.018));
 assert.equal(early.group.userData.metricsMeaning.rootTips,'drawn-root-axis-end-count');
 for(const m of [early,later,branching])m.dispose();
});

test('osmanthus has one emerging radicle, then staged lateral roots rather than seven mature axes',()=>{
 const seed=buildRhizosphere('osmanthus',{...p,age:0});assert.equal(seed.rootTips,0);seed.dispose();
 const early=buildRhizosphere('osmanthus',{...p,age:.015}),later=buildRhizosphere('osmanthus',{...p,age:.04}),seedling=buildRhizosphere('osmanthus',{...p,age:.2}),yearling=buildRhizosphere('osmanthus',{...p,age:1});
 const roots=m=>m.group.children.filter(o=>o.userData.organ==='root');
 assert.equal(roots(early).length,1);assert.equal(roots(later).length,1);assert.equal(roots(early)[0].userData.order,0);
 assert.ok(later.rootLength>early.rootLength);assert.ok(roots(seedling).length>1&&roots(seedling).length<7);
 assert.ok(roots(seedling).filter(o=>o.userData.order===1).every(o=>o.userData.start[1]<-.011),'first laterals originate below the root collar on the radicle');
 assert.equal(roots(yearling).filter(o=>o.userData.order===1&&o.userData.start[1]===yearling.group.userData.lifecycle.collarY).length,1,'only the first collar-root cohort has begun at one year');
 for(const m of [early,later,seedling,yearling])m.dispose();
});

test('osmanthus root cohorts expand continuously through all early onset boundaries',()=>{
 for(const age of [.012,.035,.08,.12,.25,.30,.8,.9,1.1,1.3,1.8,2.4]){
  const a=buildRhizosphere('osmanthus',{...p,age:age-1e-5}),b=buildRhizosphere('osmanthus',{...p,age:age+1e-5});
  assert.ok(Math.abs(b.rootLength-a.rootLength)<.0002,`summed axis length is continuous at ${age}`);
  // Before emergence there is no axis, so depth=0; its first point is at the buried seed pole.
  if(a.rootTips)assert.ok(Math.abs(b.rootDepth-a.rootDepth)<.0001,`depth is continuous at ${age}`);
  else assert.ok(b.rootLength<1e-6,'the first radicle emerges at zero length');
  const primary=m=>m.group.children.find(o=>o.userData.organ==='root'&&o.userData.order===0);
  if(primary(a)&&primary(b)){
   const ap=primary(a).geometry.attributes.position,bp=primary(b).geometry.attributes.position;
   for(let i=0;i<ap.count;i++)assert.ok(new THREE.Vector3().fromBufferAttribute(ap,i).distanceTo(new THREE.Vector3().fromBufferAttribute(bp,i))<.0001);
  }
  a.dispose();b.dispose();
 }
});

test('ginkgo root origin and actual tube vertices do not jump from 0.649 to 0.65 years',()=>{
 for(const [from,to] of [[.649,.65],[.55-1e-5,.55+1e-5],[.65-1e-5,.65+1e-5],[.95-1e-5,.95+1e-5]]){
  const a=buildRhizosphere('ginkgo',{...p,age:from}),b=buildRhizosphere('ginkgo',{...p,age:to});
  const primary=m=>m.group.children.find(o=>o.userData.organ==='root'&&o.userData.order===0),ar=primary(a),br=primary(b);
  assert.ok(Math.abs(ar.userData.start[1]-br.userData.start[1])<.00015,'root origin moves less than 0.15 mm');
  const ap=ar.geometry.attributes.position,bp=br.geometry.attributes.position;
  const tolerance=to-from>.0001?.00025:.00001; // Ordinary growth over .001 years is allowed; the old 5.7 mm jump is not.
  for(let i=0;i<ap.count;i++)assert.ok(new THREE.Vector3().fromBufferAttribute(ap,i).distanceTo(new THREE.Vector3().fromBufferAttribute(bp,i))<tolerance,'tube surface also moves continuously');
  a.dispose();b.dispose();
 }
});


test('osmanthus seed pole and later root collar coincide with the shoot origin throughout development',()=>{
 for(const age of [.04,.10,.2,.55,.649,.65,.8,.9,1,3,18]){
  const root=buildRhizosphere('osmanthus',{...p,age}),shoot=buildPlant('osmanthus',{age,day:180,seed:p.seed,density:1});
  const primary=root.group.children.find(o=>o.userData.organ==='root'&&o.userData.order===0);
  assert.deepEqual(root.group.userData.lifecycle,shoot.group.userData.lifecycle);
  assert.ok(shoot.branches[0].pivot.position.distanceTo(new THREE.Vector3(...primary.userData.start))<1e-8,'actual mesh axes share the same collar, including while the seed coat shrinks');
  root.dispose();shoot.dispose();
 }
});
