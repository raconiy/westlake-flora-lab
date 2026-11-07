import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildAdditionalPlant } from './additional-species.ts';
import { ophiopogonRamet } from './development.ts';

const defaults = { day: 180, seed: 42, density: 1 };
// Engineering regression assumptions, NOT botanical measurements: Float32 transforms
// get 3 micrometres of slack; sampled tube chords get 3 cm; boundary sweeps use
// +/- 1 microyear and allow 0.2 mm bounds / length and 0.02 mm radius changes.
const positionTolerance = 3e-6, chordTolerance = .03, epsilon = 1e-6;
const ages = [0, .02, .025, .07, .1, .3, .5, 1, 2, 3, 5, 8, 10, 14, 18, 24, 45, 80, 120];
const point = (attribute, index) => new THREE.Vector3().fromBufferAttribute(attribute, index);
const world = (p, object) => p.clone().applyMatrix4(object.matrixWorld);
function distanceToLine(p, line) {
 let distance = Infinity;
 for (let i = 1; i < line.length; i++) {
  const segment = new THREE.Line3(line[i - 1], line[i]);
  distance = Math.min(distance, p.distanceTo(segment.closestPointToPoint(p, true, new THREE.Vector3())));
 }
 return distance;
}
function inspect(model) {
 model.group.updateMatrixWorld(true);
 const nodes = new Map(), axes = new Map(), leaves = new Map(), lines = new Map();
 let draws = 0, vertices = 0;
 for (const joint of model.branches) {
  // Order/index also works on the pre-fix model; phase is NOT a unique identity
  // (the leader and first lateral share a phase seed).
  const id = `${joint.order}:${nodes.size}`;
  nodes.set(id, { position: joint.pivot.getWorldPosition(new THREE.Vector3()), length: joint.length, radius: joint.radius });
  if (joint.order === 0) {
   const mesh = joint.pivot.children.find(o => o.isMesh && !o.isInstancedMesh);
   const p = mesh.geometry.attributes.position, line = [], {segments,sides}=mesh.geometry.userData.woodTube;
   for (let ring = 0; ring <= segments; ring++) {
    const centre = new THREE.Vector3();
    for (let side = 0; side < sides; side++) centre.add(point(p, ring * (sides+1) + side));
    line.push(world(centre.divideScalar(sides), mesh));
   }
   lines.set('leader', line);
  }
 }
 model.group.traverse(o => {
  if (!o.isMesh) return;
  draws++; vertices += o.geometry.attributes.position.count;
  let offset = 0;
  for (const axis of o.userData.axes || []) {
   axes.set(axis.id, axis);
   // Inspect actual merged tube vertices, including the secondary/twig axes
   // which intentionally have no separate dynamics joint or draw call.
   const [segments, sides] = axis.id.includes(':twig:') ? [5, 4] : axis.id.includes(':secondary:') ? [8, 5] : [14, 7];
   const p = o.geometry.attributes.position, line = [];
   for (let ring = 0; ring <= segments; ring++) {
    const centre = new THREE.Vector3();
    for (let side = 0; side < sides; side++) {
     const vertex = offset + Math.min(ring, segments - 1) * sides * 6 + side * 6 + (ring === segments ? 1 : 0);
     centre.add(point(p, vertex));
    }
    line.push(world(centre.divideScalar(sides), o));
   }
   lines.set(axis.id, line); offset += segments * sides * 6;
  }
  if (o.userData.axes) assert.equal(offset, o.geometry.attributes.position.count, 'audit covers every rendered woody tube');
  if (!o.isInstancedMesh || o.userData.connectedBy !== 'petiole') return;
  const stalk = o.parent.children.find(s => s.isInstancedMesh && s.userData.organ === 'petiole');
  assert.ok(stalk); assert.equal(o.count, stalk.count);
  assert.equal(o.userData.nodes.length, o.count);
  for (let i = 0; i < o.count; i++) {
   const blade = new THREE.Matrix4(), petiole = new THREE.Matrix4();
   o.getMatrixAt(i, blade); stalk.getMatrixAt(i, petiole);
   const start = world(new THREE.Vector3(0, -.5, 0).applyMatrix4(petiole), stalk);
   const tip = world(new THREE.Vector3(0, .5, 0).applyMatrix4(petiole), stalk);
   const base = world(new THREE.Vector3().applyMatrix4(blade), o);
   assert.ok(tip.distanceTo(base) < positionTolerance, 'actual petiole tip meets actual blade base');
   const node = o.userData.nodes[i];
   leaves.set(node.id, { leafClass:o.userData.leafClass, position: start, birth: node.birth, scale: new THREE.Vector3().setFromMatrixScale(blade).x });
  }
 });
 const dormantSites=new Map(),juvenile=model.group.userData.juvenileTrueLeaves;
 if(juvenile?.event.completed){
  const frame=model.group.getObjectByName('acer-epicotyl-reference')??model.branches[0].pivot;
  for(const site of juvenile.sites)for(const side of [0,1])dormantSites.set(`${site.id}:${side}`,world(new THREE.Vector3(...site.attachment),frame));
 }
 const persistentLeafCount=[...leaves.values()].filter(l=>l.leafClass!=='juvenile-true-leaf').length;
 return { nodes, axes, leaves, dormantSites, persistentLeafCount, lines, draws, vertices, height: model.height, leafCount: model.leafCount };
}
function compare(previous, current, message) {
 const arcLength = line => line.slice(1).reduce((sum, p, i) => sum + p.distanceTo(line[i]), 0);
 for (const [id, old] of previous.lines) {
  const line = current.lines.get(id); assert.ok(line, `${message}: rendered wood ${id} persists`);
  assert.ok(arcLength(line) + positionTolerance >= arcLength(old), `${message}: rendered wood ${id} shortens`);
 }
 for (const [id, old] of previous.nodes) {
  const node = current.nodes.get(id); assert.ok(node, `${message}: joint ${id} persists`);
  assert.ok(node.position.distanceTo(old.position) < positionTolerance, `${message}: joint ${id} drifts`);
  assert.ok(node.length + 1e-12 >= old.length && node.radius + 1e-12 >= old.radius, `${message}: joint wood shrinks`);
 }
 for (const [id, old] of previous.axes) {
  const axis = current.axes.get(id); assert.ok(axis, `${message}: merged wood ${id} persists`);
  assert.ok(axis.length + 1e-12 >= old.length && axis.radius + 1e-12 >= old.radius, `${message}: merged wood ${id} shrinks`);
  assert.deepEqual(axis.attachment, old.attachment, `${message}: secondary / twig attachment drifts`);
 }
 for (const [id, old] of previous.leaves) {
  const leaf = current.leaves.get(id);
  if(!leaf){
   assert.equal(old.leafClass,'juvenile-true-leaf',`${message}: only a declared one-time juvenile leaf cohort may retire`);
   const site=current.dormantSites.get(id);assert.ok(site,`${message}: retired blade leaves its permanent woody material site`);
   assert.ok(site.distanceTo(old.position)<positionTolerance,`${message}: dormant site drifts`);
  }else assert.ok(leaf.position.distanceTo(old.position) < positionTolerance, `${message}: leaf node ${id} drifts`);
 }
 for(const [id,point]of previous.dormantSites){
  const site=current.dormantSites.get(id);assert.ok(site,`${message}: dormant woody site remains catalogued`);
  assert.ok(site.distanceTo(point)<positionTolerance,`${message}: dormant woody site drifts after retirement`);
  assert.ok(distanceToLine(site,current.lines.get('leader'))<chordTolerance,`${message}: dormant node remains on rendered primary support`);
 }
 assert.ok(current.height + positionTolerance >= previous.height, `${message}: crown / leader height collapses`);
 // A permanent woody site is not an immortal physical leaf. Only the
 // separately documented establishment cohort can retire; every other site
 // and the retained foliage proxy keep the original no-disappearance gate.
 assert.ok(current.persistentLeafCount >= previous.persistentLeafCount, `${message}: undeclared crown disappearance`);
}

