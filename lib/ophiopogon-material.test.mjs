import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildAdditionalPlant } from './additional-species.ts';
import { buildRhizosphere } from './rhizosphere.ts';

const ages = [0, .1, 1, 1.03, 1.23, 1.53, 2, 5, 8];
const defaults = { seed: 42, day: 180, moisture: .55, compaction: .2, cutaway: true };
const near = (a, b, message) => assert.ok(a.distanceTo(b) < 5e-8, `${message}: ${a.distanceTo(b)} m`);
const birth = c => c === 0 ? .025 : .55 + c * .48;
const extensionBirth = c => c === 0 ? .025 : birth(c) - .9;
// Independent numerical inverse; do not make birth tests inherit a bug in
// the production helper's analytic inverse or clock fields.
function arrival(fraction) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (mid * mid * (3 - 2 * mid) < fraction) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// IDs only associate organs across rebuilds. All positions, lengths, overlap,
// radii and bounds below are reconstructed from actual world-space vertices.
function tube(mesh) {
  const p = mesh.geometry.attributes.position, sides = p.count === 225 ? 8 : 5;
  assert.ok(p.count === 225 || p.count === 78);
  const rings = [];
  for (let i = 0; i < p.count; i += sides + 1) {
    const vertices = Array.from({ length: sides }, (_, j) => new THREE.Vector3().fromBufferAttribute(p, i + j).applyMatrix4(mesh.matrixWorld));
    const center = vertices.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(1 / sides);
    rings.push({ center, vertices, radius: Math.max(...vertices.map(v => v.distanceTo(center))) });
  }
  return { mesh, rings, start: rings[0].center, end: rings.at(-1).center,
    length: rings.slice(1).reduce((n, r, i) => n + r.center.distanceTo(rings[i].center), 0) };
}
function contains(axis, point) {
  return axis.rings.slice(1).some((b, i) => {
    const a = axis.rings[i], line = new THREE.Line3(a.center, b.center), t = line.closestPointToPointParameter(point, true);
    return line.at(t, new THREE.Vector3()).distanceTo(point) < a.radius * (1 - t) + b.radius * t + 5e-8;
  });
}
function inside(ring, point) {
  return ring.vertices.some((v, i) => new THREE.Triangle(ring.center, v, ring.vertices[(i + 1) % ring.vertices.length])
    .closestPointToPoint(point, new THREE.Vector3()).distanceTo(point) < 5e-8);
}
function snapshot(age, density, soilDepth = 1.5, seed = 42) {
  const plant = buildAdditionalPlant('ophiopogon', { ...defaults, age, density, seed });
  const roots = buildRhizosphere('ophiopogon', { ...defaults, age, density, soilDepth, seed });
  plant.group.updateMatrixWorld(true); roots.group.updateMatrixWorld(true);
  const axes = new Map(roots.group.children.filter(o => o.isMesh && o.userData.organ !== 'soil').map(o => [o.userData.axisId, tube(o)]));
  const leaves = new Map(plant.branches.map(j => {
    const mesh = j.pivot.children.find(o => o.isMesh && o.userData.organ === 'leaf');
    return [j.pivot.userData.cohort, mesh];
  }));
  return { plant, roots, axes, leaves, dispose() { plant.dispose(); roots.dispose(); } };
}
function leafBase(mesh, leaf) {
  // merge expands one ribbon into 216 triangle vertices; vertex 2 is the
  // central first-row vertex, unaffected by subsequent width / keel growth.
  return new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, leaf * 216 + 2).applyMatrix4(mesh.matrixWorld);
}
function area(mesh) {
  const p = mesh.geometry.attributes.position, ix = mesh.geometry.index; let sum = 0;
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j));
    sum += v[1].sub(v[0]).cross(v[2].sub(v[0])).length() / 2;
  }
  return sum;
}

