import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { assertOsmanthusWoodSupport, createOsmanthusAxis } from './osmanthus-axis.ts';

// NCSU: https://plants.ces.ncsu.edu/plants/osmanthus-fragrans/
// Existing project source: public/references/species-evidence.json.
// It supports evergreen woody habit, opposite petiolate leaves and axillary
// flowers. Ages, persistence/no-death contract, density, dimensions and the
// 0.3 micrometre Float32 tolerance below are ENGINEERING PRIORS, not Hangzhou
// observations. Exact age .1 has zero expanded leaves by the expansion clock.
const ages = [.1, .5, 1, 2, 5, 10, 20], EPS = 3e-7;
const build = (age, overrides = {}) => buildPlant('osmanthus', { age, seed: 42, density: 1, day: 280, ...overrides });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const vector = a => new THREE.Vector3(...a);
// Pins all seven full-mesh/instance snapshots, not just organ counts. Refresh
// only after reviewing an intentional geometry change and its support audit.
const expectedSnapshots = new Map([
  ['42/1', 'fa33b07c4e650bbde026c51bb7396028c49babe45977b91d097aea0f7f4a01bd'],
  ['73/1.8', '419911ab53aee78f2c9b7dba77571a249950ce813af3a9e73f0a362c5c16e657'],
]);

// Independent extraction from actual Float32 vertices and instance matrices;
// do not ask the generator's curve.point/frame to certify its own geometry.
function snapshot(model) {
  model.group.updateMatrixWorld(true);
  const rows = [], hash = createHash('sha256');
  let pairs = 0, peduncles = 0, maxProjectionM = 0;
  const byPivot = new Map(model.branches.map(b => [b.pivot, b]));
  for (const branch of model.branches) {
    const pivot = branch.pivot, { axisId: id, birth } = pivot.userData;
    assert.equal(model.group.getObjectById(pivot.id), pivot, `live axis ${id}`);
    if (branch.order) assert.equal(byPivot.get(pivot.parent)?.pivot.userData.axisId, pivot.userData.supportAxisId);
    const wood = pivot.children.find(o => o.name === 'osmanthus-wood-axis');
    assert.ok(wood, `actual wood retained for ${id}`);
    const g = wood.geometry, spec = g.userData.osmanthusAxis, sides = g.userData.woodTube.sides;
    assert.equal(spec.id, id); assert.equal(spec.axialParameterM, branch.length);
    assert.equal(spec.basalRadiusM, branch.radius);
    assert.ok(g.index.count > 0 && branch.length > 0 && branch.radius > 0);
    assert.ok(g.attributes.position.array.every(Number.isFinite));
    const centers = spec.materialSectionsM.map((s, ring) => {
      const points = Array.from({ length: sides }, (_, j) => new THREE.Vector3().fromBufferAttribute(g.attributes.position, ring * (sides + 1) + j));
      const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(sides);
      const area = points.reduce((sum, p, i) => sum.add(p.clone().sub(center).cross(points[(i + 1) % sides].clone().sub(center))), new THREE.Vector3()).length() / 2;
      assert.ok(area > 0, `positive actual section ${id}/${s}`);
      return center.applyMatrix4(wood.matrixWorld);
    });
    const station = new Map(spec.materialSectionsM.map((s, i) => [s, i]));
    const leaves = pivot.children.find(o => o.userData.connectedBy === 'petiole');
    const nodes = leaves?.userData.nodes ?? [], stalks = pivot.children.find(o => o.userData.role === 'petiole');
    if (leaves) {
      assert.equal(leaves.userData.axisId, id); assert.equal(stalks.userData.axisId, id);
      assert.equal(leaves.count, nodes.length * 2); assert.equal(stalks.count, leaves.count);
    }
    const m = new THREE.Matrix4();
    const checkBase = (mesh, instance, node) => {
      assert.ok(node.materialS >= 0 && node.materialS <= branch.length, `node lies inside live axis ${id}`);
      const ring = station.get(node.materialS); assert.notEqual(ring, undefined, `real nodal section ${id}`);
      mesh.getMatrixAt(instance, m);
      const start = new THREE.Vector3(0, -.5, 0).applyMatrix4(m).applyMatrix4(mesh.matrixWorld);
      const expected = vector(node.attachment).applyMatrix4(pivot.matrixWorld);
      const projectionM = Math.min(...centers.slice(1).map((p, i) => new THREE.Line3(centers[i], p).closestPointToPoint(start, true, new THREE.Vector3()).distanceTo(start)));
      maxProjectionM = Math.max(maxProjectionM, projectionM);
      assert.ok(start.distanceTo(expected) < EPS && start.distanceTo(centers[ring]) < EPS && projectionM < EPS,
        `no floating stalk base: ${id}/${node.index}/${instance}`);
    };
    for (const [i, node] of nodes.entries()) {
      assert.ok(node.birth < model.group.userData.lifecycle.age);
      for (const side of [0, 1]) checkBase(stalks, i * 2 + side, node);
      pairs++;
    }
    const flowers = pivot.children.find(o => o.userData.role === 'corolla-lobes');
    if (flowers) {
      const stalks = pivot.children.find(o => o.userData.role === 'axillary-peduncle');
      assert.equal(flowers.userData.axisId, id); assert.equal(stalks.userData.axisId, id);
      assert.equal(stalks.count, flowers.userData.sites.length);
      for (const [i, site] of flowers.userData.sites.entries()) {
        const node = nodes.find(n => n.index === site.node); assert.ok(node);
        assert.deepEqual(site.attachment, node.attachment); checkBase(stalks, i, node); peduncles++;
      }
    }
    const row = { id, birth, length: branch.length, radius: branch.radius,
      target: spec.targetM, rest: branch.rest.toArray(),
      // Exclude only the documented rigid collar rise during seed loss.
      origin: pivot.getWorldPosition(new THREE.Vector3()).sub(new THREE.Vector3(0, model.group.userData.lifecycle.collarY, 0)).toArray(),
      nodes: nodes.map(n => [n.index, n.birth, n.materialS, n.attachment]) };
    rows.push(row); hash.update(JSON.stringify(row));
    hash.update(new Uint8Array(g.attributes.position.array.buffer)); hash.update(new Uint8Array(g.index.array.buffer));
    for (const mesh of pivot.children.filter(o => o.isInstancedMesh)) {
      hash.update(mesh.userData.role ?? mesh.userData.connectedBy ?? '');
      hash.update(new Uint8Array(mesh.instanceMatrix.array.buffer));
    }
  }
  assert.equal(pairs * 2, model.leafCount);
  return { age: model.group.userData.lifecycle.age, rows, summary: {
    age: model.group.userData.lifecycle.age, axes: rows.length, leaves: pairs * 2, peduncles,
    geometrySHA256: hash.digest('hex'), maxProjectionM,
  } };
}

