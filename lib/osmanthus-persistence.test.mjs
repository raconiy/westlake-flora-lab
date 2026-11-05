import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';

const build = (age, overrides = {}) => buildPlant('osmanthus', { age, day: 180, seed: 42, density: 1, ...overrides });
const vector = a => new THREE.Vector3(...a);
const blades = axis => axis.children.find(o => o.isInstancedMesh && o.userData.connectedBy === 'petiole');
const axes = model => new Map(model.branches.map(b => [b.pivot.userData.axisId, b]));

function snapshot(model) {
  model.group.updateMatrixWorld(true);
  return new Map(model.branches.map(b => [b.pivot.userData.axisId, {
    length: b.length, radius: b.radius, position: b.pivot.position.toArray(), rest: b.rest.toArray(),
    origin: b.pivot.getWorldPosition(new THREE.Vector3()),
    nodes: new Map((blades(b.pivot)?.userData.nodes ?? []).map(n => [n.index, {
      birth: n.birth, attachment: n.attachment,
      world: vector(n.attachment).applyMatrix4(b.pivot.matrixWorld),
    }])),
  }]));
}

test('osmanthus starts as a seed and keeps the two-node, four-leaf half-year seedling', () => {
  const zero = build(0, { day: 280 }), early = build(.5);
  try {
    assert.equal(zero.branches.length, 0);
    assert.equal(zero.leafCount, 0);
    assert.equal(zero.group.children.length, 1);
    assert.equal(zero.group.children[0].userData.organ, 'seed');
    assert.equal(early.branches.length, 1);
    assert.equal(early.leafCount, 4);
    assert.equal(blades(early.branches[0].pivot).userData.nodes.length, 2);
    assert.match(early.group.userData.priors.calibration, /uncalibrated/);
    assert.match(early.group.userData.architecture.leafTurnover, /not a physiology solver/);
  } finally { zero.dispose(); early.dispose(); }
});

test('nodes and woody supports stay fixed at ages 2, 8, 12 and 40 without branch retirement', () => {
  let previous;
  for (const age of [2, 8, 12, 40]) {
    const model = build(age);
    try {
      const current = snapshot(model);
      if (previous) {
        assert.ok(current.size > previous.size, `new distal branches by age ${age}`);
        for (const [id, old] of previous) {
          const now = current.get(id);
          assert.ok(now, `wood retained: ${id} at ${age}`);
          assert.ok(now.length >= old.length && now.radius >= old.radius, 'wood extends/thickens without shrinking');
          assert.deepEqual(now.position, old.position, 'fixed local branch support');
          assert.deepEqual(now.rest, old.rest, 'rest orientation does not drift with age');
          assert.ok(now.origin.distanceTo(old.origin) < 1e-10, 'fixed rest-world branch support');
          for (const [index, node] of old.nodes) {
            const next = now.nodes.get(index);
            assert.ok(next, `persistent leaf-node coordinate ${id}/${index}`);
            assert.equal(next.birth, node.birth);
            assert.deepEqual(next.attachment, node.attachment);
            assert.ok(next.world.distanceTo(node.world) < 1e-10, 'ancestor extension does not translate established nodes');
          }
        }
      }
      previous = current;
    } finally { model.dispose(); }
  }
});

test('birth coordinates sample the historical supporting axis just behind its growing apex', () => {
  const adult = build(40);
  try {
    const all = axes(adult);
    const samples = [
      ...[1, 8, 12].map(i => ['leader', i]),
      ...[1, 5, 10].map(i => ['leader/1:0', i]),
      ...[1, 6].map(i => ['leader/1:0/1:0', i]),
      ['leader/1:0/1:0/1:0', 3],
    ];
    for (const [id, index] of samples) {
      const node = blades(all.get(id).pivot).userData.nodes.find(n => n.index === index);
      const historical = build(node.birth);
      try {
        const parentAtBirth = axes(historical).get(id);
        assert.ok(parentAtBirth, 'support axis exists before its node');
        assert.ok(Math.abs(parentAtBirth.length - node.lengthAtBirth) < 1e-12);
        assert.ok(node.attachment[1] > .9 * parentAtBirth.length && node.attachment[1] < parentAtBirth.length,
          'node is born behind the actual apex, not near the axis base or beyond the tip');
      } finally { historical.dispose(); }
    }
  } finally { adult.dispose(); }
});

