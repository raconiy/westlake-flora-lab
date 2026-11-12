import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCaptureFoliage, laminaGeometry, laminaSites} from './capture-foliage.ts';

function tree(leafVertices = 600) {
  const root = new THREE.Group(), t = new THREE.Group(); t.name = 'tree.test';
  const limb = new THREE.Group(); limb.name = 'tree.test.limb.00'; limb.userData.wind_joint = true;
  limb.position.set(1, 4, -2); limb.rotation.set(.3, .2, -.4);
  const positions = new Float32Array(leafVertices * 3), colours = new Float32Array(leafVertices * 3);
  for (let i = 0; i < leafVertices; i++) {
    positions.set([Math.sin(i) * 2, i / leafVertices * 3, Math.cos(i * 1.7) * 2], i * 3);
    colours.set([.1, .2, .05], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const leaves = new THREE.Mesh(g, new THREE.MeshStandardMaterial({name: 'Living broadleaf blades'}));
  const wood = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name: 'Gray-brown bark'}));
  limb.add(leaves, wood); t.add(limb); root.add(t);
  return {root, limb, leaves, wood};
}

test('sites are deterministic, in range, strictly increasing and capped by the source', () => {
  const a = laminaSites(1000, 120, 7), b = laminaSites(1000, 120, 7);
  assert.deepEqual([...a], [...b]);
  assert.equal(a.length, 120);
  for (let i = 0; i < a.length; i++) { assert.ok(a[i] < 1000); if (i) assert.ok(a[i] > a[i-1]); }
  assert.equal(laminaSites(50, 500, 1).length, 50);
  assert.equal(laminaSites(0, 10, 1).length, 0);
});

test('every lamina is rooted exactly on an exported blade vertex of its own limb', () => {
  const {root, limb, leaves} = tree();
  const foliage = createCaptureFoliage(root, {perTree: 200});
  assert.equal(foliage.meshes.length, 1);
  const mesh = foliage.meshes[0];
  assert.equal(mesh.parent, limb);
  assert.equal(foliage.stats.laminae, 200);
  const source = new Set(), p = leaves.geometry.getAttribute('position'), v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (let i = 0; i < p.count; i++) source.add(v.fromBufferAttribute(p, i).toArray().map(x => x.toFixed(4)).join());
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    assert.ok(source.has(v.setFromMatrixPosition(m).toArray().map(x => x.toFixed(4)).join()), 'petiole end on a blade vertex');
  }
});

test('foliage adds no wood, does not cast shadow, and leaves the source and wind metadata untouched', () => {
  const {root, limb, leaves, wood} = tree();
  const before = leaves.geometry.getAttribute('position').array.slice();
  limb.userData.leaf_area_m2 = 3.5;
  const foliage = createCaptureFoliage(root, {perTree: 100});
  assert.deepEqual([...leaves.geometry.getAttribute('position').array], [...before]);
  assert.equal(limb.userData.leaf_area_m2, 3.5);
  assert.equal(wood.parent, limb);
  for (const mesh of foliage.meshes) assert.equal(mesh.castShadow, false);
  foliage.dispose();
  assert.equal(limb.children.length, 2, 'dispose removes every lamina mesh');
});

test('lamina sizes stay within a plausible broadleaf range', () => {
  const {root} = tree();
  const foliage = createCaptureFoliage(root, {perTree: 300, length: .095});
  const m = new THREE.Matrix4(), s = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3();
  for (const mesh of foliage.meshes) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m); m.decompose(p, q, s);
    assert.ok(s.y > .06 && s.y < .13, 'length 6 to 13 cm');
    assert.ok(s.x / s.y > .38 && s.x / s.y < .54, 'width to length ratio');
  }
});

test('the unit lamina spans petiole to tip with a fold along the midrib', () => {
  const g = laminaGeometry(), p = g.getAttribute('position');
  g.computeBoundingBox();
  assert.equal(g.boundingBox.min.y, 0); assert.equal(g.boundingBox.max.y, 1);
  assert.equal(g.boundingBox.min.x, -.5); assert.equal(g.boundingBox.max.x, .5);
  // At any station the margins stand above the midrib.
  for (let j = 0; j < p.count; j += 3) assert.ok(p.getZ(j) > p.getZ(j + 1) && p.getZ(j + 2) > p.getZ(j + 1));
});

test('crown interior is darker than its shell, monotonically, and never black', async () => {
  const {crownOcclusion} = await import('./capture-foliage.ts');
  assert.equal(crownOcclusion(0), 1);
  let previous = 1;
  for (let d = .1; d <= 1.0001; d += .1) { const k = crownOcclusion(d); assert.ok(k < previous && k >= .5 - 1e-9); previous = k; }
  assert.equal(crownOcclusion(5), crownOcclusion(1)); assert.equal(crownOcclusion(-2), 1);
});

test('leaves are still in still air and flutter saturates in strong wind', async () => {
  const {flutterAmplitude} = await import('./capture-foliage.ts');
  assert.equal(flutterAmplitude(0), 0); assert.equal(flutterAmplitude(NaN), 0);
  assert.ok(flutterAmplitude(2) < flutterAmplitude(6) && flutterAmplitude(6) < flutterAmplitude(12));
  assert.ok(flutterAmplitude(1e6) <= .32);
  assert.equal(flutterAmplitude(-5), flutterAmplitude(5));
  const {root} = tree();
  const foliage = createCaptureFoliage(root, {perTree: 50});
  assert.equal(foliage.update(.016, 0), false, 'no redraw requested in still air');
  assert.equal(foliage.update(.016, 4), true);
  assert.equal(foliage.update(.016, 0), true, 'the rest pose is drawn once when the wind stops');
  assert.equal(foliage.update(.016, 0), false, 'then no further redraws');
});
