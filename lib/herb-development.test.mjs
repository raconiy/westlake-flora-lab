import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';

const defaults = { age: 2, day: 120, seed: 42, density: 1 };
const build = (species, params = {}) => buildPlant(species, { ...defaults, ...params });
const objects = (m, predicate) => { const list = []; m.group.traverse(o => { if (predicate(o)) list.push(o); }); return list; };
const role = (m, name) => objects(m, o => o.userData.role === name);
const bounds = m => { m.group.updateMatrixWorld(true); return new THREE.Box3().setFromObject(m.group); };
function area(model, organ) {
  let sum = 0; model.group.updateMatrixWorld(true);
  for (const mesh of objects(model, o => o.isMesh && (!organ || o.userData.organ === organ))) {
    const p = mesh.geometry.attributes.position, ix = mesh.geometry.index;
    for (let i = 0; i < (ix ? ix.count : p.count); i += 3) {
      const [a,b,c] = [0,1,2].map(j => new THREE.Vector3().fromBufferAttribute(p, ix ? ix.getX(i+j) : i+j).applyMatrix4(mesh.matrixWorld));
      sum += b.sub(a).cross(c.sub(a)).length() / 2;
    }
  }
  return sum;
}
const endpoint = (mesh, y) => new THREE.Vector3(0,y,0).applyMatrix4(mesh.matrixWorld);
const position = object => object.getWorldPosition(new THREE.Vector3());

test('herbs start as explicitly named vegetative propagules, with no adult leaves or flowers', () => {
  for (const species of ['iris','oxalis']) {
    const zero = build(species,{age:0});
    assert.equal(zero.leafCount,0); assert.equal(area(zero,'leaf'),0); assert.equal(area(zero,'flower'),0);
    assert.ok(bounds(zero).max.y < .007, 'actual starting shoot stays millimetre scale');
    assert.match(zero.stageLabel,/繁殖体/);
    const meta = zero.group.userData.development;
    assert.equal(meta.seedGerminationModeled,false); assert.match(meta.ageClock,/vegetative/);
    assert.equal(meta.flowering.firstFloweringAge,null); assert.equal(meta.calibration,'uncalibrated-engineering-prior');
    assert.ok(meta.source.startsWith('https://plants.ces.ncsu.edu/plants/'));
    assert.equal(role(zero, species==='iris'?'rhizome-propagule':'stolon-propagule').length,1);
    zero.dispose();
  }
});

test('first leaves precede new fans or rooted runner nodes and reproductive display', () => {
  for (const species of ['iris','oxalis']) {
    const first=build(species,{age:.06}), next=build(species,{age:species==='iris'?.20:.30}), adult=build(species);
    assert.equal(first.leafCount,1); assert.ok(next.leafCount>first.leafCount); assert.ok(adult.leafCount>next.leafCount);
    assert.equal(area(first,'flower'),0); assert.ok(area(adult,'flower')>0);
    assert.ok(bounds(first).max.y < bounds(adult).max.y);
    if(species==='iris') assert.ok(role(first,'rhizome').every(o=>o.scale.y===0));
    else assert.ok(role(first,'stolon-internode').every(o=>o.scale.y===0));
    [first,next,adult].forEach(m=>m.dispose());
  }
});

test('iris has shallow connected horizontal rhizomes, two basal ranks and metre-scale sword blades', () => {
  const m=build('iris'); bounds(m);
  const rhizomes=role(m,'rhizome');
  for(const rhizome of rhizomes) {
    const a=endpoint(rhizome,-.5), b=endpoint(rhizome,.5);
    assert.ok(Math.abs(a.y+.003)<1e-7 && Math.abs(b.y+.003)<1e-7);
    if(rhizome.userData.growth===0){ assert.ok(a.distanceTo(b)<1e-9); continue; }
    assert.ok(a.distanceTo(b)>1e-6 && a.distanceTo(b)<.08,'formed lateral spacers stay finite centimetre scale');
    const parent=m.group.getObjectByName(`iris-fan-${rhizome.userData.parentNodeId.split(':').at(-1)}`);
    assert.ok(position(parent).distanceTo(a)<1e-7,'rhizome starts at its own established parent fan');
    const fan=m.group.getObjectByName(`iris-fan-${rhizome.userData.cohort}`);
    assert.ok(position(fan).distanceTo(b)<1e-7);
  }
  const blades=role(m,'sword-blade'); assert.equal(blades.length,m.leafCount);
  for(const blade of blades) {
    const size=new THREE.Box3().setFromObject(blade).getSize(new THREE.Vector3());
    const p=blade.geometry.attributes.position;
    assert.ok(size.y>0 && size.y<.43);
    if(blade.userData.expansion===1) assert.ok(size.y>.24);
    assert.ok(blade.position.x*(blade.userData.index%2===0?-1:1)>=0);
    for(let i=0;i<p.count;i++) assert.ok(Math.abs(p.getZ(i))<.001,'ribbed blades stay in a shallow common fan plane');
    assert.ok(Math.max(...Array.from({length:p.count},(_,i)=>p.getZ(i)))>0,'a real cross-section ridge replaces a perfectly flat card');
    const width=Math.max(...Array.from({length:p.count/3},(_,i)=>new THREE.Vector3().fromBufferAttribute(p,i*3).distanceTo(new THREE.Vector3().fromBufferAttribute(p,i*3+2))));
    assert.ok(width>=.018*blade.userData.expansion && width<=.026*blade.userData.expansion);
  }
  m.dispose();
});

