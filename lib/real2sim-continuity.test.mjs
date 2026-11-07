import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { buildAdditionalPlant } from './additional-species.ts';
import { buildRhizosphere } from './rhizosphere.ts';
import { ophiopogonRamet } from './development.ts';

const treeSpecies = new Set(['ginkgo', 'osmanthus']);
const builders = {
  ginkgo: buildPlant, osmanthus: buildPlant, iris: buildPlant, oxalis: buildPlant,
  camphor: buildAdditionalPlant, acer: buildAdditionalPlant, ophiopogon: buildAdditionalPlant,
};
const ages = [0, .1, .5, 1, 18, 45];
const seeds = [42, 137];

function finiteGeometry(model) {
  model.group.updateMatrixWorld(true);
  model.group.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position?.array ?? [];
    for (const value of positions) assert.ok(Number.isFinite(value), `${object.name}: non-finite vertex`);
    for (const value of object.matrixWorld.elements) assert.ok(Number.isFinite(value), `${object.name}: non-finite transform`);
    if (object.isInstancedMesh) for (const value of object.instanceMatrix.array) assert.ok(Number.isFinite(value), 'non-finite organ instance');
  });
}

// Read rendered organs, not aggregate leaf counts. Species lacking an explicit
// id string are keyed by their existing fixed cohort/node catalogue. No UUID or
// traversal index is used as a substitute for an organ identity.
function organRecords(model, species) {
  const records = [], ids = new Set();
  const add = record => {
    assert.ok(!ids.has(record.id), `duplicate organ id ${record.id}`);
    ids.add(record.id); records.push(record);
  };
  model.group.traverse(object => {
    const nodes = object.userData.nodes;
    if (Array.isArray(nodes)) for (const node of nodes) {
      // The explicitly age-limited cotyledon is a one-time seed organ.
      if (!node?.id || object.userData.leafClass === 'cotyledon') continue;
      if (species === 'osmanthus') {
        // Each record is one opposite pair; there must be two real blades.
        assert.equal(object.count, nodes.length * 2);
      }
      add(node);
      assert.ok(Number.isFinite(node.birth) && node.birth >= 0, `${node.id}: invalid birth`);
    }
    if (species === 'osmanthus' && object.userData.connectedBy === 'petiole') {
      for (const node of nodes) for (let side = 0; side < 2; side++) add({id:`${object.userData.axisId}/leaf:${node.index}:${side}`, birth:node.birth});
    }
    if (object.userData.nodeIds) for (const id of object.userData.nodeIds) add({id});
    if (object.userData.role === 'sword-blade') add({id:`iris:${object.userData.cohort}:${object.userData.index}`,
      birth:(object.userData.cohort === 0 ? 0 : .72 + (object.userData.cohort - 1) * .55) + .025 + object.userData.index * .07});
    if (object.userData.role === 'trifoliate-leaf') add({id:`oxalis:${object.userData.node}`, birth:object.userData.birth + .018});
    if (species === 'ophiopogon' && object.isMesh && object.userData.organ === 'leaf') {
      const cohort = object.parent.userData.cohort, perBlade = object.userData.leafVertexCount;
      assert.ok(perBlade > 0 && object.geometry.attributes.position.count % perBlade === 0);
      for (let leaf = 0; leaf < object.geometry.attributes.position.count / perBlade; leaf++) add({id:`ophiopogon:${cohort}:${leaf}`, birth:ophiopogonRamet(cohort, 0).birth + leaf * .019});
    }
  });
  return records;
}

function woodyAxes(model) {
  const axes = new Map();
  for (const joint of model.branches) {
    const id = joint.pivot.userData.axisId ?? joint.pivot.userData.node?.id ?? (joint.order === 0 ? 'leader' : undefined);
    if (!id) continue;
    axes.set(id, {length:joint.length, radius:joint.radius, birth:joint.pivot.userData.birth ?? joint.pivot.userData.node?.birth,
      // Osmanthus' documented immature collar rise transports the whole shoot
      // hierarchy through .9 y; material coordinates are relative to that collar.
      position:joint.order === 0 && model.group.userData.lifecycle?.collarY !== undefined
        ? joint.pivot.position.clone().sub(new THREE.Vector3(0, model.group.userData.lifecycle.collarY, 0)).toArray()
        : joint.pivot.position.toArray()});
  }
  model.group.traverse(object => {
    for (const axis of object.userData.axes ?? []) axes.set(axis.id, {...axis, position:axis.attachment});
  });
  return axes;
}

