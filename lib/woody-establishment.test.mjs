import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildAdditionalPlant} from './additional-species.ts';
import {buildRhizosphere} from './rhizosphere.ts';
import {woodyEstablishmentPriors, woodyEstablishmentState} from './woody-establishment.ts';
import {modelBounds, perspectiveBoundsFrame, perspectiveCameraRange, cameraContainsBounds} from './scene-framing.ts';

const ages = [0, .02, .05, .1, .2, .5, 1];
const base = {day: 180, seed: 42, density: 1};
const rootBase = {seed: 42, moisture: .55, compaction: .2, cutaway: true};
const vector = (p, i) => new THREE.Vector3().fromBufferAttribute(p, i);
const distance = (a, b) => assert.ok(a.distanceTo(b) < 2e-8, `${a.toArray()} meets ${b.toArray()}`);
function organVertices(mesh, organ) {
  const range = mesh.userData.organs.find(o => o.organ === organ);
  return range ? Array.from({length: range.count}, (_, i) => vector(mesh.geometry.attributes.position, range.start + i)) : [];
}
function firstRootRing(mesh) {
  const p = mesh.geometry.attributes.position, n = mesh.userData.ringSides;
  return Array.from({length: n}, (_, i) => vector(p, i)).reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(n);
}

test('both woody assets contain real centimetre-scale buried propagules at age zero and retain their actual coat material', () => {
  for (const species of ['camphor', 'acer']) {
    let originalCoat, originalWing;
    for (const age of [...ages, 80]) {
      const model = buildAdditionalPlant(species, {...base, age});
      try {
        const mesh = model.group.getObjectByName('woody-seed-establishment'); assert.ok(mesh?.isMesh);
        const coat = organVertices(mesh, 'seed-coat'), wing = organVertices(mesh, 'samara-wing');
        assert.ok(coat.length > 500, 'a real renderable coat, not just a label');
        assert.ok(mesh.geometry.attributes.position.count < 5000, 'one small persistent establishment mesh');
        let meshes = 0; model.group.traverse(o => {if (o.isMesh) meshes++;});
        assert.ok(meshes <= (species === 'camphor' ? 61 : 40), 'old canopy budget plus exactly one seed mesh');
        if (!originalCoat) {originalCoat = coat; originalWing = wing;}
        assert.deepEqual(coat, originalCoat, 'formed coat never shrinks, moves or disappears');
        assert.deepEqual(wing, originalWing, 'samara wing is retained without age-only deletion');
        assert.equal(wing.length > 0, species === 'acer');
        const box = new THREE.Box3().setFromPoints(coat);
        assert.ok(box.getSize(new THREE.Vector3()).length() < .014, 'millimetre coat, not giant visibility proxy');
        assert.ok(box.max.y < 0 && box.min.y > -.05);
        if (species === 'acer') assert.ok(new THREE.Box3().setFromPoints(wing).max.x <= .022);
        assert.ok(coat.some(p => p.distanceTo(woodyEstablishmentState(species, age).pole) < 1e-8), 'actual coat includes lower pole');
        let cotyledons = 0;
        model.group.traverse(o => {if (/cotyledon/.test(o.userData.organ || '')) cotyledons++;});
        assert.equal(cotyledons, 0, 'no unsupported green aerial cotyledons or palmate blades labelled as cotyledons');
        if (age === 0) {
          assert.equal(model.height, 0); assert.equal(model.leafCount, 0); assert.equal(model.branches.length, 0);
          assert.equal(organVertices(mesh, 'embryonic-axis').length, 0);
        }
        if (age <= .5) assert.equal(model.branches.filter(b => b.order > 0).length, 0);
        if (age >= .1) {
          assert.ok(model.leafCount > 0);
          model.group.traverse(o => {if (o.userData.organ === 'leaf') assert.equal(o.userData.leafClass, 'true-leaf');});
        }
      } finally {model.dispose();}
    }
  }
});

