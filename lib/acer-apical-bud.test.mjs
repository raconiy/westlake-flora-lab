import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildAdditionalPlant} from './additional-species.ts';
import {createBeamDynamics} from './beam-dynamics.ts';
import {woodSections,sectionVolume} from './wood-loads.ts';
import {geometryHeight} from './geometry-height.ts';
const base={day:180,seed:42,density:1},point=(p,i)=>new THREE.Vector3().fromBufferAttribute(p,i);
function terminal(model){
 const wood=model.group.getObjectByName('acer-primary-axis'),bud=model.group.getObjectByName('acer-apical-bud'),
  {segments,sides}=wood.geometry.userData.woodTube,p=wood.geometry.attributes.position,
  rim=Array.from({length:sides},(_,j)=>point(p,segments*(sides+1)+j)),
  centre=rim.reduce((sum,v)=>sum.add(v),new THREE.Vector3()).divideScalar(sides),radial=rim.map(v=>v.clone().sub(centre)),normal=new THREE.Vector3();
 for(let j=0;j<sides;j++)normal.add(radial[j].clone().cross(radial[(j+1)%sides]));
 return {wood,bud,rim,centre,normal:normal.normalize()};
}

test('terminal bud seals every actual Float32 tip corner under hook, continuing extension and wind',()=>{
 // Bounded organ cases, not a Cartesian sweep. Day 15 does not invent a
 // dormancy state or retire the active leader's physical closure.
 for(const [age,seed,day] of [[.0250001,42,180],[.04,42,180],[.055,73,180],[.12,42,180],[.2,42,180],[.200001,73,180],[.5,42,15],[1,73,180],[18,42,180],[80,73,15]]){
  const model=buildAdditionalPlant('acer',{...base,age,seed,day}),d=createBeamDynamics(model);
  try{
   const {wood,bud,rim,centre,normal}=terminal(model);assert.ok(bud);assert.equal(bud.parent,wood.parent);
   const p=bud.geometry.attributes.position,ix=bud.geometry.index,sides=rim.length;
   assert.equal(p.count,188);assert.ok(p.count<=221);assert.equal(woodSections(bud.geometry).length,0);
   assert.equal(bud.userData.organ,'bud');assert.match(bud.userData.mechanics,/mass, drag and physiology unresolved/);
   assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(model.group.getObjectByName('acer-epicotyl-reference').quaternion).dot(normal)>.99,'bud follows transported local epicotyl tangent');
   if(age===.04)assert.ok(normal.y<0,'hooked terminal bud points down with actual leader');
   for(const load of [[0,0],[12,19.62],[0,0]]){
    for(let i=0;i<=24;i++)d.update(i/60,...load,.2);
    model.group.updateMatrixWorld(true);
    for(let j=0;j<sides;j++)assert.ok(point(p,j).applyMatrix4(bud.matrixWorld).distanceTo(rim[j].clone().applyMatrix4(wood.matrixWorld))<3e-8,'actual bud boundary welds the full rim in world space');
    const tip=point(p,p.count-2).applyMatrix4(bud.matrixWorld),origin=centre.clone().applyMatrix4(wood.matrixWorld),direction=normal.clone().transformDirection(wood.matrixWorld);
    assert.ok(tip.clone().sub(origin).dot(direction)>0,'real bud tip lies beyond wood tip');
    assert.ok(tip.clone().sub(origin).cross(direction).length()<3e-8,'real bud tip extends along local tangent');
    const box=new THREE.Box3().setFromObject(bud);assert.ok([...box.min.toArray(),...box.max.toArray()].every(Number.isFinite));
    assert.ok(box.getSize(new THREE.Vector3()).length()<.008,'bud remains a small terminal organ');
   }
   // Closed two-manifold, including a real basal disk and distal closure.
   const edges=new Map();let volume=0;
   for(let i=0;i<ix.count;i+=3){
    const ids=[0,1,2].map(j=>ix.getX(i+j)),[a,b,c]=ids.map(j=>point(p,j));
    assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).length()>0,'no zero-area bud triangles');
    volume+=a.dot(b.clone().cross(c))/6;
    for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');const e=edges.get(key)||{count:0,balance:0};e.count++;e.balance+=a<b?1:-1;edges.set(key,e);}
   }
   for(const e of edges.values()){assert.equal(e.count,2);assert.equal(e.balance,0,'neighbouring bud triangles wind consistently');}
   assert.ok(volume>0,'closed bud winding is outward');
   for(const name of ['position','normal'])assert.ok(Array.from(bud.geometry.attributes[name].array).every(Number.isFinite));
   // No reclassification of the bud into wood or leaf mass to manipulate loads.
   let woodVolume=0;model.group.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&o.userData.organ!=='seed')for(const s of woodSections(o.geometry))woodVolume+=sectionVolume(s);});
   const woodOnly=createBeamDynamics(model,{leafArealMassKgM2:0});try{assert.ok(Math.abs(woodOnly.stats.estimatedMassKg-woodVolume*550)<1e-9);assert.equal(woodOnly.stats.countedLeaves,model.leafCount);}finally{woodOnly.dispose();}
  }finally{d.dispose();model.dispose();}
 }
});

