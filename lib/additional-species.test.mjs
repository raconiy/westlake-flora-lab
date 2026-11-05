import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdditionalPlant } from './additional-species.ts';
const base={age:18,day:180,seed:42,density:1};
const bones=m=>m.branches.map(b=>[b.length,b.radius,...b.pivot.position.toArray(),...b.rest.toArray()]);
test('camphor stays evergreen while maple loses leaves without losing woody architecture',()=>{
 const summer=buildAdditionalPlant('acer',base),winter=buildAdditionalPlant('acer',{...base,day:20});
 assert.ok(summer.leafCount>1000);assert.equal(winter.leafCount,0);assert.deepEqual(bones(summer),bones(winter));summer.dispose();winter.dispose();
 const c=buildAdditionalPlant('camphor',base),cw=buildAdditionalPlant('camphor',{...base,day:20});assert.ok(cw.leafCount>1000);assert.equal(c.leafCount,cw.leafCount);c.dispose();cw.dispose();
});
test('maple changes from summer green to autumn warm colour rather than fixed red',()=>{
 const green=buildAdditionalPlant('acer',base),red=buildAdditionalPlant('acer',{...base,day:306});
 const colors=m=>{let result; m.group.traverse(o=>{if(!result&&o.isInstancedMesh&&o.userData.connectedBy==='petiole')result=Array.from(o.instanceColor.array.slice(0,3));});return result};
 const g=colors(green),r=colors(red);assert.ok(g[1]>g[0]);assert.ok(r[0]>r[1]);green.dispose();red.dispose();
});
test('new species have distinct organ dimensions and leaf arrangements',()=>{
 for(const species of ['camphor','acer','ophiopogon']){
  const p=buildAdditionalPlant(species,base);assert.ok(p.height>0);assert.ok(p.leafCount>0);let blade;
  p.group.traverse(o=>{if(!blade&&o.userData.organ==='leaf'&&(o.userData.connectedBy==='petiole'||species==='ophiopogon'))blade=o});assert.ok(blade);
  if(species==='ophiopogon')assert.deepEqual(blade.userData.bladeWidthMetres,[.002,.004]);
  else {assert.equal(blade.userData.arrangement,species==='camphor'?'alternate':'opposite');blade.geometry.computeBoundingBox();const box=blade.geometry.boundingBox,width=box.max.x-box.min.x;assert.ok(species==='camphor'?width<.055:width>.065)}
  p.dispose();assert.equal(p.group.children.length,0);
 }
});
test('grass retains evergreen foliage and has small tagged summer flowers',()=>{
 const summer=buildAdditionalPlant('ophiopogon',{...base,day:200}),winter=buildAdditionalPlant('ophiopogon',{...base,day:15});let sf=0,wf=0;
 summer.group.traverse(o=>{if(o.isMesh&&o.userData.organ==='flower')sf++});winter.group.traverse(o=>{if(o.isMesh&&o.userData.organ==='flower')wf++});assert.ok(sf>0);assert.equal(wf,0);assert.equal(summer.leafCount,winter.leafCount);assert.ok(summer.height<.5);summer.dispose();winter.dispose();
});
test('all additions support reproducible seed and bounded wind/gravity, with load reset',()=>{
 for(const species of ['camphor','acer','ophiopogon']){
  const a=buildAdditionalPlant(species,base),b=buildAdditionalPlant(species,base);assert.deepEqual(bones(a),bones(b));a.update(2,8,9.81,1);assert.ok(a.branches.some(j=>j.pivot.quaternion.angleTo(j.rest)>.00001));for(const j of a.branches)assert.ok(j.pivot.quaternion.toArray().every(Number.isFinite));a.update(3,0,0,1);for(const j of a.branches)assert.ok(j.pivot.quaternion.angleTo(j.rest)<.00001);a.dispose();b.dispose();
 }
});

// Geometry assertions use metres and actual transforms rather than descriptive tags.
import * as THREE from 'three';
const triangles=m=>{let area=0;m.group.updateMatrixWorld(true);m.group.traverse(o=>{
 if(!o.isMesh)return;const g=o.geometry,p=g.attributes.position,ix=g.index;
 const add=matrix=>{for(let i=0;i<(ix?ix.count:p.count);i+=3){const v=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(matrix));area+=v[1].sub(v[0]).cross(v[2].sub(v[0])).length()/2;}};
 if(o.isInstancedMesh){const matrix=new THREE.Matrix4();for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);add(new THREE.Matrix4().multiplyMatrices(o.matrixWorld,matrix));}}else add(o.matrixWorld);
 });return area;};
