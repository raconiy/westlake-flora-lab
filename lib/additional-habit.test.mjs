import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildAdditionalPlant } from './additional-species.ts';

// Geometry regression envelopes, not measured botanical ratios. Habit evidence
// and missing whole-tree reference photographs are documented beside the code.
// Read rendered tubes/instances, not descriptive habit tags or model.height:
// Three's transformed aggregate AABBs conservatively overestimate crown height.
const defaults = { age: 45, day: 180, seed: 42, density: 1 };
const build = (species, overrides = {}) => buildAdditionalPlant(species, { ...defaults, ...overrides });
const orderOf = id => id.includes(':terminal:') ? 4 : id.includes(':twig:') ? 3 : id.includes(':secondary:') ? 2 : 1;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const spread = values => Math.max(...values) - Math.min(...values);
const distanceToLine = (point, line) => Math.min(...line.slice(1).map((end, i) =>
  point.distanceTo(new THREE.Line3(line[i], end).closestPointToPoint(point, true, new THREE.Vector3()))));

function inspect(model, scanBlades = false) {
  model.group.updateMatrixWorld(true);
  const axes = new Map(), foliage = [], matrix = new THREE.Matrix4();
  const tops = { main: -Infinity, terminal: -Infinity, foliage: -Infinity, support: -Infinity };
  model.group.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    let offset = 0;
    for (const axis of object.userData.axes || []) {
      const order = orderOf(axis.id), [segments, sides] = order >= 3 ? [5, 4] : order === 2 ? [8, 5] : [14, 7];
      const line = [], radii = [];
      for (let ring = 0; ring <= segments; ring++) {
        const points = Array.from({ length: sides }, (_, side) => new THREE.Vector3().fromBufferAttribute(positions,
          offset + Math.min(ring, segments - 1) * sides * 6 + side * 6 + (ring === segments ? 1 : 0)).applyMatrix4(object.matrixWorld));
        const centre = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(sides);
        line.push(centre); radii.push(mean(points.map(point => point.distanceTo(centre))));
      }
      const count = segments * sides * 6;
      if (order < 4) for (let i = offset; i < offset + count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        tops.support = Math.max(tops.support, point.y);
      }
      const delta = line.at(-1).clone().sub(line[0]);
      axes.set(axis.id, { ...axis, order, line, radii, delta, slope: delta.y / Math.hypot(delta.x, delta.z) });
      offset += count;
    }
    if (object.userData.axes) assert.equal(offset, positions.count, 'every rendered tube is audited');
    if (!object.isInstancedMesh || object.userData.connectedBy !== 'petiole') return;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix); matrix.premultiply(object.matrixWorld);
      foliage.push(new THREE.Vector3().setFromMatrixPosition(matrix));
      if (!scanBlades) continue;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
        tops.foliage = Math.max(tops.foliage, point.y);
        if (object.userData.cohort === 'main-axis') tops.main = Math.max(tops.main, point.y);
        if (object.userData.nodes[i].id.includes(':terminal:')) tops.terminal = Math.max(tops.terminal, point.y);
      }
    }
  });
  return { axes, foliage, tops };
}

test('crowns occupy three dimensions with irregular inclination at each branch order', () => {
  for (const species of ['camphor', 'acer']) for (const seed of [1, 42, 73]) {
    const model = build(species, { seed });
    try {
      const { axes, foliage } = inspect(model);
      const centre = foliage.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(foliage.length);
      const xx = mean(foliage.map(p => (p.x - centre.x) ** 2)), zz = mean(foliage.map(p => (p.z - centre.z) ** 2));
      const xz = mean(foliage.map(p => (p.x - centre.x) * (p.z - centre.z)));
      const discriminant = Math.hypot(xx - zz, 2 * xz);
      assert.ok((xx + zz - discriminant) / (xx + zz + discriminant) > .25, 'horizontal covariance has no collapsed dimension');
      const occupied = new Set(foliage.map(p => Math.floor((Math.atan2(p.z - centre.z, p.x - centre.x) + Math.PI) / (Math.PI / 4)) % 8));
      assert.equal(occupied.size, 8, 'foliage occupies every azimuth octant');
      for (let order = 1; order <= (species === 'camphor' ? 4 : 3); order++) {
        const slopes = [...axes.values()].filter(axis => axis.order === order).map(axis => axis.slope);
        assert.ok(spread(slopes) > .35, `${species} order ${order}: no repeated inclination cone`);
      }
      // Same daughter index on different scaffolds must not repeat one heading.
      const headings = [...axes.values()].filter(axis => axis.id.endsWith(':secondary:0'))
        .map(axis => Math.atan2(axis.delta.z, axis.delta.x));
      assert.ok(spread(headings) > Math.PI, 'daughter headings vary across scaffolds');
    } finally { model.dispose(); }
  }
});

