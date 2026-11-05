import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { buildAdditionalPlant } from './additional-species.ts';
import { buildRhizosphere } from './rhizosphere.ts';
import { ophiopogonRamet } from './development.ts';

const defaults = { seed: 42, moisture: .55, compaction: .2, cutaway: true };
const densities = [.3, 1, 1.8], ages = [0, .1, 1, 5], soilDepths = [.05, 1.5];
const supportRoles = ['rhizome-propagule', 'rhizome', 'stolon-propagule', 'stolon-internode'];
const close = (a, b, label) => assert.ok(a.distanceTo(b) < 5e-8, `${label}: ${a.distanceTo(b)} m`);
const meshes = model => model.group.children.filter(o => o.isMesh && o.userData.organ !== 'soil');

// Read the unique vertices of each actual tube ring; the seam vertex repeats.
// Neither endpoints nor radii below come from start/end/radius userData.
function tube(mesh) {
  const position = mesh.geometry.attributes.position;
  const sides = position.count === 225 ? 8 : 5;
  assert.ok(position.count === 225 || position.count === 78);
  const rings = [];
  for (let offset = 0; offset < position.count; offset += sides + 1) {
    const vertices = Array.from({ length: sides }, (_, j) => new THREE.Vector3().fromBufferAttribute(position, offset + j).applyMatrix4(mesh.matrixWorld));
    const center = vertices.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / sides);
    rings.push({ center, vertices, radius: Math.max(...vertices.map(p => p.distanceTo(center))) });
  }
  return { mesh, rings, start: rings[0].center, end: rings.at(-1).center };
}

function cylinderEnds(mesh) {
  const p = mesh.geometry.attributes.position, sides = mesh.geometry.parameters.radialSegments;
  const center = offset => Array.from({ length: sides }, (_, j) => new THREE.Vector3().fromBufferAttribute(p, offset + j).applyMatrix4(mesh.matrixWorld))
    .reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(1 / sides);
  return { start: center(sides + 1), end: center(0) };
}

// A child's start must lie within a parent's swept cross section, reconstructed
// from mesh rings. This detects detached axes even when metadata claims a join.
function contains(axis, point) {
  for (let i = 1; i < axis.rings.length; i++) {
    const a = axis.rings[i - 1], b = axis.rings[i];
    const line = new THREE.Line3(a.center, b.center);
    const t = line.closestPointToPointParameter(point, true);
    if (line.at(t, new THREE.Vector3()).distanceTo(point) <= a.radius * (1 - t) + b.radius * t + 5e-8) return true;
  }
  return false;
}

function insideRing(ring, point) {
  return ring.vertices.some((v, i) => new THREE.Triangle(ring.center, v, ring.vertices[(i + 1) % ring.vertices.length])
    .closestPointToPoint(point, new THREE.Vector3()).distanceTo(point) < 5e-8);
}

function assertConnected(axes, label) {
  if (!axes.length) return;
  const connected = [axes[0]], pending = axes.slice(1);
  while (pending.length) {
    const i = pending.findIndex(axis => connected.some(parent =>
      contains(parent, axis.start) || contains(parent, axis.end) || contains(axis, parent.start) || contains(axis, parent.end)));
    assert.ok(i >= 0, `${label}: ${pending.length} detached meshes; first ${pending[0].mesh.name} at ${pending[0].start.toArray()}`);
    connected.push(...pending.splice(i, 1));
  }
}

function assertContinuousTriangles(axis) {
  const g = axis.mesh.geometry, stride = axis.rings[0].vertices.length + 1;
  // Every successive ring is linked by actual indexed triangles.
  for (let r = 0; r < axis.rings.length - 1; r++) {
    const offset = r * (stride - 1) * 6;
    for (let j = 0; j < stride - 1; j++) {
      const ix = Array.from({ length: 6 }, (_, k) => g.index.getX(offset + j * 6 + k));
      assert.ok(ix.some(i => Math.floor(i / stride) === r));
      assert.ok(ix.some(i => Math.floor(i / stride) === r + 1));
    }
  }
}