function assertProgress(previous, current) {
  const next = new Map(current.rows.map(row => [row.id, row]));
  for (const old of previous.rows) {
    const now = next.get(old.id); assert.ok(now, `age cannot delete axis ${old.id}`);
    assert.equal(now.birth, old.birth, `axis birth is permanent: ${old.id}`);
    assert.equal(now.target, old.target); assert.deepEqual(now.rest, old.rest);
    assert.ok(now.length >= old.length, `length cannot shrink: ${old.id}`);
    assert.ok(now.radius >= old.radius, `radius cannot shrink: ${old.id}`);
    assert.ok(vector(now.origin).distanceTo(vector(old.origin)) < 1e-10);
    const nodes = new Map(now.nodes.map(n => [n[0], n]));
    for (const node of old.nodes) assert.deepEqual(nodes.get(node[0]), node, `leaf node and parent survive: ${old.id}/${node[0]}`);
    next.delete(old.id);
  }
  for (const row of next.values()) assert.ok(row.birth >= previous.age && row.birth < current.age, `new axis requires scheduled birth: ${row.id}`);
}

test('seven-age full geometry snapshots retain every axis/node and project every leaf/flower stalk to actual wood', t => {
  for (const [seed, density] of [[42, 1], [73, 1.8]]) {
    let previous;
    const summaries = [];
    for (const age of ages) {
      const model = build(age, { seed, density });
      try {
        const now = snapshot(model);
        if (previous) assertProgress(previous, now);
        summaries.push(now.summary); previous = now;
        // Rigid hierarchy animation must preserve contact with actual wood.
        model.update(7, 8, 9.81, 1); snapshot(model);
      } finally { model.dispose(); }
    }
    const snapshotSHA256 = digest(summaries.map(({ maxProjectionM, ...s }) => s));
    assert.equal(snapshotSHA256, expectedSnapshots.get(`${seed}/${density}`), 'reviewed full geometry snapshots');
    t.diagnostic(JSON.stringify({ seed, density, snapshots: summaries, snapshotSHA256 }));
  }
});

test('regression oracle rejects missing/shortened lower axes while their leaf records survive', () => {
  const a = build(.5), b = build(5);
  try {
    const before = snapshot(a), after = snapshot(b);
    const broken = change => { const copy = structuredClone(after); change(copy.rows); return copy; };
    assert.throws(() => assertProgress(before, broken(rows => rows.splice(0, 1))), /cannot delete axis/);
    assert.throws(() => assertProgress(before, broken(rows => { rows[0].length = before.rows[0].length / 2; })), /length cannot shrink/);
    assert.throws(() => assertProgress(before, broken(rows => { rows[0].radius = before.rows[0].radius / 2; })), /radius cannot shrink/);
    assert.throws(() => assertProgress(before, broken(rows => { rows[0].birth = .4; })), /birth is permanent/);
    assert.throws(() => assertProgress(before, broken(rows => { rows[1].birth = .1; })), /requires scheduled birth/);
    const wood = b.branches[0].pivot.children.find(o => o.name === 'osmanthus-wood-axis');
    wood.removeFromParent();
    try { assert.throws(() => snapshot(b), /actual wood retained/); }
    finally { b.branches[0].pivot.add(wood); }
  } finally { a.dispose(); b.dispose(); }
});

test('runtime support guard rejects catalogue-only, retracted, zero-area and disconnected sections', () => {
  const curve = createOsmanthusAxis(42, 'guard', 1, 1, [.4]);
  const node = { materialS: .4, attachment: curve.point(.4).toArray() };
  for (const [length, radius] of [[.3, .01], [.8, 0], [0, .01]]) {
    const g = curve.geometry(length, radius);
    try { assert.throws(() => assertOsmanthusWoodSupport(g, [node]), /parent wood/); }
    finally { g.dispose(); }
  }
  const g = curve.geometry(.8, .01);
  try {
    assertOsmanthusWoodSupport(g, [node]);
    assert.throws(() => assertOsmanthusWoodSupport(g, [{ ...node, attachment: [0, .4, 1] }]), /positive woody section/);
    assert.throws(() => assertOsmanthusWoodSupport(g, [{ ...node, attachment: [NaN, .4, 0] }]), /positive woody section/);
    g.setIndex([]);
    assert.throws(() => assertOsmanthusWoodSupport(g, [node]), /actual parent wood/);
  } finally { g.dispose(); }
});
