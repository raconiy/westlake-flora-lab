import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from'three';import{buildPlant}from'./plant-engine.ts';
test('formed ginkgo scaffold nodes persist in material coordinates and wood never retires by age',()=>{
 let old=new Map(),adult;
 for(const age of [8,18,45,80]){const m=buildPlant('ginkgo',{age,day:180,seed:42,density:1});const now=new Map(m.branches.filter(j=>j.order===1).map(j=>[j.pivot.userData.axisId,{position:j.pivot.position.clone(),length:j.length,radius:j.radius,rotation:j.rest.clone()}]));
 for(const[id,a]of old){const b=now.get(id);assert.ok(b,`${id} remains at ${age}`);assert.ok(a.position.distanceTo(b.position)<1e-8,`${id} node moves`);assert.ok(b.length>=a.length&&b.radius>=a.radius,`${id} wood shrinks`);assert.ok(a.rotation.angleTo(b.rotation)<1e-7,`${id} rest axis rerolls`);}
 const c=m.group.userData.canopyMetrics;if(age===45)adult={...c};if(age===80){assert.ok(c.crownWidthM>=adult.crownWidthM*.98);assert.ok(c.oneSidedLeafAreaM2>=adult.oneSidedLeafAreaM2*.98);assert.ok(m.leafCount<=160000);}
 old=now;m.dispose();}
});
test('late-born spur leaves retain actual petiole bases while the short shoot extends',()=>{
 const inspect=age=>{const model=buildPlant('ginkgo',{age,day:180,seed:42,density:1}),nodes=new Map();model.group.updateMatrixWorld(true);model.group.traverse(o=>{if(!o.isInstancedMesh||!o.userData.nodeIds)return;const stalk=o.parent.children.find(s=>s.isInstancedMesh&&s!==o&&s.userData.organ==='leaf'&&!s.userData.connectedBy);if(!stalk)return;for(let i=0;i<o.count;i++){const id=o.userData.nodeIds[i];if(!id?.startsWith('stem-spur:74:'))continue;const m=new THREE.Matrix4();stalk.getMatrixAt(i,m);nodes.set(id,new THREE.Vector3(0,-.5,0).applyMatrix4(m).applyMatrix4(stalk.matrixWorld));}});model.dispose();return nodes;};
 const young=inspect(45.362),later=inspect(80);assert.ok(young.size>0);for(const[id,point]of young){assert.ok(later.has(id));assert.ok(point.distanceTo(later.get(id))<1e-6,`${id} attachment migrated`);}
});
test('new fine-shoot cohorts never evict old foliation-site identities in summer or partially leafed seasons',()=>{
 for(const day of [90,180,330]){
  let previous=new Set();
  for(const age of [18,30,45,80]){
   const model=buildPlant('ginkgo',{age,day,seed:42,density:1}),now=new Set();
   model.group.traverse(o=>{for(const id of o.userData.nodeIds??[])if(id&&!id.startsWith('stem-'))now.add(id);});
   for(const id of previous)assert.ok(now.has(id),`new cohorts displaced ${id} at age ${age}, day ${day}`);
   assert.ok(model.leafCount<=160000);previous=now;model.dispose();
  }
 }
});