test('all species keep finite, nonzero formed axes and stable organ identities across the page age anchors', () => {
  for (const species of Object.keys(builders)) for (const seed of seeds) {
    let priorIds = new Set();
    let priorAxes = new Map(), priorBirths = new Map();
    for (const age of ages) {
      const model = builders[species](species, { age, day: 180, seed, density: 1 });
      try {
        finiteGeometry(model);
        for (const branch of model.branches) assert.ok(branch.length > 1e-12, `${species} age ${age}: zero-length formed axis`);
        const records = organRecords(model, species);
        for (const node of records) if (node.birth !== undefined) assert.ok(node.birth < age, `${species} ${node.id}: organ precedes its birth at ${age}`);
        if (age >= .5) assert.ok(records.length > 0, `${species}: audit must inspect actual organs`);
        const now = new Set(records.map(node => node.id));
        for (const id of priorIds) assert.ok(now.has(id), `${species} seed ${seed}: organ ${id} disappeared at ${age}`);
        priorIds = now;
        for (const record of records) {
          if (priorBirths.has(record.id)) assert.equal(record.birth, priorBirths.get(record.id), 'birth time cannot change with age');
          priorBirths.set(record.id, record.birth);
        }
        const axes = woodyAxes(model);
        for (const [id, old] of priorAxes) {
          const axis = axes.get(id); assert.ok(axis, `${species}: formed wood ${id} disappeared`);
          assert.ok(axis.length + 1e-12 >= old.length && axis.radius + 1e-12 >= old.radius, `${species}: wood ${id} retracts`);
          assert.deepEqual(axis.position, old.position, `${species}: formed wood ${id} node slides`);
          assert.equal(axis.birth, old.birth, `${species}: wood birth changes`);
        }
        for (const [id, axis] of axes) if (axis.birth !== undefined) assert.ok(axis.birth < age, `${species}: ${id} precedes birth`);
        priorAxes = axes;
      } finally { model.dispose(); }
    }
  }
});

test('ginkgo primary emergence has no millimetre cutoff or finite-radius jump', () => {
  // Independently invert the original 1 mm display cutoff (not a biological clock).
  let lo = .035, hi = .12;
  for (let i = 0; i < 50; i++) {
    const a = (lo + hi) / 2, t = (a - .035) / .085;
    if ((.025 + .42 * a) * t * t * (3 - 2 * t) < .001) lo = a; else hi = a;
  }
  for (const seed of seeds) for (const age of [.035, hi]) {
    const before = buildPlant('ginkgo', {age:age - 1e-7, day:180, seed, density:1});
    const after = buildPlant('ginkgo', {age:age + 1e-7, day:180, seed, density:1});
    try {
      const extent = model => model.branches[0] ? new THREE.Box3().setFromObject(model.branches[0].pivot).getSize(new THREE.Vector3()) : new THREE.Vector3();
      assert.ok(extent(before).distanceTo(extent(after)) < 1e-6, `ginkgo seed ${seed}: discontinuous shoot emergence at ${age}`);
      finiteGeometry(after);
    } finally { before.dispose(); after.dispose(); }
  }
});

function stemLeaves(age, seed) {
  const model = buildPlant('ginkgo', { age, day: 180, seed, density: 1 }), nodes = new Map();
  model.group.updateMatrixWorld(true);
  try {
    model.group.traverse(object => {
      if (!object.isInstancedMesh || !object.userData.nodeIds) return;
      const stalk = object.parent.children.find(child => child.isInstancedMesh && child !== object && !child.userData.connectedBy);
      assert.ok(stalk);
      for (let i = 0; i < object.count; i++) {
        const id = object.userData.nodeIds[i];
        if (!id.startsWith('stem-')) continue;
        const matrix = new THREE.Matrix4(); stalk.getMatrixAt(i, matrix);
        nodes.set(id, new THREE.Vector3(0, -.5, 0).applyMatrix4(matrix).applyMatrix4(stalk.matrixWorld));
      }
    });
    return nodes;
  } finally { model.dispose(); }
}

test('ginkgo establishment stem leaves and spur petioles retain their IDs and material bases as the crown expands', () => {
  for (const seed of seeds) {
    let previous = new Map();
    for (const age of [.1, .5, 1, 2, 3, 4, 4.9, 5.1, 8, 18, 45]) {
      const now = stemLeaves(age, seed);
      for (const [id, base] of previous) {
        assert.ok(now.has(id), `${id} disappeared at age ${age}`);
        assert.ok(base.distanceTo(now.get(id)) < 3e-6, `${id} material base migrated at age ${age}`);
      }
      previous = now;
    }
  }
});

test('woody shoot collars contact the rendered root junction at the requested continuity ages', () => {
  for (const species of ['ginkgo', 'osmanthus', 'camphor', 'acer']) for (const seed of seeds) for (const age of [0, .1, .5, 1, 18, 45]) {
    const build = treeSpecies.has(species) ? buildPlant : buildAdditionalPlant;
    const shoot = build(species, { age, day: 180, seed, density: 1 });
    try {
      const leader = shoot.branches.find(branch => branch.order === 0);
      if (age === 0) { assert.equal(leader, undefined, 'seed stage has no aerial wood'); continue; }
      assert.ok(leader, `${species}: missing leader`);
      const radiusScale = species === 'ginkgo' ? 1.35 : species === 'osmanthus' ? 1 : 1.4;
      const roots = buildRhizosphere(species, { age, day: 180, seed, density: 1, soilDepth: .05, cutaway: true,
        shootCollar: { position: leader.pivot.position.toArray(), radius: leader.radius * radiusScale } });
      try {
        const junction = roots.group.getObjectByName('root-shoot-junction');
        assert.ok(junction, `${species}: missing root collar junction`);
        const box = new THREE.Box3().setFromObject(junction);
        assert.ok(box.min.y <= leader.pivot.position.y + 1e-7 && box.max.y >= leader.pivot.position.y - 1e-7,
          `${species}: root collar does not reach shoot plane`);
      } finally { roots.dispose(); }
    } finally { shoot.dispose(); }
  }
});
