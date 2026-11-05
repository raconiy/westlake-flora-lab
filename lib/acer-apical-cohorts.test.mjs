import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {acerApicalCohorts,acerApicalCohortPrior as prior} from './acer-apical-cohorts.ts';
import {acerShootHeightAt} from './acer-juvenile-shoot.ts';
import {buildAdditionalPlant} from './additional-species.ts';
import {createBeamDynamics} from './beam-dynamics.ts';
const build=(age,seed=42)=>buildAdditionalPlant('acer',{age,day:180,seed,density:1});
const ulp32=x=>x===0?2**-149:Math.max(2**-149,2**(Math.floor(Math.log2(Math.abs(x)))-23));
// Each decoded petiole endpoint is Float32 translation +/- half its Float32
// y-column. Bound the encoding error from these actual operands, rather than
// choose a fixed tolerance after observing a large-coordinate failure.
function baseEncodingError(matrix){const e=matrix.elements;return Math.hypot(...[0,1,2].map(i=>.5*ulp32(e[12+i])+.25*ulp32(e[4+i])))+1e-14;}
function records(m){m.group.updateMatrixWorld(true);const group=m.group.getObjectByName('leaf-cohort:main-axis');if(!group)return[];
 const b=group.children.find(o=>o.userData.organ==='leaf'),p=group.children.find(o=>o.userData.organ==='petiole');
 b.geometry.computeBoundingBox();const length=b.geometry.boundingBox.max.y-b.geometry.boundingBox.min.y;
 return b.userData.nodes.map((node,i)=>{const bm=new T.Matrix4(),pm=new T.Matrix4();b.getMatrixAt(i,bm);p.getMatrixAt(i,pm);
  return {...node,baseRoundoff:baseEncodingError(pm),base:new T.Vector3(0,-.5,0).applyMatrix4(pm).applyMatrix4(p.matrixWorld),
   end:new T.Vector3(0,.5,0).applyMatrix4(pm).applyMatrix4(p.matrixWorld),blade:new T.Vector3().applyMatrix4(bm).applyMatrix4(b.matrixWorld),
   length:length*new T.Vector3().setFromMatrixScale(bm).y};});}
test('fixed later material nodes are ordered, finite and actually reached before leaf emergence',()=>{
 const catalogue=acerApicalCohorts();assert.equal(catalogue.length,72);let previous=.081;
 for(const s of catalogue){assert.ok(s.heightM>previous);previous=s.heightM;assert.ok(Number.isFinite(s.birth));
  assert.ok(Math.abs(acerShootHeightAt(s.birth)-s.heightM)<2e-14);assert.ok(acerShootHeightAt(s.birth-1e-6)<s.heightM);}
 for(const s of [catalogue[0],catalogue[4],catalogue[15]]){
  const a=build(s.birth-1e-7),b=build(s.birth+1e-7);try{
   const before=records(a),after=records(b).filter(r=>Math.abs(r.birth-s.birth)<1e-12);
   assert.ok(!before.some(r=>r.birth===s.birth));assert.equal(after.length,2);
   for(const r of after){assert.ok(r.length<1e-10);assert.ok(Math.abs(r.base.y-(s.heightM+.018))<1e-7);assert.ok(r.end.distanceTo(r.blade)<1e-8);}
  }finally{a.dispose();b.dispose();}
 }
 assert.equal(prior.calibrated,false);
});
test('formed main-axis leaf sites never slide or disappear as later shoots develop',()=>{
 for(const seed of [42,73]){let previous=new Map(),catalogue;for(const age of [.4,.5,.6,.81,1,3,18,80]){const m=build(age,seed);try{
  if(catalogue)assert.deepEqual(m.group.userData.apicalCohorts.sites,catalogue);catalogue=m.group.userData.apicalCohorts.sites;
  const next=new Map(records(m).map(r=>[r.id,r]));for(const [id,old] of previous){const r=next.get(id);assert.ok(r,`formed material site ${id} retained`);assert.equal(r.birth,old.birth);assert.ok(r.base.distanceTo(old.base)<=r.baseRoundoff+old.baseRoundoff,'recovered endpoint drift is bounded by its actual Float32 operand encoding');}
  previous=next;
 }finally{m.dispose();}}
 assert.equal(previous.size,144,'same bounded 72-pair lifetime catalogue');}
});
test('large-coordinate seed73 node66 expansion respects encoding bounds and rejects a genuine 10um slide',()=>{
 const site=acerApicalCohorts()[66],a=build(site.birth+1e-7,73),b=build(site.birth+prior.expansionYears,73);try{
  const before=records(a).filter(r=>r.birth===site.birth),after=records(b);assert.equal(before.length,2);
  for(const old of before){const r=after.find(r=>r.id===old.id);assert.ok(r);const bound=r.baseRoundoff+old.baseRoundoff;
   assert.ok(bound<1e-6);assert.ok(r.base.distanceTo(old.base)<=bound);
   const moved=r.base.clone().add(new T.Vector3(0,.00001,0));assert.ok(moved.distanceTo(old.base)>bound,'coordinate-derived precision cannot conceal a real insertion shift');}
 }finally{a.dispose();b.dispose();}
});
test('later blade unfolding bridges establishment without enlarging the blade template',()=>{
 // Actual unfolding duration and unaltered mature blade template; numerical
 // shape ratios are not used to certify an unmeasured natural silhouette.
 for(const age of [.4,.5,.6,1]){const m=build(age);try{
  const r=records(m);assert.ok(r.some(r=>r.length>.005),'a real developed later blade replaces the old months-long subpixel cohort');
  assert.ok(r.every(r=>r.length<.08));
  assert.equal(r.length,2*acerApicalCohorts().filter(s=>s.birth<age).length);
 }finally{m.dispose();}}
 const first=acerApicalCohorts()[0],m=build(first.birth+prior.expansionYears);try{assert.ok(records(m).filter(r=>r.birth===first.birth).every(r=>r.length>.03));}finally{m.dispose();}
});
test('actual instance triangle areas and all rendered leaf counts feed unchanged mass ownership',()=>{
 const m=build(.5),d=createBeamDynamics(m);try{
  let area=0,count=0;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),matrix=new T.Matrix4();
  m.group.traverse(o=>{if(!o.isInstancedMesh||o.userData.organ!=='leaf')return;count+=o.count;const p=o.geometry.attributes.position,ix=o.geometry.index;
   for(let j=0;j<o.count;j++){o.getMatrixAt(j,matrix);for(let i=0;i<(ix?ix.count:p.count);i+=3){
    a.fromBufferAttribute(p,ix?ix.getX(i):i).applyMatrix4(matrix);b.fromBufferAttribute(p,ix?ix.getX(i+1):i+1).applyMatrix4(matrix);c.fromBufferAttribute(p,ix?ix.getX(i+2):i+2).applyMatrix4(matrix);
    area+=b.sub(a).cross(c.sub(a)).length()/2;}}
  });
  assert.equal(count,m.leafCount);assert.equal(count,d.stats.countedLeaves);assert.ok(Math.abs(area-d.stats.leafAreaM2)<1e-12);
  let draws=0,vertices=0;m.group.traverse(o=>{if(o.isMesh){draws++;vertices+=o.geometry.attributes.position.count;}});assert.ok(draws<=41);assert.ok(vertices<180000);
 }finally{d.dispose();m.dispose();}
});