test('every lateral attaches to its actual opposite leaf node, including sparse and dense crowns under load', () => {
  for (const density of [.15, 1, 2]) {
    const model = build(40, { density, day: 280 });
    try {
      model.update(9, 8, 9.81, 1);
      model.group.updateMatrixWorld(true);
      for (const b of model.branches.filter(b => b.order > 0)) {
        const axis = b.pivot, support = axis.userData.supportNode, parentLeaves = blades(axis.parent);
        assert.equal(axis.userData.supportAxisId, axis.parent.userData.axisId);
        const i = parentLeaves.userData.nodes.findIndex(n => n.index === support.index);
        assert.ok(i >= 0, 'supporting node actually has leaves');
        assert.deepEqual(parentLeaves.userData.nodes[i].attachment, support.attachment);
        assert.deepEqual(axis.position.toArray(), support.attachment);
        assert.ok(axis.userData.birth >= support.birth + .2, 'support internode/leaf pair matures before branching');
        const stalks = axis.parent.children.find(o => o.userData.role === 'petiole');
        for (const side of [0, 1]) {
          const m = new THREE.Matrix4(); stalks.getMatrixAt(i * 2 + side, m);
          const start = new THREE.Vector3(0, -.5, 0).applyMatrix4(m).applyMatrix4(stalks.matrixWorld);
          assert.ok(start.distanceTo(axis.getWorldPosition(new THREE.Vector3())) < 2e-6,
            'both actual petiole bases and the child branch share one support under wind/gravity');
        }
      }
    } finally { model.dispose(); }
  }
});

test('later distal cohorts keep foliage and new branches up the advancing leader', () => {
  let lastSupport = 0;
  for (const age of [2, 8, 12, 40]) {
    const model = build(age);
    try {
      const leader = model.branches[0], nodes = blades(leader.pivot).userData.nodes;
      const newest = nodes.at(-1);
      assert.ok(newest.attachment[1] > .8 * leader.length, `foliated leader at ${age}`);
      for (let i = 1; i < nodes.length; i++) {
        assert.ok(nodes[i].birth > nodes[i - 1].birth);
        assert.ok(nodes[i].attachment[1] > nodes[i - 1].attachment[1], 'new nodes advance distally');
      }
      const primary = model.branches.filter(b => b.order === 1);
      const support = Math.max(...primary.map(b => b.pivot.position.y));
      assert.ok(support > lastSupport, `new upper branch tier by ${age}`);
      lastSupport = support;
      if (age === 40) {
        assert.ok(support > .8 * leader.length, 'adult branches establish high on the leader');
        assert.ok(primary.some(b => b.pivot.userData.birth > 25), 'bounded onset plan includes mature-age branches');
      }
    } finally { model.dispose(); }
  }
});

test('finite cohorts bound foliage and retain a broad evergreen adult crown', () => {
  for (const density of [.15, 1, 2]) {
    let previousLeaves = 0, previousAxes = 0;
    for (const age of [2, 8, 12, 40, 120, 200]) {
      const model = build(age, { density });
      try {
        const budget = model.group.userData.architecture;
        assert.ok(model.leafCount <= budget.maxLeafBudget);
        assert.ok(model.branches.length <= budget.maxAxisBudget);
        assert.ok(model.leafCount >= previousLeaves && model.branches.length >= previousAxes);
        for (const b of model.branches) assert.ok(Number.isFinite(b.length) && Number.isFinite(b.radius));
        previousLeaves = model.leafCount; previousAxes = model.branches.length;
      } finally { model.dispose(); }
    }
  }
  for (const seed of [42, 73]) {
    const summer = build(40, { seed }), winter = build(40, { seed, day: 15 });
    try {
      assert.equal(summer.leafCount, winter.leafCount);
      assert.ok(summer.leafCount > 1000);
      const box = new THREE.Box3(), m = new THREE.Matrix4();
      summer.group.updateMatrixWorld(true);
      summer.group.traverse(o => {
        if (!o.isInstancedMesh || o.userData.connectedBy !== 'petiole') return;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          box.expandByPoint(new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(o.matrixWorld));
        }
      });
      const size = box.getSize(new THREE.Vector3()), leader = summer.branches[0].length;
      assert.ok(size.x > .65 * leader && size.z > .65 * leader, 'broad crown occupies both horizontal directions');
      assert.ok(box.max.y > .9 * leader && box.min.y < .3 * leader, 'evergreen foliage occupies a deep crown');
    } finally { summer.dispose(); winter.dispose(); }
  }
});

test('mature cohort births remain continuous and independent of season or animation time', () => {
  for (const age of [1.8, 3.2, 4.8, 7, 10, 14, 19, 25, 33, 44, 60, 60.45]) {
    const a = build(age - 1e-5), b = build(age + 1e-5);
    try {
      const ba = new THREE.Box3().setFromObject(a.group), bb = new THREE.Box3().setFromObject(b.group);
      assert.ok(ba.min.distanceTo(bb.min) < .0003 && ba.max.distanceTo(bb.max) < .0003, `continuous bounds at ${age}`);
    } finally { a.dispose(); b.dispose(); }
  }
  const spring = build(12, { day: 120 }), autumn = build(12, { day: 280 });
  try {
    const initial = snapshot(spring);
    assert.deepEqual(snapshot(autumn), initial, 'season does not advance the architecture clock');
    spring.update(10000, 7, 9.81, 1); spring.update(0, 0, 0, 1);
    assert.deepEqual(snapshot(spring), initial, 'animation time does not age nodes or supports');
  } finally { spring.dispose(); autumn.dispose(); }
});