test('oxalis runner ends, rooted nodes, petioles and trifoliate leaves remain connected under load', () => {
  const m=build('oxalis'); m.update(3,9,9.81,1); m.group.updateMatrixWorld(true);
  const internodes=role(m,'stolon-internode'); assert.ok(internodes.length>=12);
  for(const stem of internodes) {
    const {runner,node}=stem.userData;
    const tip=m.group.getObjectByName(`oxalis-node-${runner}-${node}`);
    assert.ok(endpoint(stem,-.5).distanceTo(position(stem.parent))<1e-7);
    assert.ok(endpoint(stem,.5).distanceTo(position(tip))<1e-7);
    assert.ok(Math.abs(position(tip).y-.003)<1e-7,'stolon nodes remain at the soil surface');
    const root=tip.children.find(o=>o.userData.role==='adventitious-root'); assert.ok(root);
    assert.ok(endpoint(root,-.5).distanceTo(position(tip))<1e-7);
  }
  for(const petiole of role(m,'petiole')) {
    const leaf=petiole.parent.children.find(o=>o.userData.role==='trifoliate-leaf'); assert.ok(leaf);
    assert.ok(endpoint(petiole,-.5).distanceTo(position(petiole.parent))<1e-7);
    assert.ok(endpoint(petiole,.5).distanceTo(position(leaf))<1e-7);
    const leaflets=[]; leaf.traverse(o=>{if(o.isMesh)leaflets.push(o)}); assert.equal(leaflets.length,3);
    for(const leaflet of leaflets) {
      assert.ok(position(leaflet).distanceTo(position(leaf))<1e-7);
      leaflet.geometry.computeBoundingBox(); const size=leaflet.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(leaflet.scale);
      assert.ok(size.y>.014 && size.y<.025); assert.ok(size.x>.015 && size.x<.03);
      const p=leaflet.geometry.attributes.position;
      const lobe=Math.max(...Array.from({length:p.count},(_,i)=>p.getY(i)));
      assert.ok(lobe>.040,'paired heart lobes extend beyond the central notch at y=.030');
    }
  }
  assert.equal(role(m,'trifoliate-leaf').length,m.leafCount); m.dispose();
});

test('iris flowers separate three hanging falls, three upright standards and three style branches; oxalis has five yellow petals', () => {
  const iris=build('iris'); iris.group.updateMatrixWorld(true);
  for(const flower of role(iris,'iris-flower')) {
    for(const [r,count] of [['drooping-outer-tepal',3],['upright-inner-tepal',3],['style-branch',3]]) {
      const parts=[];flower.traverse(o=>{if(o.userData.role===r)parts.push(o)});assert.equal(parts.length,count);
      for(const part of parts) {
        const p=part.geometry.attributes.position, tip=new THREE.Vector3(); let max=-Infinity;
        for(let i=0;i<p.count;i++)if(p.getY(i)>max){max=p.getY(i);tip.fromBufferAttribute(p,i);}
        tip.applyMatrix4(part.matrixWorld);
        if(r==='drooping-outer-tepal' && flower.scale.x>0)assert.ok(tip.y<position(flower).y-.03*flower.scale.x);
        if(r==='upright-inner-tepal' && flower.scale.x>0)assert.ok(tip.y>position(flower).y+.04*flower.scale.x);
      }
    }
  }
  const ox=build('oxalis');
  for(const flower of role(ox,'oxalis-flower')) {
    const petals=[];flower.traverse(o=>{if(o.isMesh)petals.push(o)});assert.equal(petals.length,5);
    assert.ok(petals.every(p=>p.material.color.getHexString()==='f4ce3d'));
    assert.ok(new THREE.Box3().setFromObject(flower).getSize(new THREE.Vector3()).length()<.025);
  }
  iris.dispose();ox.dispose();
});

test('fixed-seed herb bounds and actual surface are continuous across organ births and former count thresholds', () => {
  for(const species of ['iris','oxalis']) for(const age of [0,.018,.025,.06,.10,.12,.14,.22,.24,.30,.5,.55,.65,.72,1,1.05,1.27,2]) {
    const a=build(species,{age:Math.max(0,age-1e-6)}), b=build(species,{age:age+1e-6});
    const aa=bounds(a),bb=bounds(b);
    assert.ok(aa.min.distanceTo(bb.min)<.00002 && aa.max.distanceTo(bb.max)<.00002,`${species}: bounds at ${age}`);
    assert.ok(Math.abs(area(a)-area(b))<.00002,`${species}: actual surface at ${age}`);
    const old=new Map(a.branches.map(j=>[j.phase,j]));
    for(const j of b.branches){const previous=old.get(j.phase);if(previous)assert.ok(Math.abs(j.length-previous.length)<.00002);else assert.ok(j.length<1e-7);}
    a.dispose();b.dispose();
  }
});

test('herb seed is reproducible and seasonal flowers preserve age-driven skeleton and leaves', () => {
  const signature=m=>{m.group.updateMatrixWorld(true);return objects(m,o=>o.isMesh&&!['leaf','flower'].includes(o.userData.organ)).map(o=>[o.name,...o.matrixWorld.elements,...o.scale.toArray()]);};
  for(const species of ['iris','oxalis']) {
    const a=build(species),same=build(species),other=build(species,{seed:73}),winter=build(species,{day:1});
    assert.deepEqual(signature(a),signature(same));assert.notDeepEqual(signature(a),signature(other));
    assert.deepEqual(signature(a),signature(winter));assert.equal(a.leafCount,winter.leafCount);
    assert.equal(area(winter,'flower'),0);assert.equal(area(a,'leaf'),area(winter,'leaf'));
    assert.deepEqual(a.group.userData.development,winter.group.userData.development);
    for(const m of [a,same,other,winter])m.dispose();
  }
});