test('all additions begin with no crown and form first leaves before a branched canopy',()=>{
 for(const s of ['camphor','acer','ophiopogon']){
  const zero=buildAdditionalPlant(s,{...base,age:0}),early=buildAdditionalPlant(s,{...base,age:.1}),young=buildAdditionalPlant(s,{...base,age:.5});
  assert.equal(zero.leafCount,0);assert.equal(zero.height,0);assert.equal(zero.branches.length,0);
  assert.ok(early.leafCount>0&&early.leafCount<10);assert.ok(young.leafCount>early.leafCount);
  if(s!=='ophiopogon')assert.equal(young.branches.filter(b=>b.order>0).length,0);
  else young.group.traverse(o=>{assert.ok(!o.userData.woody);});
  for(const m of [zero,early,young])m.dispose();
 }
});
test('organ surface and height are continuous across early cohort births and age 0.5 / 1 / 2',()=>{
 for(const s of ['camphor','acer','ophiopogon'])for(const age of [.025,.07,.5,.6,1,1.03,1.1,1.2,2]){
  const a=buildAdditionalPlant(s,{...base,age:age-1e-6}),b=buildAdditionalPlant(s,{...base,age:age+1e-6});
  assert.ok(Math.abs(a.height-b.height)<.00001,`${s} height at ${age}`);
  assert.ok(Math.abs(triangles(a)-triangles(b))<.00002,`${s} surface at ${age}`);
  for(const m of [a,b])m.dispose();
 }
});
test('actual mature blades and petioles stay in centimetre / millimetre ranges; maple nodes are opposite',()=>{
 for(const s of ['camphor','acer']){
  const m=buildAdditionalPlant(s,base);let checked=0;
  m.group.traverse(o=>{if(!o.isInstancedMesh||o.userData.organ!=='leaf')return;o.geometry.computeBoundingBox();
   const box=o.geometry.boundingBox,sz=box.getSize(new THREE.Vector3()),matrix=new THREE.Matrix4(),scale=new THREE.Vector3();
   for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);scale.setFromMatrixScale(matrix);const length=sz.y*scale.y,width=sz.x*scale.x;
    const birth=o.userData.nodes[i].birth,mature=base.age-birth>=.38;
    assert.ok(length>0&&length<=(s==='camphor'?.12:.06),`${s} length ${length}`);
    assert.ok(width>0&&width<=(s==='camphor'?.055:.08),`${s} width ${width}`);
    if(mature){assert.ok(length>=(s==='camphor'?.06:.03),`${s} mature length ${length}`);assert.ok(width>=(s==='camphor'?.025:.04),`${s} mature width ${width}`);checked++;}
   }
   if(s==='acer'){
    const petioles=o.parent.children.find(x=>x.isInstancedMesh&&x.userData.organ==='petiole');
    for(let i=0;i<petioles.count;i+=2){const a=new THREE.Matrix4(),b=new THREE.Matrix4(),pa=new THREE.Vector3(),pb=new THREE.Vector3(),qa=new THREE.Quaternion(),qb=new THREE.Quaternion(),sa=new THREE.Vector3(),sb=new THREE.Vector3();petioles.getMatrixAt(i,a);petioles.getMatrixAt(i+1,b);a.decompose(pa,qa,sa);b.decompose(pb,qb,sb);
     const da=new THREE.Vector3(0,1,0).applyQuaternion(qa),db=new THREE.Vector3(0,1,0).applyQuaternion(qb);
     assert.ok(pa.addScaledVector(da,-sa.y/2).distanceTo(pb.addScaledVector(db,-sb.y/2))<1e-6,'paired petioles share one node');
    }
   }
  });assert.ok(checked>1000);m.dispose();
 }
 const grass=buildAdditionalPlant('ophiopogon',{...base,age:8});grass.group.traverse(o=>{if(!o.isMesh||o.userData.organ!=='leaf')return;const p=o.geometry.attributes.position;
  // merge() expands each indexed ribbon to 18 segments × 12 triangle vertices.
  for(let i=0;i<p.count;i+=216){const a=new THREE.Vector3().fromBufferAttribute(p,i+108),b=new THREE.Vector3().fromBufferAttribute(p,i+116);assert.ok(a.distanceTo(b)>=.0019&&a.distanceTo(b)<=.0041,'2–4 mm ribbon width');
   let length=0,previous=new THREE.Vector3().fromBufferAttribute(p,i+2);for(let j=1;j<18;j++){const next=new THREE.Vector3().fromBufferAttribute(p,i+j*12+2);length+=previous.distanceTo(next);previous=next;}length+=previous.distanceTo(new THREE.Vector3().fromBufferAttribute(p,i+215));assert.ok(length>=.1&&length<=.5,'10–50 cm curved leaf length');
  }
 });grass.dispose();
});