test('actual coat, embryonic-axis rings, radicle pole and emerging leader collar share connected support at every requested age', () => {
  for (const species of ['camphor', 'acer']) for (const soilDepth of [.05, .1, 2.5]) for (const age of ages) {
    const plant = buildAdditionalPlant(species, {...base, age});
    const leader = plant.branches.find(b => b.order === 0);
    const collar = leader ? {position: leader.pivot.position.toArray(), radius: leader.radius * 1.4} : undefined;
    const roots = buildRhizosphere(species, {...rootBase, age, soilDepth, shootCollar: collar});
    try {
      const state = woodyEstablishmentState(species, age), seed = plant.group.getObjectByName('woody-seed-establishment');
      const embryonic = organVertices(seed, 'embryonic-axis');
      const primary = roots.group.children.find(o => o.userData.axisId === `${species}:root:primary`);
      if (age === 0) assert.ok(!primary);
      else {
        assert.ok(primary); distance(firstRootRing(primary), state.pole);
        assert.ok(primary.geometry.attributes.position.array.some((_, i, a) => i % 3 === 1 && a[i] < state.pole.y), 'radicle extends below coat');
        assert.ok(embryonic.length > 0);
        const low = Math.min(...embryonic.map(p => p.y)), high = Math.max(...embryonic.map(p => p.y));
        assert.ok(Math.abs(low - state.pole.y) < 1e-8 && Math.abs(high - state.tip.y) < 1e-8);
        if (age >= .025) distance(state.tip, new THREE.Vector3());
      }
      if (leader) {
        const tube = leader.pivot.children.find(o => o.isMesh && !o.isInstancedMesh), p = tube.geometry.attributes.position;
        const centre = Array.from({length: 10}, (_, i) => vector(p, i)).reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(10);
        distance(centre, state.collar); distance(leader.pivot.position, state.collar);
        const junction = roots.group.getObjectByName('root-shoot-junction'); assert.ok(junction);
        junction.geometry.computeBoundingBox();
        assert.ok(Math.abs(junction.geometry.boundingBox.max.y) < 1e-8 && junction.geometry.boundingBox.min.y < state.pole.y);
      } else assert.equal(plant.height, 0);
      for (const mesh of [seed, ...roots.group.children.filter(o => o.userData.organ === 'root')]) {
        const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal;
        for (let i = 0; i < p.count; i++) {
          assert.ok(vector(p, i).toArray().every(Number.isFinite));
          assert.ok(vector(n, i).toArray().every(Number.isFinite));
          assert.ok(p.getY(i) >= -soilDepth && p.getY(i) <= 0, 'actual underground vertices respect finite soil bounds');
        }
      }
    } finally {plant.dispose(); roots.dispose();}
  }
});

test('establishment births extend continuously and retain the actual coat across onset, collar arrival and first leaves', () => {
  for (const species of ['camphor', 'acer']) for (const age of [.008, .012, .025, .05, .07, .1, .2, .25, .5, .65, 1]) {
    const a = buildAdditionalPlant(species, {...base, age: age - 1e-7});
    const b = buildAdditionalPlant(species, {...base, age: age + 1e-7});
    try {
      const sa = a.group.getObjectByName('woody-seed-establishment'), sb = b.group.getObjectByName('woody-seed-establishment');
      assert.deepEqual(organVertices(sa, 'seed-coat'), organVertices(sb, 'seed-coat'));
      const ba = new THREE.Box3().setFromObject(a.group), bb = new THREE.Box3().setFromObject(b.group);
      assert.ok(ba.min.distanceTo(bb.min) < .00001 && ba.max.distanceTo(bb.max) < .00001);
      assert.ok(Math.abs(a.height - b.height) < .00001);
      const axisA = organVertices(sa, 'embryonic-axis'), axisB = organVertices(sb, 'embryonic-axis');
      if (axisA.length) {
        const oldLevels = new Set(axisA.map(p => p.y)); oldLevels.delete(Math.max(...oldLevels));
        const newLevels = new Set(axisB.map(p => p.y));
        for (const y of oldLevels) assert.ok(newLevels.has(y), 'formed underground material rings retain their levels');
      }
    } finally {a.dispose(); b.dispose();}
  }
});

test('actual buried seed bounds support centimetre camera framing without giant seeds or metre-scale clip limits', () => {
  for (const species of ['camphor', 'acer']) {
    const model = buildAdditionalPlant(species, {...base, age: 0});
    try {
      const bounds = modelBounds(model.group), frame = perspectiveBoundsFrame(bounds, new THREE.Vector3(.8, .44, -2.1), 35, 1.2);
      const camera = new THREE.PerspectiveCamera(35, 1.2);
      const range = perspectiveCameraRange(bounds, frame.position, frame.target, frame.distance);
      Object.assign(camera, {near: range.near, far: range.far});
      camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateProjectionMatrix();
      assert.ok(frame.distance > .005 && frame.distance < .1);
      assert.ok(range.minDistance < .001 && range.near < .0001);
      assert.ok(cameraContainsBounds(bounds, camera));
    } finally {model.dispose();}
  }
  assert.equal(woodyEstablishmentPriors.calibrated, false);
});
