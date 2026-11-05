import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRhizosphere} from './rhizosphere.ts';
import {woodyRootAxes} from './woody-root-development.ts';
import {buildPlant} from './plant-engine.ts';
import {buildAdditionalPlant} from './additional-species.ts';

const speciesList = ['ginkgo', 'osmanthus', 'camphor', 'acer'];
const params = {seed: 42, moisture: .55, compaction: .2, soilDepth: 2.5, cutaway: true};
const roots = model => new Map(model.group.children.filter(o => o.userData.organ === 'root').map(o => [o.userData.axisId, o]));
// Read the rendered Float32 positions, rather than treating start/end metadata as geometry.
function ring(mesh, index) {
  const p = mesh.geometry.attributes.position, sides = mesh.userData.ringSides, centre = new THREE.Vector3();
  for (let j = 0; j < sides; j++) centre.add(new THREE.Vector3().fromBufferAttribute(p, index * sides + j));
  return centre.multiplyScalar(1 / sides);
}
const first = mesh => ring(mesh, 0);
const tip = mesh => ring(mesh, mesh.userData.materialCoordinates.length - 1);
function materialRings(mesh) {
  return new Map(mesh.userData.materialCoordinates.map((s, i) => [s, ring(mesh, i)]));
}
function diameter(mesh) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox.getSize(new THREE.Vector3()).length();
}
function assertGeometry(model, soilDepth) {
  for (const mesh of roots(model).values()) {
    const p = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)));
      assert.ok(p.getY(i) < 0 && p.getY(i) > -soilDepth, 'actual tube vertices stay in the soil');
      const radial = new THREE.Vector3().fromBufferAttribute(p, i).sub(ring(mesh, Math.floor(i / mesh.userData.ringSides)));
      const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
      // World-metre Float32 meshes cannot resolve triangle orientation on a
      // newborn nanometre-scale tube. Continuity and attachments are still
      // checked above; normal orientation needs a resolved (>1 µm) cross-section.
      if (radial.length() > 1e-6 && normal.length() > .5) {
        assert.ok(radial.normalize().dot(normal) > -1e-5, 'front-face tube normals point out of the root');
      }
    }
  }
}
function assertAttachments(model) {
  const axes = roots(model);
  for (const mesh of axes.values()) {
    if (!mesh.userData.parentId) continue;
    const parent = axes.get(mesh.userData.parentId);
    assert.ok(parent, 'a child cannot precede its parent');
    const nodes = materialRings(parent), node = nodes.get(mesh.userData.materialNode);
    assert.ok(node, 'the parent has reached the fixed material node and renders its ring');
    assert.ok(first(mesh).distanceTo(node) < 3e-7, `${mesh.userData.axisId}: actual child/parent rings join`);
  }
}
function compareNear(a, b, tolerance) {
  const before = roots(a), after = roots(b);
  for (const [id, old] of before) {
    const next = after.get(id);
    assert.ok(next, `${id} does not retire by age`);
    assert.ok(tip(old).distanceTo(tip(next)) < tolerance, `${id}: rendered tip jumps`);
    const p = old.geometry.attributes.position, q = next.geometry.attributes.position;
    assert.equal(p.count, q.count, `${id}: existing mesh topology stays stable across another birth`);
    for (let i = 0; i < p.count; i++) {
      assert.ok(new THREE.Vector3().fromBufferAttribute(p, i).distanceTo(new THREE.Vector3().fromBufferAttribute(q, i)) < tolerance,
        `${id}: actual surface jumps`);
    }
  }
}

test('age 2 ginkgo 4-to-5 crown-root regression: existing final tips and surfaces stay continuous', () => {
  const a = buildRhizosphere('ginkgo', {...params, age: 2 - 1e-7});
  const b = buildRhizosphere('ginkgo', {...params, age: 2 + 1e-7});
  const crownCount = m => [...roots(m).keys()].filter(id => /:crown:\d+$/.test(id)).length;
  assert.equal(crownCount(a), 4); assert.equal(crownCount(b), 5);
  compareNear(a, b, 1e-6); // Previously up to 0.448 m; now below 0.001 mm.
  const newborn = roots(b).get('ginkgo:root:crown:4');
  assert.ok(diameter(newborn) < 1e-7);
  assertAttachments(b); a.dispose(); b.dispose();
});