test('woody material nodes and every branch order persist from establishment to adult as height increases', () => {
 for (const species of ['camphor', 'acer']) for (const [seed, density] of [[42, .15], [42, 1], [73, 2]]) {
  let previous;
  for (const age of ages) {
   const model = buildAdditionalPlant(species, { ...defaults, seed, density, age });
   try {
    const current = inspect(model);
    if (previous) compare(previous, current, `${species} seed ${seed} density ${density} age ${age}`);
    if (age === 0) { assert.equal(current.nodes.size, 0); assert.equal(current.leafCount, 0); assert.equal(current.height, 0); }
    if (age >= .1) assert.ok(current.leafCount > 0);
    if (age >= 45) { assert.ok(current.axes.size > 100); assert.ok(current.leafCount > 1000 * density); }
    const seedDraws=model.group.getObjectByName('woody-seed-establishment')?1:0;
    assert.ok(current.draws-seedDraws <= (species === 'camphor' ? 60 : 43), 'original canopy + seed + at most one persistent terminal-meristem draw');
    assert.ok(current.vertices < (species==='camphor'?550000:180000), 'explicit merged geometry budget, including camphor terminal shoots');
    const perSecondary = species === 'camphor' ? Math.max(3, Math.round(10 * density)) + 5 * 4 * Math.max(3, Math.round(8 * density)) : 2 * Math.max(3, Math.round(6 * density)) + 8 * Math.max(3, Math.round(5 * density));
    const budget = species === 'camphor' ? 78 + 19 * (6 + 9 * perSecondary) : 156 + 12 * (12 + 7 * perSecondary);
    assert.ok(current.leafCount <= budget, 'bounded apical and terminal cohorts; blade dimensions are unchanged');
    previous = current;
   } finally { model.dispose(); }
  }
 }
});

