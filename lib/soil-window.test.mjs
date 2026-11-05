import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRhizosphere} from './rhizosphere.ts';
const p={age:2,seed:42,density:1,moisture:.62,compaction:.25,soilDepth:2.5,cutaway:true};
test('herb soil windows contain all drawn roots while preserving the separately available soil depth',()=>{
 for(const species of ['iris','oxalis','ophiopogon']){
  const model=buildRhizosphere(species,p);try{
   assert.equal(model.group.userData.availableSoilDepth,2.5);assert.ok(model.profileDepth<.6);assert.ok(model.profileDepth>model.rootDepth);
   const rootBox=new THREE.Box3(),soilBox=new THREE.Box3();
   model.group.updateMatrixWorld(true);model.group.traverse(o=>{if(o.isMesh){const b=new THREE.Box3().setFromObject(o);if(o.userData.organ==='soil')soilBox.union(b);else rootBox.union(b);}});
   assert.ok(soilBox.min.y<=rootBox.min.y);assert.ok(Math.abs(soilBox.min.y+model.profileDepth+.003)<1e-6);
   // A visual window must not substitute its depth into water-availability SI inputs.
   const expected=Math.max(0,Math.min(1,(p.moisture-.08)/.58))*(1-.62*p.compaction);
   assert.ok(Math.abs(model.availableWater-expected)<1e-12);
  }finally{model.dispose();}
 }
});
test('woody profiles keep their available depth; shallow herb windows never overrun it',()=>{
 for(const species of ['ginkgo','osmanthus','iris','oxalis','ophiopogon'])for(const soilDepth of [.05,.2]){
  const m=buildRhizosphere(species,{...p,soilDepth});try{assert.ok(m.profileDepth<=soilDepth);if(['ginkgo','osmanthus'].includes(species))assert.equal(m.profileDepth,soilDepth);}finally{m.dispose();}
 }
});