function assertSoilBounds(axes, soilDepth, label) {
  for (const axis of axes) {
    const support = ['rhizome', 'stolon'].includes(axis.mesh.userData.organ);
    const p = axis.mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      assert.ok(v.toArray().every(Number.isFinite), label);
      assert.ok(v.y > -soilDepth, `${label}: below shallow boundary`);
      if (support) { assert.ok(v.y < .008, label); continue; }
      if (v.y >= 0) {
        // Explicit exception to the legacy all-vertices-negative assertion:
        // only the real surface attachment and its first few millimetres.
        assert.ok(axis.start.y <= .003 + 5e-8 && axis.start.y >= -.002, label);
        assert.ok(v.distanceTo(axis.start) <= .006 + axis.rings[0].radius + 1e-7, label);
        assert.ok(v.y <= axis.start.y + axis.rings[0].radius + 1e-7, label);
      }
      if (v.distanceTo(axis.start) > .006 + axis.rings[0].radius + 1e-7) assert.ok(v.y < 0, `${label}: bulk root above ground`);
    }
    assertContinuousTriangles(axis);
  }
}

test('Iris/Oxalis actual proximal and distal mesh rings preserve support-to-root connections across age, density and shallow soil', () => {
  for (const species of ['iris', 'oxalis']) for (const density of densities) for (const age of ages) for (const soilDepth of soilDepths) {
    const label = `${species} density=${density} age=${age} soil=${soilDepth}`;
    const plant = buildPlant(species, { age, density, day: 180, seed: defaults.seed });
    const roots = buildRhizosphere(species, { ...defaults, age, density, soilDepth });
    try {
      plant.group.updateMatrixWorld(true); roots.group.updateMatrixWorld(true);
      const expected = [];
      plant.group.traverse(o => {
        if (!o.isMesh || ![...supportRoles, 'adventitious-root'].includes(o.userData.role) || o.scale.x <= 1e-8) return;
        const ends = cylinderEnds(o);
        if (ends.start.distanceTo(ends.end) > 1e-8) expected.push({ ...ends, mesh: o });
      });
      const axes = meshes(roots).map(tube), copied = axes.slice(0, expected.length);
      assert.equal(copied.length, expected.length, label);
      for (const [i, axis] of copied.entries()) {
        close(axis.start, expected[i].start, `${label} proximal ring`);
        close(axis.end, expected[i].end, `${label} distal ring`);
        // The proximal ring itself is intact, not merely its declared origin.
        for (const v of axis.rings[0].vertices) assert.ok(Math.abs(v.distanceTo(expected[i].start) - expected[i].mesh.scale.x) < 5e-8, label);
      }
      for (const [i, expectedAxis] of expected.entries()) if (expectedAxis.mesh.userData.role === 'adventitious-root') {
        assert.ok(copied.some((axis, j) => supportRoles.includes(expected[j].mesh.userData.role) && contains(axis, copied[i].start)), `${label}: root misses support`);
        if (age > 0) assert.ok(axes.slice(expected.length).some(axis => axis.start.distanceTo(copied[i].end) < 5e-8), `${label}: no distal root extension`);
        if (species === 'oxalis') {
          assert.ok(copied[i].rings[0].vertices.every(v => v.y > .002), `${label}: exposed origin was buried`);
          if (expectedAxis.mesh.scale.x > .0006) assert.ok(copied[i].end.y < 0, `${label}: established adventitious root must enter soil`);
        }
      }
      assertConnected(axes, label);
      assertSoilBounds(axes, soilDepth, label);
      assert.ok(roots.rootDepth <= soilDepth && Number.isFinite(roots.rootLength));
    } finally { plant.dispose(); roots.dispose(); }
  }
});