test('actual wood has connected curved, tapering axes, stable across age, season and density', () => {
  for (const species of ['camphor', 'acer']) {
    const young = build(species, { age: 80 }), old = build(species, { age: 120, day: 15, density: 2 });
    try {
      const a = inspect(young), b = inspect(old);
      assert.equal(a.axes.size, species === 'camphor' ? 3610 : 432, 'every existing wood order, including all terminals, retained');
      assert.deepEqual([...a.axes.keys()], [...b.axes.keys()], 'all axis identities retained');
      for (const [id, axis] of a.axes) {
        const next = b.axes.get(id), chord = new THREE.Line3(axis.line[0], axis.line.at(-1));
        const bend = Math.max(...axis.line.map(p => p.distanceTo(chord.closestPointToPoint(p, true, new THREE.Vector3()))));
        assert.ok(bend > axis.length * .015, `${id}: real curvature, not a straight cylinder`);
        const fromBase = index => axis.line[index].clone().sub(axis.line[0]);
        const last = axis.line.length - 1;
        const volume = Math.abs(fromBase(Math.round(last / 3)).cross(fromBase(Math.round(last * 2 / 3))).dot(fromBase(last))) / axis.length ** 3;
        assert.ok(volume > .00001, `${id}: centreline turns out of a single plane`);
        assert.ok(axis.radii.at(-1) < axis.radii[0] * .35, `${id}: physical tip taper`);
        for (let i = 1; i < axis.radii.length; i++) assert.ok(axis.radii[i] <= axis.radii[i - 1] + 3e-6);
        assert.equal(axis.length, next.length, 'mature axis never shrinks');
        assert.ok(next.radius >= axis.radius, 'wood never thins with age');
        axis.line.forEach((p, i) => assert.ok(p.distanceTo(next.line[i]) < 3e-6, `${id}: no reroll or node motion`));
        if (axis.parentId !== 'leader') assert.ok(distanceToLine(axis.line[0], a.axes.get(axis.parentId).line) < .03,
          `${id}: starts on rendered parent wood`);
      }
    } finally { young.dispose(); old.dispose(); }
  }
});

test('maple daughter sprays stay layered while camphor fills a broader, deeper crown', () => {
  for (const seed of [1, 42, 73]) {
    const camphor = build('camphor', { seed }), maple = build('acer', { seed });
    try {
      const c = inspect(camphor), m = inspect(maple);
      const children = snapshot => [...snapshot.axes.values()].filter(axis => axis.order === 2 || axis.order === 3);
      const mapleRise = children(m).map(axis => Math.abs(axis.delta.y) / axis.length);
      const camphorRise = children(c).map(axis => Math.abs(axis.delta.y) / axis.length);
      assert.ok(Math.max(...mapleRise) < .50, 'maple daughters do not stack into upright cones');
      assert.ok(mean(camphorRise) > mean(mapleRise) * 1.5, 'camphor daughter axes fill greater vertical depth');
      const size = snapshot => new THREE.Box3().setFromPoints(snapshot.foliage).getSize(new THREE.Vector3());
      const cs = size(c), ms = size(m);
      assert.ok(cs.x > ms.x * 1.5 && cs.z > ms.z * 1.5, 'camphor spans broadly in both horizontal dimensions');
      assert.ok(cs.x > camphor.branches[0].length * .45 && cs.z > camphor.branches[0].length * .45);
    } finally { camphor.dispose(); maple.dispose(); }
  }
});

test('actual apical blades and camphor terminal shoots do not form an excessively tall upper crown', () => {
  // Explicit review envelope: apical blades <= 12 cm over the leader, whole
  // foliage <= 16% over its height, terminal blades <= 3% over existing wood.
  // These are engineering checks, not dimensions inferred from reference photos.
  for (const species of ['camphor', 'acer']) for (const seed of [1, 42, 73]) for (const age of [8, 18, 45, 120]) {
    const model = build(species, { seed, age });
    try {
      const { tops } = inspect(model, true), leader = model.branches[0].length;
      assert.ok(tops.main > leader * .90, 'apical cohorts still cover the advancing upper leader');
      assert.ok(tops.main <= leader + .12, 'no oversized apical crown');
      assert.ok(tops.foliage <= leader * 1.16 + .12, `${species} seed ${seed} age ${age}: bounded actual crown top`);
      if (species === 'camphor') assert.ok(tops.terminal <= tops.support + leader * .03 + .12,
        'terminal additions remain close to the existing support crown');
    } finally { model.dispose(); }
  }
});
