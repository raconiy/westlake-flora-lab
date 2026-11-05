import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPlant} from './plant-engine.ts';
import {herbReproduction, herbReproductionPriors} from './herb-reproduction.ts';

const days = [1,80,100,120,160,200,270,335,365];
const ages = [0,.02,.1,.5,2];
const seeds = [42,73];
const build = (species, day, age=2, seed=42, density=1) => buildPlant(species,{day,age,seed,density});
const collect = (model, predicate) => {
  const objects=[]; model.group.traverse(o=>{if(predicate(o))objects.push(o)}); return objects;
};
const sites = model => collect(model,o=>o.userData.role==='annual-reproductive-axis');
const meshes = model => collect(model,o=>o.isMesh);
const position = o => o.getWorldPosition(new THREE.Vector3());
const close = (a,b,label) => assert.ok(a.distanceTo(b)<5e-8,`${label}: ${a.distanceTo(b)} m`);

// Read actual cylinder ring vertices, not claimed endpoints in userData.
function ring(mesh, top) {
  const sides=mesh.geometry.parameters.radialSegments, offset=top?0:sides+1;
  const p=mesh.geometry.attributes.position, center=new THREE.Vector3();
  for(let i=0;i<sides;i++)center.add(new THREE.Vector3().fromBufferAttribute(p,offset+i).applyMatrix4(mesh.matrixWorld));
  return center.multiplyScalar(1/sides);
}
const vegetative = model => {
  model.group.updateMatrixWorld(true);
  return collect(model,o=>o.isMesh&&o.userData.organ!=='flower').map(o=>({
    role:o.userData.role, matrix:[...o.matrixWorld.elements], vertices:[...o.geometry.attributes.position.array],
  }));
};
const reproductiveVertices = model => {
  model.group.updateMatrixWorld(true);
  return meshes(model).filter(o=>o.userData.organ==='flower').map(o=>{
    const p=o.geometry.attributes.position;
    return Array.from({length:p.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));
  }).flat();
};

test('annual reproductive support and petal schedule is cyclic, bounded and independent of age/seed',()=>{
  for(const species of ['iris','oxalis']) {
    const prior=herbReproductionPriors[species];
    assert.ok(prior.stalk[0]<prior.petals[0]);
    assert.ok(prior.petals[3]<=prior.collapse[0]);
    for(let day=1;day<=365;day+=.5) {
      const c=herbReproduction(species,day);
      for(const key of ['emergence','petalExpansion','petalDecline','dryFraction','collapse','support','petals'])assert.ok(c[key]>=0&&c[key]<=1);
      if(c.petals>0)assert.ok(c.support>0,'no petal appears without its support');
      assert.deepEqual(herbReproduction(species,day+365),c);
    }
    assert.equal(herbReproduction(species,1).support,0);
    assert.equal(herbReproduction(species,365).support,0);
    assert.equal(herbReproduction(species,120).petals,1);
  }
});

