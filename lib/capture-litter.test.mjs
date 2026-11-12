import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCaptureLitter, litterSites} from './capture-litter.ts';
import {isMeadowPoint} from './capture-meadow-layout.ts';

const stems = [[0, 0], [-1.1, -11.8], [-12.7, -13.2]];

test('litter is deterministic and lies only on lawn, clear of every stem', () => {
  const a = litterSites(stems), b = litterSites(stems);
  assert.deepEqual([...a], [...b]);
  assert.ok(a.length / 2 > 2000);
  for (let i = 0; i < a.length; i += 2) {
    assert.ok(isMeadowPoint(a[i], a[i+1], .12), 'on turf, not paving');
    for (const [x, z] of stems) assert.ok(Math.hypot(a[i] - x, a[i+1] - z) >= .45, 'not inside a stem');
  }
});

test('litter is denser beneath a crown than in the open', () => {
  const s = litterSites(stems);
  const within = (x, z, r) => { let n = 0; for (let i = 0; i < s.length; i += 2) if (Math.hypot(s[i] - x, s[i+1] - z) < r) n++; return n / (Math.PI * r * r); };
  assert.ok(within(0, 0, 4) > 2 * within(12, -30, 4));
});

test('leaves rest just above the lawn datum, do not cast shadow, and dispose cleanly', () => {
  const root = new THREE.Group();
  for (const [i, [x, z]] of stems.entries()) { const t = new THREE.Group(); t.name = 'tree.' + i; t.position.set(x, 0, z); root.add(t); }
  const scene = new THREE.Group(); scene.add(root);
  const litter = createCaptureLitter(root);
  scene.add(litter.mesh);
  assert.equal(litter.mesh.count, litter.stats.leaves);
  assert.equal(litter.mesh.castShadow, false);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (let i = 0; i < litter.mesh.count; i++) {
    litter.mesh.getMatrixAt(i, m); m.decompose(p, q, sc);
    assert.ok(p.y > .08 && p.y < .11);
    assert.ok(sc.y >= .06 && sc.y <= .11);
  }
  litter.dispose();
  assert.equal(litter.mesh.parent, null);
});
