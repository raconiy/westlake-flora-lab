import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
const params={day:180,seed:42,density:1};
const build=age=>buildPlant('ginkgo',{...params,age});

test('ginkgo age sweep keeps a foliated leader and finite, bounded crowns from germination to adulthood',()=>{
 let previousHeight=0;
 for(const age of [0,.02,.08,.2,.5,1,2,3,5,10,20,45]) {
  const model=build(age),m=model.group.userData.canopyMetrics;
  assert.ok(Number.isFinite(model.height)&&model.height>=previousHeight,`height at ${age}`);
  assert.ok(model.height<=m.leaderHeightM*1.12+.04,`no runaway upper branch at ${age}`);
  if(age>=.2) {
   assert.ok(model.leafCount>0);
   assert.ok(m.crownTopM>=m.leaderHeightM*.78,`no bare leader above a low leaf tuft at ${age}`);
   assert.ok(m.crownTopM<=model.height+.01&&m.crownBaseM>=-.001);
   assert.ok(m.crownTopM>m.crownBaseM);
  }
  const nodes=model.branches.filter(b=>b.order===1);
  for(let i=0;i<nodes.length;i++) {
   const n=nodes[i].pivot.userData.node;
   assert.ok(n.birth<age&&n.attachT>0&&n.attachT<=1);
   if(i)assert.ok(n.birth>nodes[i-1].pivot.userData.node.birth&&n.attachment[1]>nodes[i-1].pivot.userData.node.attachment[1],'nodes form upwards in birth order');
   assert.ok(nodes[i].radius<model.branches[0].radius,'lateral axes taper from leader');
  }
  if(age===45) {
   assert.ok(m.crownWidthM>m.leaderHeightM*.60&&m.crownWidthM<m.leaderHeightM*1.25,'broad adult crown');
   assert.ok(m.crownBaseM>m.leaderHeightM*.12&&m.crownBaseM<m.leaderHeightM*.45,'adult live-crown base');
  }
  previousHeight=model.height;model.dispose();
 }
});

test('ginkgo dimensions remain continuous across the old 2.5-year cutoff and shoot birth boundaries',()=>{
 for(const age of [.075,.12,.16,.85,1,1.7,2.5,3,5,10,20]) {
  const a=build(age-1e-5),b=build(age+1e-5);
  const ba=new THREE.Box3().setFromObject(a.group),bb=new THREE.Box3().setFromObject(b.group);
  assert.ok(ba.min.distanceTo(bb.min)<.003&&ba.max.distanceTo(bb.max)<.003,`bounds at ${age}`);
  const old=new Map(a.branches.map(j=>[j.phase,j]));
  for(const j of b.branches)if(old.has(j.phase)) {
   const p=old.get(j.phase);assert.ok(Math.abs(p.length-j.length)<.0002&&Math.abs(p.radius-j.radius)<.00001);
   assert.ok(p.pivot.position.distanceTo(j.pivot.position)<.0002);
  }
  a.dispose();b.dispose();
 }
});

test('ginkgo petiole tips meet centimeter-scale blades under wind and gravity',()=>{
 for(const age of [.5,3,20]) {
  const model=build(age);model.update(2,8,9.81,1);model.group.updateMatrixWorld(true);
  let checked=0;
  model.group.traverse(o=>{
   if(!o.isInstancedMesh||o.userData.connectedBy!=='petiole')return;
   const stalk=o.parent.children.find(s=>s.isInstancedMesh&&s.userData.organ==='leaf'&&!s.userData.connectedBy);
   assert.ok(stalk);assert.equal(stalk.count,o.count);
   const lm=new THREE.Matrix4(),pm=new THREE.Matrix4();
   for(let i=0;i<o.count;i+=Math.max(1,Math.floor(o.count/12))) {
    o.getMatrixAt(i,lm);stalk.getMatrixAt(i,pm);
    const tip=new THREE.Vector3(0,.5,0).applyMatrix4(pm).applyMatrix4(stalk.matrixWorld);
    const base=new THREE.Vector3().applyMatrix4(lm).applyMatrix4(o.matrixWorld);
    assert.ok(tip.distanceTo(base)<2e-6,'wind joint preserves petiole/blade attachment');
    const scale=new THREE.Vector3().setFromMatrixScale(lm);
    assert.ok(scale.x<=1.05&&scale.y<=1.05,'no oversized leaf workaround');checked++;
   }
  });
  assert.ok(checked>0);model.dispose();
 }
});
