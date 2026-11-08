import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from'three';import{buildPlant}from'./plant-engine.ts';
test('formed ginkgo scaffold nodes persist in material coordinates and wood never retires by age',()=>{
 let old=new Map(),adult;
 for(const age of [8,18,45,80,120,200]){const m=buildPlant('ginkgo',{age,day:180,seed:42,density:1});const now=new Map(m.branches.filter(j=>j.order===1).map(j=>[j.pivot.userData.axisId,{position:j.pivot.position.clone(),length:j.length,radius:j.radius,rotation:j.rest.clone()}]));
 for(const[id,a]of old){const b=now.get(id);assert.ok(b,`${id} remains at ${age}`);assert.ok(a.position.distanceTo(b.position)<1e-8,`${id} node moves`);assert.ok(b.length>=a.length&&b.radius>=a.radius,`${id} wood shrinks`);assert.ok(a.rotation.angleTo(b.rotation)<1e-7,`${id} rest axis rerolls`);}
 const c=m.group.userData.canopyMetrics;if(age===45)adult={...c};if(age===80){assert.ok(c.crownWidthM>=adult.crownWidthM*.98);assert.ok(c.oneSidedLeafAreaM2>=adult.oneSidedLeafAreaM2*.98);assert.ok(m.leafCount<=160000);}
 old=now;m.dispose();}
});
test('mature ginkgo trunk has no residual primary-stem leaf rings',()=>{
 const countStemLeaves=age=>{const model=buildPlant('ginkgo',{age,day:180,seed:42,density:1});let count=0;model.group.traverse(o=>{for(const id of o.userData.nodeIds??[])if(id?.startsWith('stem-'))count++;});const state=model.group.userData.stemLeafPhenology;model.dispose();return {count,state};};
 const juvenile=countStemLeaves(1), mature=countStemLeaves(18);
 assert.ok(juvenile.count>0);
 assert.equal(mature.count,0);
 assert.equal(mature.state.state,'mature_stem_leaf_scar_only');
});
test('new fine-shoot cohorts never evict old foliation-site identities in summer or partially leafed seasons',()=>{
 for(const day of [90,180,330]){
  let previous=new Set();
  for(const age of [18,30,45,80,120,200]){
   const model=buildPlant('ginkgo',{age,day,seed:42,density:1}),now=new Set();
   model.group.traverse(o=>{for(const id of o.userData.nodeIds??[])if(id&&!id.startsWith('stem-'))now.add(id);});
   for(const id of previous)assert.ok(now.has(id),`new cohorts displaced ${id} at age ${age}, day ${day}`);
   assert.ok(model.leafCount<=160000);previous=now;model.dispose();
  }
 }
});

test('every renewed non-stem leaf site keeps its actual petiole base as new cohorts grow', () => {
 let previous = new Map();
 for (const age of [18,30,45,80,120,200]) {
  const model = buildPlant('ginkgo', {age,day:180,seed:42,density:1});
  const now = new Map(), matrix = new THREE.Matrix4();
  model.group.updateMatrixWorld(true);
  try {
   model.group.traverse(o => {
    if (!o.isInstancedMesh || !o.userData.nodeIds) return;
    const stalk = o.parent.children.find(s => s.isInstancedMesh && s.userData.organ === 'leaf' && !s.userData.connectedBy);
    assert.ok(stalk);
    for (let i = 0; i < o.count; i++) {
     const id = o.userData.nodeIds[i];
     if (id.startsWith('stem-')) continue; // explicitly modelled main-stem renewal
     assert.ok(!now.has(id), `duplicate site ${id}`);
     stalk.getMatrixAt(i, matrix);
     now.set(id, new THREE.Vector3(0,-.5,0).applyMatrix4(matrix).applyMatrix4(stalk.matrixWorld));
    }
   });
   for (const [id, point] of previous) {
    assert.ok(now.has(id), `${id} disappeared at ${age}`);
    assert.ok(point.distanceTo(now.get(id)) < 3e-6, `${id} material attachment migrated at ${age}`);
   }
   previous = now;
  } finally { model.dispose(); }
 }
});

test('sampled renewed petiole bases remain supported by actual woody tube sections', async () => {
 const {woodSections} = await import('./wood-loads.ts');
 const matrix = new THREE.Matrix4(), base = new THREE.Vector3(), nearest = new THREE.Vector3();
 for (const age of [18,45,80,200]) {
  const model = buildPlant('ginkgo', {age,day:180,seed:42,density:1});
  let checked = 0;
  try {
   model.group.traverse(o => {
    if (!o.isInstancedMesh || !o.userData.nodeIds) return;
    const stalk = o.parent.children.find(s => s.isInstancedMesh && s.userData.organ === 'leaf' && !s.userData.connectedBy);
    const sections = o.parent.children.filter(s => s.isMesh && !s.isInstancedMesh)
     .flatMap(s => woodSections(s.geometry).map(section => ({
      a: new THREE.Vector3().fromArray(section.a).applyMatrix4(s.matrix),
      b: new THREE.Vector3().fromArray(section.b).applyMatrix4(s.matrix),
      radius: Math.sqrt(Math.max(section.areaA,section.areaB)/Math.PI)
     })));
    for (let i = 0; i < o.count; i += Math.max(1,Math.floor(o.count/12))) {
     const id = o.userData.nodeIds[i];
     if (id.startsWith('stem-')) continue;
     stalk.getMatrixAt(i,matrix);base.set(0,-.5,0).applyMatrix4(matrix);
     let supported = false;
     for (const section of sections) {
      new THREE.Line3(section.a,section.b).closestPointToPoint(base,true,nearest);
      // Polygon-ring centres and a three-segment curved spur approximate its
      // centreline. This 1 mm tolerance is smaller than a mature spur diameter.
      if (nearest.distanceTo(base) <= section.radius+.001) { supported=true;break; }
     }
     assert.ok(supported, `petiole base has no wood at ${age}: ${id}`);checked++;
    }
   });
   assert.ok(checked>20);
  } finally { model.dispose(); }
 }
});