test('material attachments lie on rendered parent wood, also under dynamics loads', () => {
 for (const species of ['camphor', 'acer']) for (const age of [.1, 3, 10, 18, 45, 120]) {
  const model = buildAdditionalPlant(species, { ...defaults, age });
  try {
   for (const loaded of [false, true]) {
    model.update(2, loaded ? 8 : 0, loaded ? 9.81 : 0, 1);
    const snapshot = inspect(model);
    for (const joint of model.branches.filter(j => j.order === 1)) {
     const p = joint.pivot.getWorldPosition(new THREE.Vector3());
     assert.ok(distanceToLine(p, snapshot.lines.get('leader')) < chordTolerance, 'lateral starts on actual leader');
    }
    for (const [id, axis] of snapshot.axes) {
     assert.ok(distanceToLine(snapshot.lines.get(id)[0], snapshot.lines.get(axis.parentId)) < chordTolerance, `${species} ${id}: merged wood starts on actual parent`);
    }
    for (const [id, leaf] of snapshot.leaves) {
     const axisId = id.split(':leaf:')[0];
     assert.ok(distanceToLine(leaf.position, snapshot.lines.get(axisId)) < chordTolerance, `${species} ${id}: leaf starts on actual axis (distance ${distanceToLine(leaf.position, snapshot.lines.get(axisId))})`);
    }
   }
   model.update(2, 0, 0, 1);
   for (const joint of model.branches) assert.ok(joint.pivot.quaternion.angleTo(joint.rest) < 1e-7);
  } finally { model.dispose(); }
 }
});

test('bounds and wood dimensions are continuous at all lateral births and representative descendant / leaf births', () => {
 for (const species of ['camphor', 'acer']) {
  const adult = buildAdditionalPlant(species, { ...defaults, age: 120 }), snapshot = inspect(adult);
  const boundaries = new Set([.025, .07, .5, 1, 2, 18]);
  for (const axis of snapshot.axes.values()) if (axis.parentId === 'leader') boundaries.add(axis.birth);
  for (const values of [snapshot.axes, snapshot.leaves]) {
   const births = [...values.values()].map(x => x.birth).sort((a, b) => a - b);
   for (let i = 0; i < births.length; i += Math.max(1, Math.floor(births.length / 12))) boundaries.add(births[i]);
  }
  adult.dispose();
  for (const age of boundaries) {
   const a = buildAdditionalPlant(species, { ...defaults, age: age - epsilon });
   const b = buildAdditionalPlant(species, { ...defaults, age: age + epsilon });
   try {
    const ba = new THREE.Box3().setFromObject(a.group), bb = new THREE.Box3().setFromObject(b.group);
    for (const box of [ba, bb]) if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
    assert.ok(ba.min.distanceTo(bb.min) < .0002 && ba.max.distanceTo(bb.max) < .0002, `${species} bounds at ${age}`);
    const before = inspect(a), after = inspect(b); compare(before, after, `${species} boundary ${age}`);
    for (const [id, axis] of after.axes) {
     const old = before.axes.get(id);
     assert.ok(axis.length - (old?.length || 0) < .0002, 'new wood starts at zero length');
     assert.ok(axis.radius - (old?.radius || 0) < .00002, 'no sudden thick wood');
    }
   } finally { a.dispose(); b.dispose(); }
  }
 }
});