test('all four woody species retain actual material rings, attachment points and IDs at ages 2/8/18/45/80', () => {
  for (const species of speciesList) for (const soilDepth of [.05, 2.5]) for (const seed of [42, 137]) {
    let previous = new Map();
    for (const age of [2, 8, 18, 45, 80]) {
      const model = buildRhizosphere(species, {...params, soilDepth, seed, age});
      assertGeometry(model, soilDepth); assertAttachments(model);
      const now = roots(model), snapshot = new Map();
      for (const [id, mesh] of now) {
        const points = materialRings(mesh), end = mesh.userData.materialCoordinates.at(-1);
        // The old moving tip is replaced as extension continues; all formed
        // interior rings, including every attachment, remain material points.
        points.delete(end);
        snapshot.set(id, {points, start: first(mesh), radius: mesh.userData.radius, end});
      }
      for (const [id, old] of previous) {
        const next = snapshot.get(id);
        assert.ok(next, `${species} ${id} retained at age ${age}`);
        assert.ok(next.radius >= old.radius && next.end >= old.end, 'no age-only root shrinkage');
        assert.ok(next.start.distanceTo(old.start) < 3e-7, 'old side-root origins do not slide');
        for (const [s, point] of old.points) {
          assert.ok(next.points.has(s), 'formed interior rings persist in final geometry');
          assert.ok(point.distanceTo(next.points.get(s)) < 3e-7, `${id} material ring ${s} migrated`);
        }
      }
      assert.equal(model.group.userData.calibrated, false);
      assert.equal(model.group.userData.rootPersistence.calibrated, false);
      previous = snapshot; model.dispose();
    }
  }
});

test('every scheduled or parent-gated woody birth has zero-size continuous geometry and no sibling reroll', () => {
  // The helper supplies candidate clocks only; every assertion uses buildRhizosphere's final meshes.
  for (const species of speciesList) {
    const axes = woodyRootAxes(species, params.seed, 1, params.soilDepth);
    const births = [...new Set(axes.map(axis => axis.birth))];
    for (const birth of births) {
      const a = buildRhizosphere(species, {...params, age: birth - 1e-7});
      const b = buildRhizosphere(species, {...params, age: birth + 1e-7});
      compareNear(a, b, 2e-6);
      const old = roots(a), next = roots(b);
      for (const axis of axes.filter(axis => axis.birth === birth)) {
        assert.ok(!old.has(axis.id) && next.has(axis.id), `${axis.id}: birth is exercised in final geometry`);
      }
      for (const [id, mesh] of next) if (!old.has(id)) {
        assert.ok(diameter(mesh) < 1e-7, `${id}: length and radial size begin at zero`);
        if (mesh.userData.parentId) {
          const parent = next.get(mesh.userData.parentId), node = materialRings(parent).get(mesh.userData.materialNode);
          assert.ok(node && first(mesh).distanceTo(node) < 3e-7);
          assert.ok(tip(mesh).distanceTo(node) < 3e-7);
        }
      }
      assertAttachments(b); assertGeometry(b, params.soilDepth);
      a.dispose(); b.dispose();
    }
  }
});

test('seed radicles keep buried poles and formed underground material while collars extend proximally', () => {
  for (const [species, pole] of [['ginkgo', -.037], ['osmanthus', -.011]]) {
    const early = buildRhizosphere(species, {...params, age: .04});
    const primary = roots(early).get(`${species}:root:primary`);
    assert.ok(Math.abs(first(primary).y - pole) < 1e-8);
    assert.ok(tip(primary).y < pole, 'actual radicle extends out of the buried coat');
    early.dispose();
    let previous;
    for (const age of [.2, .25, .55, .649, .65, .8, .9, .95, 2]) {
      const model = buildRhizosphere(species, {...params, age});
      const mesh = roots(model).get(`${species}:root:primary`), points = materialRings(mesh);
      assert.ok(Math.abs(points.get(0).y - pole) < 1e-8, 'original seed pole is retained in actual geometry');
      if (previous) for (const [s, point] of previous) {
        if (s >= 0 && points.has(s)) assert.ok(point.distanceTo(points.get(s)) < 3e-7, 'collar movement does not translate the radicle');
      }
      previous = points; assertAttachments(model); model.dispose();
    }
  }
});