test('Ophiopogon active ramets match the visible cohort and have real y=0 to y=-.008 basal bridges', () => {
  // Include values outside the supported range and invalid input to verify that
  // the same finite fallback and [.15, 2] density clamp are used on both sides.
  for (const density of [...densities, -.5, 3, NaN, Infinity, undefined]) for (const age of ages) for (const soilDepth of soilDepths) {
    const label = `ophiopogon density=${density} age=${age} soil=${soilDepth}`;
    const plant = buildAdditionalPlant('ophiopogon', { age, density, day: 180, seed: defaults.seed });
    const roots = buildRhizosphere('ophiopogon', { ...defaults, age, density, soilDepth });
    try {
      plant.group.updateMatrixWorld(true); roots.group.updateMatrixWorld(true);
      const axes = meshes(roots).map(tube);
      const rhizomes = axes.filter(a => a.mesh.userData.organ === 'rhizome');
      const bridges = axes.filter(a => a.mesh.userData.organ === 'root-collar');
      const clamped = Math.max(.15, Math.min(2, Number.isFinite(density) ? density : 1));
      const active = Array.from({ length: 1 + Math.round(6 * clamped) }, (_, i) => ophiopogonRamet(i, age)).filter(r => r.growth > 0);
      const extending = Array.from({ length: 1 + Math.round(6 * clamped) }, (_, i) => ophiopogonRamet(i, age)).filter(r => r.extension > 0);
      assert.equal(plant.branches.length, active.length, label);
      // Underground precursors legitimately precede the daughter leaf tuft.
      assert.equal(rhizomes.length, extending.length, label);
      assert.equal(bridges.length, active.length, label);
      for (const [i, joint] of plant.branches.entries()) {
        const base = joint.pivot.getWorldPosition(new THREE.Vector3());
        close(bridges[i].start, base, `${label}: basal bridge start`);
        close(bridges[i].end, new THREE.Vector3(base.x, -.008, base.z), `${label}: basal bridge end`);
        // The original division extends downward FROM its collar; lateral
        // daughter axes first reach their distal collars before leaf birth.
        close(i === 0 ? rhizomes[i].start : rhizomes[i].end, bridges[i].end, `${label}: rhizome node`);
        const leaves = joint.pivot.children.find(o => o.isMesh && o.userData.organ === 'leaf');
        assert.ok(leaves, `${label}: active ramet lacks actual leaves`);
        const p = leaves.geometry.attributes.position;
        // Read each merged ribbon's first ring, including its true leaf-base
        // offsets. Those bases must be within the solid basal connection.
        let basalVertices = 0;
        for (let j = 0; j < p.count; j++) {
          if (Math.abs(p.getY(j)) > 1e-12) continue;
          basalVertices++;
          const v = new THREE.Vector3().fromBufferAttribute(p, j).applyMatrix4(leaves.matrixWorld);
          assert.ok(Math.abs(v.y) < 1e-8, label);
          assert.ok(insideRing(bridges[i].rings[0], v), `${label}: leaf base outside basal connection`);
        }
        assert.ok(basalVertices > 0, label);
      }
      assertConnected(axes, label);
      assertSoilBounds(axes, soilDepth, label);
      if (age === 0) assert.equal(axes.length, 0);
      const rootAxes = axes.filter(a => a.mesh.userData.organ === 'root');
      if (age >= 1) assert.ok(rootAxes.length > 0, label);
      if (age === 5) {
        const storageAxes = axes.filter(a => a.mesh.userData.organ === 'storage-root');
        assert.ok(storageAxes.length > 0, label);
        for (const storage of storageAxes) assert.ok(rootAxes.some(parent => contains(parent, storage.start)
          && storage.rings[0].radius > parent.rings[0].radius * 2), `${label}: storage organ lacks an attached geometric swelling`);
        assert.notEqual(rhizomes[0].mesh.material, rootAxes[0].mesh.material);
      }
    } finally { plant.dispose(); roots.dispose(); }
  }
});

test('herb geometry is deterministic and disposal releases each owned geometry, material and soil texture once', () => {
  for (const species of ['iris', 'oxalis', 'ophiopogon']) {
    const params = { ...defaults, age: 5, density: 1.8, soilDepth: .05 };
    const a = buildRhizosphere(species, params), b = buildRhizosphere(species, params);
    const signature = m => meshes(m).map(o => [o.userData.organ, Array.from(o.geometry.attributes.position.array), Array.from(o.geometry.index.array)]);
    try { assert.deepEqual(signature(a), signature(b)); } finally { b.dispose(); }
    const resources = new Set();
    a.group.traverse(o => {
      if (!o.isMesh) return;
      resources.add(o.geometry);
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
    });
    const disposed = new Map([...resources].map(resource => [resource, 0]));
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
    a.dispose(); a.dispose();
    assert.equal(a.group.children.length, 0);
    assert.ok([...disposed.values()].every(count => count === 1));
  }
});
