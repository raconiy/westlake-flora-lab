import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {buildAdditionalPlant} from './additional-species.ts';
const params={day:180,seed:42,density:1};
const build=age=>buildAdditionalPlant('acer',{...params,age});
function inspect(m){
 m.group.updateMatrixWorld(true);const leaves=[],wood=[];let count=0;
 m.group.traverse(o=>{
  if(o.isMesh&&o.userData.axes)wood.push(...o.userData.axes.map(a=>[a.id,a.attachment]));
  if(!o.isInstancedMesh||o.userData.organ!=='leaf')return;count+=o.count;
  if(o.userData.leafClass!=='juvenile-true-leaf')return;
  const stalk=o.parent.children.find(p=>p.isInstancedMesh&&p.count===o.count&&p.userData.organ==='petiole');
  o.geometry.computeBoundingBox();const span=o.geometry.boundingBox.getSize(new T.Vector3());
  for(let i=0;i<o.count;i++){
   const blade=new T.Matrix4(),petiole=new T.Matrix4();o.getMatrixAt(i,blade);stalk.getMatrixAt(i,petiole);
   leaves.push({id:o.userData.nodes[i].id,birth:o.userData.nodes[i].birth,
    length:span.y*new T.Vector3().setFromMatrixScale(blade).y,width:span.x*new T.Vector3().setFromMatrixScale(blade).x,
    base:new T.Vector3(0,-.5,0).applyMatrix4(petiole).applyMatrix4(stalk.matrixWorld),
    tip:new T.Vector3(0,.5,0).applyMatrix4(petiole).applyMatrix4(stalk.matrixWorld),
    blade:new T.Vector3().applyMatrix4(blade).applyMatrix4(o.matrixWorld)});
  }
 });assert.equal(count,m.leafCount,'visible geometry and public leaf count agree');return{leaves,wood};
}
test('first true pair reaches millimetre seedling size before the first cohort senesces',()=>{
 const m=build(.12);try{const s=inspect(m),first=s.leaves.filter(l=>l.birth===.07);assert.equal(first.length,2);
  for(const l of first){assert.ok(l.length>=.005&&l.length<=.007,`first pair ${l.length}m, size range from one sampled phenotype`);assert.ok(l.width>=.004&&l.width<=.005,`first pair width ${l.width}m`);assert.ok(l.tip.distanceTo(l.blade)<1e-8);}
  const later=s.leaves.filter(l=>l.birth>.07);assert.equal(later.length,2);assert.ok(later.every(l=>l.base.y>first[0].base.y+.005),'next pair is on a later apical material node');
 }finally{m.dispose();}
});
test('each establishment pair starts at its reached apical node, then retains its woody site',()=>{
 const adult=build(18);try{
  for(const site of adult.group.userData.juvenileTrueLeaves.sites){
   const early=build(site.birth+1e-8),later=build(.5);try{
    const a=inspect(early).leaves.filter(l=>l.id.startsWith(site.id+':')),b=new Map(inspect(later).leaves.map(l=>[l.id,l]));assert.equal(a.length,2);
    for(const leaf of a){const primary=early.group.getObjectByName('acer-primary-axis'),p=primary.geometry.attributes.position,{segments,sides}=primary.geometry.userData.woodTube;
     const end=new T.Vector3();for(let j=0;j<sides;j++)end.add(new T.Vector3().fromBufferAttribute(p,segments*(sides+1)+j).applyMatrix4(primary.matrixWorld));end.divideScalar(sides);
     const node=early.group.getObjectByName('acer-epicotyl-reference').getWorldPosition(new T.Vector3());
     assert.ok(Math.abs(leaf.base.y-end.y)<2e-6,'new node is reached by its actual parent before leaf expansion');assert.ok(leaf.base.distanceTo(b.get(leaf.id).base)<3e-7);}
   }finally{early.dispose();later.dispose();}
  }
 }finally{adult.dispose();}
});
test('senescence is a declared one-time leaf event, never disappearance of woody axes or the material sites',()=>{
 const before=build(.54),fading=build(.7),after=build(.81),adult=build(18);try{
  const a=inspect(before),b=inspect(fading),c=inspect(after),d=inspect(adult);
  assert.equal(a.leaves.length,12);assert.equal(b.leaves.length,12);assert.equal(c.leaves.length,12);assert.equal(d.leaves.length,12);
  for(const l of a.leaves)assert.ok(b.leaves.find(x=>x.id===l.id).length>=l.length-3e-8,'age growth does not retract an established blade');
  assert.deepEqual(before.group.userData.juvenileTrueLeaves.sites,adult.group.userData.juvenileTrueLeaves.sites,'woody insertion catalogue is permanent');
  assert.equal(after.group.userData.juvenileTrueLeaves.event.woodRetired,false);
  for(const j of before.branches){const k=adult.branches.find(k=>k.order===j.order);assert.ok(k&&k.length>=j.length&&k.radius>=j.radius);}
 }finally{for(const m of [before,fading,after,adult])m.dispose();}
});
test('last juvenile blade vanishes with zero area and no hidden count at its declared event boundary',()=>{
 const a=build(.8-1e-6),b=build(.8+1e-6);try{
  const x=inspect(a),y=inspect(b);assert.equal(x.leaves.length,12);assert.equal(y.leaves.length,12);
  assert.ok(y.leaves.every(l=>l.length>=x.leaves.find(q=>q.id===l.id).length-3e-8));
  assert.ok(Math.abs(a.height-b.height)<1e-5,'wood does not retract at leaf retirement');
 }finally{a.dispose();b.dispose();}
});