test('day controls leaf phenology while age controls persistent scaffold and centimetre mature blades', () => {
 for (const species of ['camphor', 'acer']) {
  for (const age of [0, .1, 3, 18, 80]) {
   const summer = buildAdditionalPlant(species, { ...defaults, age });
   const winter = buildAdditionalPlant(species, { ...defaults, age, day: 15 });
   try {
    const a = inspect(summer), b = inspect(winter);
    assert.deepEqual(a.nodes, b.nodes); assert.deepEqual(a.axes, b.axes);
    if (species === 'acer') assert.equal(winter.leafCount, 0);
    else assert.equal(summer.leafCount, winter.leafCount);
    summer.group.traverse(o => {
     if (!o.isInstancedMesh || o.userData.connectedBy !== 'petiole') return;
     o.geometry.computeBoundingBox(); const size = o.geometry.boundingBox.getSize(new THREE.Vector3());
     for (let i = 0; i < o.count; i++) {
      const matrix = new THREE.Matrix4(); o.getMatrixAt(i, matrix);
      const scale = new THREE.Vector3().setFromMatrixScale(matrix), mature = age >= o.userData.nodes[i].birth + .38;
      assert.ok(size.y * scale.y <= (species === 'camphor' ? .12 : .06));
      assert.ok(size.x * scale.x <= (species === 'camphor' ? .055 : .08));
      if (mature && o.userData.leafClass !== 'juvenile-true-leaf') { assert.ok(size.y * scale.y >= (species === 'camphor' ? .06 : .03)); assert.ok(size.x * scale.x >= (species === 'camphor' ? .025 : .04)); }
     }
    });
   } finally { summer.dispose(); winter.dispose(); }
  }
 }
});

test('ophiopogon keeps its shared extending rhizome endpoints, rooted rosettes and evergreen adult crown', () => {
 // Ramet translation during its first .9 years is an existing engineering
 // assumption shared with rhizosphere, not height-proportional woody node drift.
 for (const [seed, density] of [[42, .15], [42, 1], [73, 2]]) {
  let previousCount = 0;
  for (const age of [0, .025, .1, .5, 1, 1.03, 1.5, 2, 3, 4, 5, 8]) {
   const summer = buildAdditionalPlant('ophiopogon', { ...defaults, seed, density, age, day: 200 });
   const winter = buildAdditionalPlant('ophiopogon', { ...defaults, seed, density, age, day: 15 });
   try {
    assert.equal(summer.leafCount, winter.leafCount); assert.ok(summer.leafCount >= previousCount);
    assert.ok(summer.height < .5);
    if (age === 0) { assert.equal(summer.height, 0); assert.equal(summer.branches.length, 0); }
    const expected = [];
    for (let i = 0; i < 1 + Math.round(6 * density); i++) {
     const ramet = ophiopogonRamet(i, age);
     if (ramet.growth > 0) expected.push(new THREE.Vector3(ramet.x, 0, ramet.z));
    }
    assert.equal(summer.branches.length, expected.length);
    summer.branches.forEach((j, i) => { assert.ok(j.pivot.position.distanceTo(expected[i]) < 1e-12); assert.equal(j.pivot.userData.woody, false); });
    if (age >= 8) assert.equal(summer.branches.length, 1 + Math.round(6 * density));
    previousCount = summer.leafCount;
   } finally { summer.dispose(); winter.dispose(); }
  }
 }
 const a = buildAdditionalPlant('ophiopogon', { ...defaults, age: 8, day: 15 });
 const b = buildAdditionalPlant('ophiopogon', { ...defaults, age: 10, day: 15 });
 try {
  const ribbons = m => m.branches.map(j => Array.from(j.pivot.children.find(o => o.userData.organ === 'leaf').geometry.attributes.position.array));
  assert.deepEqual(ribbons(a), ribbons(b), 'established blades are not rerolled, shortened or deleted');
  assert.deepEqual(a.branches.map(j => j.pivot.position.toArray()), b.branches.map(j => j.pivot.position.toArray()));
 } finally { a.dispose(); b.dispose(); }
});

test('retired establishment sites are checked continuously, including a deliberate post-retirement drift',()=>{
 const a=buildAdditionalPlant('acer',{...defaults,age:.81}),b=buildAdditionalPlant('acer',{...defaults,age:1});
 try{
  const before=inspect(a),after=inspect(b);assert.equal(before.dormantSites.size,12);assert.equal(after.dormantSites.size,12);
  compare(before,after,'retired site baseline');
  const [id,site]=after.dormantSites.entries().next().value;site.x+=.01;
  assert.throws(()=>compare(before,after,'injected drift'),/dormant woody site drifts after retirement/,'10mm dormant-node drift must fail the actual continuity audit');
  site.x-=.01;after.dormantSites.delete(id);
  assert.throws(()=>compare(before,after,'injected missing site'),/dormant woody site remains catalogued/);
 }finally{a.dispose();b.dispose();}
});
