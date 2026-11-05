import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { createBeamDynamics } from './beam-dynamics.ts';

// Regression thresholds below are engineering acceptance criteria, not fitted
// ages/angles/LAI for a campus plant. Private NCSU photographs motivate a dense,
// rounded evergreen habit; they are neither test assets nor redistributed here.
const build = (age, overrides = {}) => buildPlant('osmanthus', { age, day: 180, seed: 42, density: 1, ...overrides });
const up = new THREE.Vector3(0, 1, 0);
const blades = pivot => pivot.children.find(o => o.isInstancedMesh && o.userData.connectedBy === 'petiole');
const azimuthBin = v => Math.floor(((Math.atan2(v.z, v.x) + 2 * Math.PI) % (2 * Math.PI)) * 12 / (2 * Math.PI));

function foliage(model) {
  model.group.updateMatrixWorld(true);
  const points = [], local = new THREE.Matrix4(), world = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  model.group.traverse(o => {
    if (!o.isInstancedMesh || o.userData.connectedBy !== 'petiole') return;
    const pos = o.geometry.getAttribute('position'), idx = o.geometry.index;
    // Independently integrate the actual transformed triangles, so diagnostic
    // metadata cannot make this test pass by reporting an invented leaf area.
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, local); world.multiplyMatrices(o.matrixWorld, local);
      points.push(new THREE.Vector3().setFromMatrixPosition(world));
      for (let t = 0; t < (idx ? idx.count : pos.count); t += 3) {
        a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(world);
        b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(world);
        c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(world);
        area += b.sub(a).cross(c.sub(a)).length() * .5;
      }
    }
  });
  const bounds = new THREE.Box3().setFromPoints(points), span = bounds.getSize(new THREE.Vector3());
  return { points, bounds, span, area, projection: Math.PI * span.x * span.z / 4 };
}

test('adult foliage fills a rounded 3D volume rather than two planar wings', () => {
  for (const seed of [1, 42, 73, 123]) {
    const model = build(40, { seed });
    try {
      const { points, bounds, span } = foliage(model), center = bounds.getCenter(new THREE.Vector3());
      const sectors = Array(12).fill(0), occupied = new Set();
      let xx = 0, zz = 0, xz = 0;
      for (const point of points) {
        const delta = point.clone().sub(center), normalized = delta.clone().divide(span).multiplyScalar(2);
        occupied.add(normalized.toArray().map(n => Math.min(6, Math.floor((n + 1) * 3.5))).join(','));
        sectors[azimuthBin(delta)]++;
        xx += delta.x ** 2; zz += delta.z ** 2; xz += delta.x * delta.z;
      }
      const trace = xx + zz, gap = Math.hypot(xx - zz, 2 * xz);
      assert.ok((trace - gap) / (trace + gap) > .45, 'horizontal covariance has two substantial principal axes');
      assert.ok(Math.min(...sectors) / points.length > .02, 'every 30-degree sector has real connected foliage');
      assert.ok(Math.min(span.x, span.z) / Math.max(span.x, span.z) > .8, 'broad crown in both horizontal directions');
      assert.ok(Math.min(span.x, span.z) / span.y > .75, 'rounded deep crown instead of a tall ladder');
      let eligible = 0, filled = 0;
      for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) for (let z = 0; z < 7; z++) {
        if ([x, y, z].reduce((sum, i) => sum + ((i + .5) / 3.5 - 1) ** 2, 0) > .85 ** 2) continue;
        eligible++; if (occupied.has([x, y, z].join(','))) filled++;
      }
      assert.ok(filled / eligible > .8, 'foliage occupies the interior ellipsoid, not just remote tips or a thin shell');
    } finally { model.dispose(); }
  }
});

test('adult density comes from bounded leaf area on fine shoots without enlarged blades', () => {
  for (const seed of [42, 73]) for (const age of [18, 40, 120]) {
    const model = build(age, { seed });
    try {
      const actual = foliage(model), metric = model.group.userData.canopyMetrics;
      assert.ok(Math.abs(actual.area - metric.oneSidedLeafAreaM2) < 1e-7);
      assert.ok(Math.abs(actual.projection - metric.projectedCrownAreaM2) < 1e-10);
      assert.ok(actual.area / actual.projection >= 2 && actual.area / actual.projection <= 6,
        'one-sided mesh area / bounding ellipse has an explicit engineering density range');
      if (age === 40) { assert.ok(actual.area > 55); assert.ok(model.leafCount > 19000); }
      assert.match(metric.calibration, /not measured stand LAI/);
      const geometry = blades(model.branches[0].pivot).geometry;
      geometry.computeBoundingBox();
      const size = geometry.boundingBox.getSize(new THREE.Vector3());
      assert.ok(size.y > .11 && size.y < .12 && size.x > .035 && size.x < .04, 'existing centimetre-scale blade retained');
      for (const branch of model.branches) {
        const leaves = blades(branch.pivot), m = new THREE.Matrix4(), scale = new THREE.Vector3();
        if (!leaves) continue;
        for (let i = 0; i < leaves.count; i++) {
          leaves.getMatrixAt(i, m); scale.setFromMatrixScale(m);
          assert.ok(Math.max(scale.x, scale.y, scale.z) <= 1 + 1e-7, 'no oversized leaf instances');
        }
      }
    } finally { model.dispose(); }
  }
  for (const density of [.15, 1, 2]) {
    const model = build(200, { density });
    try {
      assert.ok(model.leafCount <= 28704 && model.leafCount <= model.group.userData.architecture.maxLeafBudget);
      assert.ok(model.branches.length <= 869);
    } finally { model.dispose(); }
  }
});