test('meristem scales from zero and transitions continuously without retiring or shortening wood',()=>{
 const zero=buildAdditionalPlant('acer',{...base,age:.025});try{assert.equal(zero.group.getObjectByName('acer-apical-bud'),undefined);}finally{zero.dispose();}
 for(const age of [.025,.04,.12,.2]){
  const a=buildAdditionalPlant('acer',{...base,age:age-1e-7}),b=buildAdditionalPlant('acer',{...base,age:age+1e-7});
  try{
   assert.ok(Math.abs(a.height-b.height)<1e-5);assert.equal(a.height,geometryHeight(a.group));assert.equal(b.height,geometryHeight(b.group));
   if(age===.025){const {bud}=terminal(b),box=new THREE.Box3().setFromObject(bud);assert.ok(box.getSize(new THREE.Vector3()).length()<1e-8,'organ extent tends to zero at birth');continue;}
   const ta=terminal(a),tb=terminal(b);assert.ok(tb.centre.y>=ta.centre.y-1e-7);
   for(let i=0;i<ta.bud.geometry.attributes.position.count;i++)assert.ok(point(ta.bud.geometry.attributes.position,i).add(ta.bud.position).distanceTo(point(tb.bud.geometry.attributes.position,i).add(tb.bud.position))<1e-5);
  }finally{a.dispose();b.dispose();}
 }
});

test('single persistent bud uses the existing vertex budget, stays independent of day/density and disposes all owned resources',()=>{
 for(const age of [.04,.2,.5,18]){
  const model=buildAdditionalPlant('acer',{...base,age}),other=buildAdditionalPlant('acer',{...base,age,day:15,density:2});
  const {bud}=terminal(model),resources=new Map();
  model.group.traverse(o=>{if(!o.isMesh)return;for(const r of [o.geometry,...(Array.isArray(o.material)?o.material:[o.material])])if(!resources.has(r)){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}});
  try{
   assert.deepEqual(Array.from(bud.geometry.attributes.position.array),Array.from(terminal(other).bud.geometry.attributes.position.array));
   let buds=0,draws=0,vertices=0;model.group.traverse(o=>{if(o.isMesh){draws++;vertices+=o.geometry.attributes.position.count;if(o.userData.organ==='bud')buds++;}});
   assert.equal(buds,1);assert.ok(draws<=41);assert.ok(vertices<180000);
   assert.equal(model.group.getObjectByName('acer-primary-axis').geometry.userData.primarySegments.hypocotyl,32);
  }finally{model.dispose();other.dispose();}
  assert.equal(model.group.children.length,0);for(const count of resources.values())assert.equal(count,1,'owned geometry/material disposed exactly once');
 }
});
