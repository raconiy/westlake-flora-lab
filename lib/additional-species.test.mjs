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