test('all actual Ophiopogon clumps have arrived support, fixed basal rings and overlapping leaf offsets', () => {
  for (const density of [.3, 1, 1.8]) for (const soilDepth of [.05, 1.5]) for (const age of ages) {
    const s = snapshot(age, density, soilDepth), count = 1 + Math.round(6 * density);
    try {
      assert.equal(s.leaves.size, Array.from({ length: count }, (_, c) => c).filter(c => age > birth(c)).length);
      assert.equal([...s.axes.keys()].filter(id => id.startsWith('rhizome-')).length,
        Array.from({ length: count }, (_, c) => c).filter(c => age > extensionBirth(c)).length);
      for (let c = 0; c < count; c++) {
        const axis = s.axes.get(`rhizome-${c}`), collar = s.axes.get(`collar-${c}`), leaf = s.leaves.get(c);
        if (age <= extensionBirth(c)) { assert.equal(axis, undefined); continue; }
        near(axis.start, new THREE.Vector3(0, -.008, 0), 'rhizome starts at the persistent main collar');
        if (age <= birth(c)) { assert.equal(collar, undefined); assert.equal(leaf, undefined); continue; }
        assert.ok(collar && leaf);
        const base=leaf.parent.getWorldPosition(new THREE.Vector3());
        const node = new THREE.Vector3(base.x,-.008,base.z);
        near(collar.end, node, `collar-${c} distal ring`);
        near(collar.start, new THREE.Vector3(node.x, 0, node.z), `collar-${c} basal ring`);
        near(c === 0 ? axis.start : axis.end, collar.end, 'support reaches the actual collar');
        const p = leaf.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i)) < 1e-12) {
          assert.ok(inside(collar.rings[0], new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(leaf.matrixWorld)), 'actual 8 mm leaf-base offsets overlap the collar polygon');
        }
      }
      for (const [id, axis] of s.axes) {
        if (id.startsWith('fiber-')) {
          const [c, f] = id.split('-').slice(1).map(Number);
          const parent = s.axes.get(`rhizome-${c}`), t = c === 0 && f === 0 ? 0 : .15 + .7 * (f + .5) / 12;
          // Reconstruct the full material path from the actual prefix rings
          // and the independently inverted extension clock, not old polar IDs.
          const g=Math.max(0,Math.min(1,(age-extensionBirth(c))/.9)),extension=g*g*(3-2*g);
          const node = parent.start.clone().lerp(parent.end,t/extension);
          near(axis.start, node, `${id}: fixed actual material node`);
          assert.ok(contains(parent, axis.start), `${id}: parent has reached its actual root start`);
          near(new THREE.Line3(parent.start, parent.end).closestPointToPoint(axis.start, true, new THREE.Vector3()), axis.start, `${id}: centreline has arrived`);
        }
        if (id.startsWith('storage-') && !id.startsWith('storage-parent-')) {
          assert.ok(contains(s.axes.get(id.replace('storage-', 'storage-parent-')), axis.start), `${id}: actual swelling node has arrived`);
        }
        const p = axis.mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(p, i);
          assert.ok(v.toArray().every(Number.isFinite)); assert.ok(v.y > -soilDepth);
          if (id.startsWith('rhizome-')) assert.ok(v.y < 0);
          else if (v.y >= 0) assert.ok(id.startsWith('collar-') && v.distanceTo(axis.start) < .006 + axis.rings[0].radius + 1e-7);
        }
        // Preserve actual triangles connecting every successive ring.
        const stride = axis.rings[0].vertices.length + 1, ix = axis.mesh.geometry.index;
        for (let r = 0; r < axis.rings.length - 1; r++) for (let j = 0; j < stride - 1; j++) {
          const indices = Array.from({ length: 6 }, (_, k) => ix.getX((r * (stride - 1) + j) * 6 + k));
          assert.ok(indices.some(i => Math.floor(i / stride) === r));
          assert.ok(indices.some(i => Math.floor(i / stride) === r + 1));
        }
      }
      if (age === 0) { assert.equal(s.axes.size, 0); assert.equal(s.plant.leafCount, 0); }
      if (age === .1) { assert.equal(s.leaves.size, 1); assert.ok(s.axes.has('collar-0')); }
      if (age === 1) assert.ok(s.axes.has('rhizome-1') && !s.leaves.has(1), 'root-only precursor must exist before the daughter tuft');
      if (age === 8) assert.equal(s.leaves.size, count, 'include every density-selected active clump');
    } finally { s.dispose(); }
  }
});

