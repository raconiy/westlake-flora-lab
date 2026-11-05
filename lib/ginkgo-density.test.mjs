import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';

// Morphology sources, not numerical age/angle calibration:
// https://plants.usda.gov/DocumentLibrary/plantguide/pdf/pg_ginkg.pdf
// https://efloras.org/florataxon.aspx?flora_id=2&taxon_id=200005235
// These checks measure generated vertices/instances, not field LAI or photo fit.
const areas = new WeakMap();
function bladeArea(geometry) {
  if (areas.has(geometry)) return areas.get(geometry);
  const p = geometry.attributes.position, index = geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    a.fromBufferAttribute(p, index ? index.getX(i) : i);
    b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1);
    c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2);
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  areas.set(geometry, area);
  return area;
}

function inspect(model) {
  model.group.updateMatrixWorld(true);
  const ids = new Set(), local = new THREE.Matrix4(), world = new THREE.Matrix4();
  const stalkMatrix = new THREE.Matrix4(), tip = new THREE.Vector3(), base = new THREE.Vector3();
  let area = 0, top = -Infinity, count = 0;
  model.group.traverse(o => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, vertices = p.array;
    const leaf = o.userData.connectedBy === 'petiole';
    const stalk = leaf && o.parent.children.find(s => s.isInstancedMesh && s.userData.organ === 'leaf' && !s.userData.connectedBy);
    if (leaf) {
      assert.ok(stalk);
      assert.equal(stalk.count, o.count);
      assert.equal(o.userData.nodeIds.length, o.count);
    }
    for (let i = 0; i < (o.isInstancedMesh ? o.count : 1); i++) {
      if (o.isInstancedMesh) {
        o.getMatrixAt(i, local);
        world.multiplyMatrices(o.matrixWorld, local);
      } else world.copy(o.matrixWorld);
      const e = world.elements;
      // Transform actual vertices: rotating a merged mesh bounding box can
      // overestimate height and conceal which geometry breached the leader.
      for (let v = 0; v < vertices.length; v += 3) {
        const y = e[1] * vertices[v] + e[5] * vertices[v + 1] + e[9] * vertices[v + 2] + e[13];
        top = Math.max(top, y);
      }
      if (!leaf) continue;
      const id = o.userData.nodeIds[i];
      assert.ok(typeof id === 'string' && id.length > 0);
      assert.ok(!ids.has(id), `duplicate material foliation site ${id}`);
      ids.add(id); count++;
      const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]);
      assert.ok(sx <= 1.05 && sy <= 1.05, 'no enlarged fan blades');
      area += bladeArea(o.geometry) * sx * sy;
      if (i % Math.max(1, Math.floor(o.count / 12)) === 0) {
        stalk.getMatrixAt(i, stalkMatrix);
        tip.set(0, .5, 0).applyMatrix4(stalkMatrix).applyMatrix4(stalk.matrixWorld);
        base.setFromMatrixPosition(world);
        assert.ok(tip.distanceTo(base) < 2e-6, `petiole/blade junction ${id}`);
      }
    }
  });
  assert.equal(count, model.leafCount);
  const m = model.group.userData.canopyMetrics;
  assert.ok(Number.isFinite(top));
  assert.ok(Math.abs(area - m.oneSidedLeafAreaM2) < Math.max(1e-8, area * 2e-6), 'area agrees with actual triangle/instance geometry');
  assert.ok(top <= model.height + 2e-6);
  assert.ok(top <= m.leaderHeightM * 1.12 + .04, `actual upper geometry exceeds leader envelope: ${top}`);
  assert.ok(model.height <= m.leaderHeightM * 1.12 + .04, 'keep existing public height acceptance');
  assert.ok(m.lifetimeLeafSiteCapacity <= 160000);
  assert.ok(m.potentialLeafCount <= m.lifetimeLeafSiteCapacity && count <= m.potentialLeafCount);
  return { ids, area, count, top };
}

test('ginkgo density is monotone in actual leaf identities and area within a fixed lifetime budget', t => {
  for (const seed of [1, 42, 73]) {
    for (const age of [.5, 8, 18, 20, 45, 80, 120, 200]) {
      let previous;
      for (const density of [.3, 1, 1.8]) {
        const model = buildPlant('ginkgo', { age, day: 180, seed, density });
        try {
          const now = inspect(model), label = `age=${age} seed=${seed} density=${density}`;
          if (previous) {
            assert.ok(now.count >= previous.count && now.area >= previous.area - 1e-9, label);
            for (const id of previous.ids) assert.ok(now.ids.has(id), `density evicts ${id}: ${label}`);
            if (age >= 8) assert.ok(now.count > previous.count && now.area > previous.area, label);
          }
          if (age === 45 && seed === 42 && density === 1) {
            assert.ok(now.area > 150);
            assert.ok(now.count > 80000);
            const m = model.group.userData.canopyMetrics;
            assert.ok(m.projectedCrownAreaM2 > 50 && m.leafAreaRatio >= 2 && m.leafAreaRatio <= 3.5);
          }
          if (seed === 42 && [18, 45, 80, 120, 200].includes(age)) {
            t.diagnostic(JSON.stringify({ age, density, leaves: now.count, meshAreaM2: now.area, actualTopM: now.top }));
          }
          previous = now;
        } finally { model.dispose(); }
      }
    }
    // Check the density clamp's maximum, including cohorts absent at age 45.
    const oldest = buildPlant('ginkgo', { age: 200, day: 180, seed, density: 2 });
    try {
      const now = inspect(oldest);
      t.diagnostic(JSON.stringify({ seed, age: 200, density: 2, leaves: now.count, reservedCapacity: oldest.group.userData.canopyMetrics.lifetimeLeafSiteCapacity }));
    } finally { oldest.dispose(); }
  }
});

test('ginkgo upper laterals retain leader form between the previous integer-age probes', () => {
  for (const seed of [1, 42, 73]) for (const age of [16, 17, 19, 21, 22, 23, 24, 25, 26, 30, 60]) {
    const model = buildPlant('ginkgo', { age, day: 180, seed, density: 2 });
    try { inspect(model); } finally { model.dispose(); }
  }
});