test('actual known shoot collars and displaced collar coordinates meet rendered root junctions', () => {
  for (const species of speciesList) for (const age of [.2, 8]) for (const density of [.3, 1, 1.8]) {
    const p = {age, seed: 42, day: 180, density};
    const shoot = species === 'camphor' || species === 'acer' ? buildAdditionalPlant(species, p) : buildPlant(species, p);
    const trunk = shoot.branches.find(axis => axis.order === 0);
    shoot.group.position.set(.13, 0, -.17); shoot.group.updateMatrixWorld(true);
    const position = trunk.pivot.getWorldPosition(new THREE.Vector3());
    const radius = trunk.radius * (species === 'ginkgo' ? 1.35 : species === 'osmanthus' ? 1 : 1.4);
    const root = buildRhizosphere(species, {...params, age, density, soilDepth: .05,
      shootCollar: {position: position.toArray(), radius}});
    const junction = root.group.getObjectByName('root-shoot-junction');
    const vertices = junction.geometry.attributes.position, topRing = [];
    for (let i = 0; i < vertices.count; i++) if (Math.abs(vertices.getY(i) - position.y) < 1e-8) {
      topRing.push(new THREE.Vector3().fromBufferAttribute(vertices, i));
    }
    assert.ok(topRing.length >= 16, 'actual junction vertices reach the supplied shoot plane');
    assert.ok(topRing.some(point => Math.abs(Math.hypot(point.x-position.x, point.z-position.z)-radius) < 1e-7));
    junction.geometry.computeBoundingBox();
    // Curved trunks have tilted basal rings. Inspect their actual ring centre
    // and overlap with the junction volume, rather than demanding a flat ring.
    let meets = false;
    for (const mesh of trunk.pivot.children) if (mesh.isMesh && !mesh.isInstancedMesh) {
      const v = mesh.geometry.attributes.position;
      if (species !== 'osmanthus') {
        const sides = species === 'ginkgo' ? 12 : 10, centre = new THREE.Vector3();
        let overlaps = false;
        for (let i = 0; i < sides; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(v, i).applyMatrix4(mesh.matrixWorld);
          centre.add(point);
          if (point.y <= position.y + 1e-8 && point.y >= junction.geometry.boundingBox.min.y &&
            Math.hypot(point.x-position.x, point.z-position.z) <= radius + 1e-7) overlaps = true;
        }
        // Ginkgo bark already has 3.5% radial irregularity, so its finite ring
        // centroid is slightly off axis. Require real volume overlap as well.
        meets = centre.multiplyScalar(1/sides).distanceTo(position) < radius * .04 + 1e-7 && overlaps;
        if (meets) break;
        continue;
      }
      for (let i = 0; i < v.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(v, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(point.y-position.y) < 1e-7 && Math.abs(Math.hypot(point.x-position.x, point.z-position.z)-radius) < 1e-6) {meets = true; break;}
      }
      if (meets) break;
    }
    assert.ok(meets, `${species}: rendered shoot base meets the junction`);
    const rootBase = first(roots(root).get(`${species}:root:primary`));
    assert.ok(Math.abs(rootBase.x-position.x) < 1e-7 && Math.abs(rootBase.z-position.z) < 1e-7);
    assert.ok(rootBase.y >= junction.geometry.boundingBox.min.y && rootBase.y <= junction.geometry.boundingBox.max.y);
    assertAttachments(root); assertGeometry(root, .05); root.dispose(); shoot.dispose();
  }
});