test('age 1.23 to 1.53 has no former 21.5 mm ring drift, and established root starts never slide or shrink', () => {
  for (const density of [.3, 1, 1.8]) for (const soilDepth of [.05, 1.5]) for (const seed of [42, 73]) {
    let previous;
    try {
      for (const age of ages) {
        const current = snapshot(age, density, soilDepth, seed);
        try {
          if (previous) {
            for (const [id, old] of previous.axes) {
              const next = current.axes.get(id); assert.ok(next, `${id} must persist`);
              near(next.start, old.start, `${id} fixed actual proximal ring`);
              assert.ok(next.length >= old.length - 5e-8, `${id} lifetime length cannot shrink`);
              assert.ok(next.rings[0].radius >= old.rings[0].radius - 5e-8, `${id} lifetime thickness cannot shrink`);
              if (id.startsWith('collar-')) near(next.end, old.end, `${id} fixed distal ring`);
              else for (const ring of old.rings) {
                // Existing material remains on the new actual centreline;
                // newly tessellated rings are not treated as material markers.
                const line = new THREE.Line3(next.start, next.end);
                near(line.closestPointToPoint(ring.center, true, new THREE.Vector3()), ring.center, `${id} retained material path`);
              }
            }
            for (const [c, mesh] of previous.leaves) {
              const next = current.leaves.get(c); assert.ok(next);
              for (let l = 0; l < mesh.geometry.attributes.position.count / 216; l++) near(leafBase(mesh, l), leafBase(next, l), `ramet ${c} existing leaf ${l} actual base`);
            }
            assert.ok(current.roots.rootLength >= previous.roots.rootLength - 1e-7);
          }
        } catch (error) { current.dispose(); throw error; }
        previous?.dispose(); previous = current;
      }
    } finally { previous?.dispose(); }
  }
});

test('precursor, every ramet, fiber and storage-node birth is gated by actual parent arrival with zero initial surface', () => {
  const density = 1.8, count = 1 + Math.round(6 * density), epsilon = 1e-6;
  for (let c = 0; c < count; c++) {
    const events = [{ at: extensionBirth(c), id: `rhizome-${c}` }, { at: birth(c), id: `collar-${c}` }];
    for (let f = 0; f < 12; f++) {
      const t = c === 0 && f === 0 ? 0 : .15 + .7 * (f + .5) / 12;
      events.push({ at: Math.max(extensionBirth(c) + .04 + f * .055, extensionBirth(c) + .9 * arrival(t)), id: `fiber-${c}-${f}` });
    }
    for (let f = 0; f < 2; f++) {
      events.push({ at: birth(c) + .8 + f * .2, id: `storage-parent-${c}-${f}` });
      events.push({ at: birth(c) + .8 + f * .2 + arrival(.65), id: `storage-${c}-${f}` });
    }
    for (const { at, id } of events) {
      // Roots only: avoid rebuilding thousands of unrelated foliage ribbons.
      const before = buildRhizosphere('ophiopogon', { ...defaults, density, soilDepth: .05, age: at - epsilon });
      const after = buildRhizosphere('ophiopogon', { ...defaults, density, soilDepth: .05, age: at + epsilon });
      try {
        assert.ok(!before.group.children.some(o => o.userData.axisId === id), `${id} premature birth`);
        const mesh = after.group.children.find(o => o.userData.axisId === id); assert.ok(mesh, `${id} absent after birth`);
        assert.ok(area(mesh) < 1e-9, `${id} nonzero initial surface`);
        if (id.startsWith('fiber-') || (id.startsWith('storage-') && !id.startsWith('storage-parent-'))) {
          const parentId = id.startsWith('fiber-') ? `rhizome-${c}` : id.replace('storage-', 'storage-parent-');
          after.group.updateMatrixWorld(true);
          assert.ok(contains(tube(after.group.children.find(o => o.userData.axisId === parentId)), tube(mesh).start), `${id} born before actual parent arrival`);
        }
      } finally { before.dispose(); after.dispose(); }
    }
    for (const offset of [-epsilon, 0, epsilon]) {
      const s = snapshot(birth(c) + offset, density);
      try {
        if (offset <= 0) assert.ok(!s.leaves.has(c));
        else { assert.ok(s.leaves.has(c)); assert.ok(area(s.leaves.get(c)) < 1e-9); }
      } finally { s.dispose(); }
    }
  }
});