test('opposite axils have unequal scaffold angles, azimuths, vigour and extension clocks', () => {
  for (const seed of [1, 42, 73, 123]) {
    const model = build(40, { seed });
    try {
      const primary = model.branches.filter(b => b.order === 1);
      const directions = primary.map(b => up.clone().applyQuaternion(b.rest));
      const inclinations = directions.map(d => Math.acos(d.y));
      assert.ok(Math.max(...inclinations) - Math.min(...inclinations) > .55, 'scaffold inclinations span over 31 degrees');
      assert.ok(new Set(directions.map(azimuthBin)).size >= 9, 'scaffolds occupy at least nine azimuth sectors');
      const pairs = new Map();
      for (const b of primary) {
        const pair = pairs.get(b.pivot.userData.node) ?? []; pair.push(b); pairs.set(b.pivot.userData.node, pair);
      }
      let pairsCount = 0, unequalLengths = 0, unequalAngles = 0, unequalBirths = 0;
      for (const pair of pairs.values()) {
        if (pair.length !== 2) continue;
        pairsCount++;
        const [a, b] = pair;
        if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > .1) unequalLengths++;
        if (Math.abs(Math.acos(up.clone().applyQuaternion(a.rest).y) - Math.acos(up.clone().applyQuaternion(b.rest).y)) > .1) unequalAngles++;
        if (Math.abs(a.pivot.userData.birth - b.pivot.userData.birth) > .03) unequalBirths++;
      }
      assert.ok(unequalLengths / pairsCount > .5, 'most opposite axils produce visibly different shoot lengths');
      assert.ok(unequalAngles / pairsCount > .5, 'most opposite axils have distinct scaffold angles');
      assert.ok(unequalBirths / pairsCount > .5, 'bud extension clocks are independent');
    } finally { model.dispose(); }
  }
});

test('denser crown preserves every established material node and woody attachment after seed loss', () => {
  let previous;
  // The existing germination/root-junction contract raises the collar by 7 mm
  // during seed-coat loss (.25–.9 y); do not mistake that for adult node drift.
  for (const age of [1, 2, 8, 18, 40, 120, 200]) {
    const model = build(age);
    try {
      model.group.updateMatrixWorld(true);
      const snapshot = new Map(model.branches.map(b => [b.pivot.userData.axisId, {
        length: b.length, radius: b.radius, origin: b.pivot.getWorldPosition(new THREE.Vector3()),
        position: b.pivot.position.toArray(), rest: b.rest.toArray(),
        nodes: new Map((blades(b.pivot)?.userData.nodes ?? []).map(n => [n.index, {
          birth: n.birth, attachment: n.attachment, world: new THREE.Vector3(...n.attachment).applyMatrix4(b.pivot.matrixWorld),
        }])),
      }]));
      if (previous) for (const [id, old] of previous) {
        const now = snapshot.get(id); assert.ok(now, `persistent wood ${id}`);
        assert.ok(now.length >= old.length && now.radius >= old.radius);
        assert.deepEqual(now.position, old.position); assert.deepEqual(now.rest, old.rest);
        assert.ok(now.origin.distanceTo(old.origin) < 1e-10);
        for (const [index, node] of old.nodes) {
          const next = now.nodes.get(index); assert.ok(next, `persistent leaf node ${id}/${index}`);
          assert.equal(next.birth, node.birth); assert.deepEqual(next.attachment, node.attachment);
          assert.ok(next.world.distanceTo(node.world) < 1e-10);
        }
      }
      previous = snapshot;
    } finally { model.dispose(); }
  }
});

test('loaded dense crown keeps shared node connections and animates without geometry rebuilds', () => {
  const model = build(40, { day: 280 }), resources = [];
  try {
    const metrics = JSON.stringify(model.group.userData.canopyMetrics), branchCount = model.branches.length;
    model.group.traverse(o => {
      if (!o.isMesh) return;
      resources.push({ object: o, parent: o.parent, geometry: o.geometry,
        positions: o.geometry.attributes.position.array, instances: o.isInstancedMesh ? o.instanceMatrix.array.slice() : null,
        instanceVersion: o.isInstancedMesh ? o.instanceMatrix.version : null });
    });
    const dynamics = createBeamDynamics(model);
    try {
      model.update(8, 10, 9.81, .8);
      dynamics.update(0, 10, 9.81, .8);
      for (let i = 1; i <= 24; i++) dynamics.update(i / 60, 10, 9.81, .8);
      model.group.updateMatrixWorld(true);
      for (const branch of model.branches.filter(b => b.order > 0)) {
        const axis = branch.pivot, support = axis.userData.supportNode;
        const leaves = blades(axis.parent), i = leaves.userData.nodes.findIndex(n => n.index === support.index);
        assert.ok(i >= 0); assert.deepEqual(axis.position.toArray(), support.attachment);
        const stalks = axis.parent.children.find(o => o.userData.role === 'petiole'), m = new THREE.Matrix4();
        for (const side of [0, 1]) {
          stalks.getMatrixAt(i * 2 + side, m);
          const start = new THREE.Vector3(0, -.5, 0).applyMatrix4(m).applyMatrix4(stalks.matrixWorld);
          assert.ok(start.distanceTo(axis.getWorldPosition(new THREE.Vector3())) < 2e-6);
        }
      }
      for (const { object, parent, geometry, positions, instances, instanceVersion } of resources) {
        assert.equal(object.parent, parent); assert.equal(object.geometry, geometry);
        assert.equal(geometry.attributes.position.array, positions);
        if (instances) { assert.deepEqual(object.instanceMatrix.array, instances); assert.equal(object.instanceMatrix.version, instanceVersion); }
      }
      assert.equal(model.branches.length, branchCount);
      assert.equal(JSON.stringify(model.group.userData.canopyMetrics), metrics, 'area metrics are computed at build time');
    } finally { dynamics.dispose(); }
  } finally { model.dispose(); }
});