test('actual stalk rings touch flower and basal owner through onset/decline, all requested days, ages and seeds under motion',()=>{
  for(const species of ['iris','oxalis'])for(const seed of seeds)for(const age of ages) {
    let reference, counts;
    const prior=herbReproductionPriors[species];
    const sampledDays=[...new Set([...days,...prior.stalk,...prior.petals,...prior.drying,...prior.collapse])];
    for(const day of sampledDays) {
      const m=build(species,day,age,seed);
      try {
        const v=vegetative(m), current=[m.leafCount,m.branches.length,sites(m).length,meshes(m).length];
        if(!reference){reference=v;counts=current;}else {assert.deepEqual(v,reference);assert.deepEqual(current,counts);}
        m.update(3,9,9.81,1);m.group.updateMatrixWorld(true);
        for(const site of sites(m)) {
          assert.equal(site.parent,m.branches[site.userData.ownerBranch].pivot,'same vegetative branch owns reproductive assembly');
          const stalk=site.children.find(o=>o.userData.organPart==='reproductive-support');
          const flower=site.children.find(o=>o.userData.role===`${species}-flower`);
          close(ring(stalk,false),position(site.parent),'base on moving branch');
          close(ring(stalk,true),position(flower),'actual distal ring touches flower insertion');
          const petals=collect({group:flower},o=>o.isMesh&&o.userData.role!=='fringed-white-crest');
          for(const petal of petals) {
            const p=petal.geometry.attributes.position;
            const nearest=Math.min(...Array.from({length:p.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(petal.matrixWorld).distanceTo(ring(stalk,true))));
            assert.ok(nearest<5e-8,'actual petal base contacts support (including zero-size birth)');
          }
          if([1,335,365].includes(day)) {
            assert.equal(flower.scale.x,0,'no winter petals');
            if(stalk.scale.y>0) {
              assert.equal(site.userData.cycle.dryFraction,1,'winter support is fully dry');
              assert.equal(stalk.material.color.getHexString(),'a8916d');
            }
          }
          if([1,365].includes(day))assert.equal(stalk.scale.length(),0,'no nonzero green ghost across annual wrap');
        }
      } finally {m.dispose();}
    }
  }
});

test('birth, petal decline, drying and collapse are continuous in actual drawn vertices; 365 to 1 has identical appearance',()=>{
  for(const species of ['iris','oxalis'])for(const seed of seeds) {
    const prior=herbReproductionPriors[species];
    for(const day of [...prior.stalk,...prior.petals,...prior.drying,...prior.collapse]) {
      const a=build(species,Math.max(1,day-1e-5),2,seed), b=build(species,Math.min(365,day+1e-5),2,seed);
      try {
        const av=reproductiveVertices(a),bv=reproductiveVertices(b);assert.equal(av.length,bv.length);
        assert.ok(av.every((v,i)=>v.distanceTo(bv[i])<2e-6),`${species} seed=${seed} day=${day}: geometry jump`);
        const ca=sites(a)[0].children[0].material.color, cb=sites(b)[0].children[0].material.color;
        assert.ok(Math.abs(ca.r-cb.r)+Math.abs(ca.g-cb.g)+Math.abs(ca.b-cb.b)<2e-6);
      } finally {a.dispose();b.dispose();}
    }
    const last=build(species,365,2,seed),first=build(species,1,2,seed);
    try {
      const a=reproductiveVertices(last),b=reproductiveVertices(first);
      assert.ok(a.every((v,i)=>v.distanceTo(b[i])<1e-12));
      assert.deepEqual(vegetative(last),vegetative(first));
    } finally {last.dispose();first.dispose();}
  }
});

test('mature reproductive sites keep stable owners and coordinates with age instead of rerolling',()=>{
  for(const species of ['iris','oxalis'])for(const seed of seeds) {
    let checked=0;
    for(const [young,oldAge] of [[.5,2],[2,2.5]]) {
      const a=build(species,120,young,seed),b=build(species,120,oldAge,seed);
      try {
        a.group.updateMatrixWorld(true);b.group.updateMatrixWorld(true);
        for(const old of sites(a).filter(o=>o.userData.readiness===1)) {
          checked++;
          const next=sites(b).find(o=>o.userData.site===old.userData.site);assert.ok(next);
          close(position(old),position(next),'established reproductive insertion');
          close(ring(old.children[0],true),ring(next.children[0],true),'established flower endpoint');
          assert.deepEqual(old.userData.cycle,next.userData.cycle);
        }
      } finally {a.dispose();b.dispose();}
    }
    assert.ok(checked>0,'exercise actual mature sites, not an empty filter');
  }
});

test('bounded draw resources and cleanup include new seasonal material exactly once',()=>{
  for(const species of ['iris','oxalis'])for(const day of [1,120,200,335,365]) {
    const m=build(species,day,2,42,2),resources=new Set();
    const all=meshes(m);
    // Baseline mesh budgets: Iris <=8*(8 blades+12 floral parts+scape+root+bud)+8 rhizomes;
    // Oxalis 37*(3 leaflets+5 petals+petiole+peduncle+root)+36 internodes+propagule+bud.
    // First worker run used an unjustified 400 cap; frozen baseline Oxalis is 445.
    assert.ok(all.length<=(species==='iris'?192:445),'no increase over baseline density=2 mesh budget');
    assert.ok(sites(m).length<40,'bounded reproductive slot budget');
    for(const mesh of all) {
      resources.add(mesh.geometry);
      for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
        resources.add(mat);for(const x of Object.values(mat))if(x?.isTexture)resources.add(x);
      }
    }
    const counts=new Map([...resources].map(x=>[x,0]));
    for(const x of resources)x.addEventListener('dispose',()=>counts.set(x,counts.get(x)+1));
    const meta=m.group.userData.development;
    assert.match(meta.reproduction,/capsules and seed dispersal not modeled/);
    assert.match(meta.reproductiveCycle.mechanics,/excluded/);
    assert.match(meta.reproductiveCycle.scope,/not tracked multi-year/);
    m.dispose();m.dispose();assert.equal(m.group.children.length,0);
    assert.ok([...counts.values()].every(n=>n===1));
  }
});
