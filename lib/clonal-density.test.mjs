import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { buildAdditionalPlant } from './additional-species.ts';

const build = species => species === 'iris' || species === 'oxalis' ? buildPlant : buildAdditionalPlant;
const densities = [.3, 1, 1.8];
const ages = [.1, .5, 2, 18];

function rametPositions(model) {
  model.group.updateMatrixWorld(true);
  const out = new Map();
  model.group.traverse(object => {
    const id = object.userData?.rametId;
    if (typeof id === 'string') out.set(id, object.getWorldPosition(new THREE.Vector3()));
  });
  return out;
}

function bounds(model) {
  model.group.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(model.group).getSize(new THREE.Vector3());
}

for (const species of ['iris', 'oxalis', 'ophiopogon']) {
  test(`${species} density adds clonal sites without moving established same-seed ramets`, () => {
    const snapshots = [];
    for (const density of densities) {
      const model = build(species)(species, { age: 18, day: 180, seed: 42, density });
      snapshots.push({ density, positions: rametPositions(model), size: bounds(model), leafCount: model.leafCount });
      model.dispose();
    }
    const low = snapshots[0], high = snapshots[2];
    let common = 0;
    for (const [id, position] of low.positions) {
      const other = high.positions.get(id);
      if (!other) continue;
      common++;
      assert.ok(position.distanceTo(other) < 1e-9, `${species}: existing ${id} moved with density`);
    }
    assert.ok(common > 0, `${species}: no common established ramets to compare`);
    assert.ok(high.positions.size >= low.positions.size, `${species}: density removed ramets`);
    assert.ok(high.leafCount >= low.leafCount, `${species}: density reduced leaves`);
    assert.ok(high.size.x >= low.size.x - 1e-9 && high.size.z >= low.size.z - 1e-9,
      `${species}: denser patch did not occupy at least the same horizontal area`);
  });
}

test('clonal density layouts are deterministic but seed-sensitive', () => {
  for (const species of ['iris', 'oxalis', 'ophiopogon']) {
    const a = build(species)(species, { age: 18, day: 180, seed: 137, density: 1.8 });
    const b = build(species)(species, { age: 18, day: 180, seed: 137, density: 1.8 });
    const c = build(species)(species, { age: 18, day: 180, seed: 138, density: 1.8 });
    try {
      const pa = rametPositions(a), pb = rametPositions(b), pc = rametPositions(c);
      assert.deepEqual([...pa].map(([id, p]) => [id, p.toArray()]), [...pb].map(([id, p]) => [id, p.toArray()]));
      const difference = [...pa].some(([id, p]) => pc.has(id) && p.distanceTo(pc.get(id)) > 1e-6);
      assert.ok(difference, `${species}: changing seed did not alter clonal layout`);
    } finally { a.dispose(); b.dispose(); c.dispose(); }
  }
});

test('density and growth checkpoints keep clonal meshes finite and connected', () => {
  for (const species of ['iris', 'oxalis', 'ophiopogon']) for (const age of ages) for (const density of densities) {
    const model = build(species)(species, { age, day: 180, seed: 42, density });
    try {
      model.group.updateMatrixWorld(true);
      model.group.traverse(object => {
        if (!object.isMesh) return;
        const positions = object.geometry?.attributes?.position?.array ?? [];
        for (const value of positions) assert.ok(Number.isFinite(value), `${species}: non-finite vertex`);
        for (const value of object.matrixWorld.elements) assert.ok(Number.isFinite(value), `${species}: non-finite transform`);
      });
      for (const branch of model.branches) assert.ok(branch.length > 1e-12, `${species}: zero-length dynamic branch`);
    } finally { model.dispose(); }
  }
});
