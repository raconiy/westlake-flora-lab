import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {modelBounds, directionalShadowFrame} from './scene-framing.ts';
import {buildPlant} from './plant-engine.ts';

const direction = new THREE.Vector3(-7, 13, 8).normalize();
const corners = box => Array.from({length: 8}, (_, i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
function shadowCamera(frame) {
  const camera = new THREE.OrthographicCamera(frame.left, frame.right, frame.top, frame.bottom, frame.near, frame.far);
  camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld(true);
  return camera;
}

test('fitted shadow contains translated casters and their ground contact footprint at leaf, seedling and tree scales', () => {
  for (const scale of [.02, .2, 20]) {
    const box = new THREE.Box3(new THREE.Vector3(-.3, 0, -.2).multiplyScalar(scale), new THREE.Vector3(.6, 1, .4).multiplyScalar(scale)).translate(new THREE.Vector3(2, .01, -3));
    const frame = directionalShadowFrame(box, direction, 2048, -.004), camera = shadowCamera(frame);
    assert.ok(frame.near > 0 && frame.far > frame.near);
    for (const point of corners(box)) {
      const contact = point.clone().addScaledVector(direction, -(point.y + .004) / direction.y);
      for (const p of [point, contact]) for (const component of p.project(camera).toArray()) assert.ok(Math.abs(component) < 1, 'caster and contact stay inside shadow clip volume');
    }
    assert.ok(frame.normalBias < frame.texel, 'offset is sub-texel, in world metres');
    assert.ok(-frame.bias * (frame.far - frame.near) > frame.normalBias, 'reverse-facing blade normals cannot offset receivers deeper into the shadow');
  }
});

test('centimetre leaves and seedlings no longer inherit a 32 m frustum or a 12 mm normal offset', () => {
  const leaf = directionalShadowFrame(new THREE.Box3(new THREE.Vector3(-.04, -.055, -.002), new THREE.Vector3(.04, .07, .002)), direction, 2048);
  assert.ok(leaf.right - leaf.left < .2);
  assert.ok(leaf.normalBias < .00003, 'less than 30 micrometres on the detached leaf');
  const seedling = buildPlant('ginkgo', {age: .2, day: 180, seed: 42, density: 1});
  try {
    const frame = directionalShadowFrame(modelBounds(seedling.group), direction, 2048, -.001);
    assert.ok(frame.right - frame.left < 1);
    assert.ok(frame.normalBias < .0001);
  } finally { seedling.dispose(); }
});

test('stem crop keeps upstream canopy depth while spending shadow texels on the observed stem', () => {
  const plant = new THREE.Box3(new THREE.Vector3(-5, 0, -4), new THREE.Vector3(5, 15, 4));
  const stem = new THREE.Box3(new THREE.Vector3(-.1, 2.9, -.1), new THREE.Vector3(.1, 3.1, .1));
  const whole = directionalShadowFrame(plant, direction, 2048), crop = directionalShadowFrame(plant, direction, 2048, undefined, stem);
  assert.equal(crop.near, whole.near); assert.equal(crop.far, whole.far);
  assert.ok(crop.texel < whole.texel / 20);
  for (const point of corners(stem)) for (const c of point.project(shadowCamera(crop)).toArray()) assert.ok(Math.abs(c) < 1);
});

test('bounds include transformed instances, filter soil, and reuse cached instance bounds', () => {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(.02, .04, .002), material = new THREE.MeshBasicMaterial();
  const leaves = new THREE.InstancedMesh(geometry, material, 2);
  leaves.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-.1, .2, 0));
  leaves.setMatrixAt(1, new THREE.Matrix4().makeTranslation(.2, .3, -.1));
  leaves.userData.organ = 'leaf'; group.position.set(1, 2, 3); group.add(leaves);
  const soil = new THREE.Mesh(geometry, material); soil.scale.setScalar(100); soil.userData.organ = 'soil'; group.add(soil);
  const bounds = modelBounds(group, mesh => mesh.userData.organ !== 'soil');
  assert.ok(Math.abs(bounds.min.x - .89) < 1e-6 && Math.abs(bounds.max.y - 2.32) < 1e-6);
  leaves.getMatrixAt = () => { throw new Error('cached bounds must not rescan instances'); };
  assert.ok(modelBounds(group, mesh => mesh.userData.organ !== 'soil').equals(bounds));
  geometry.dispose(); material.dispose(); leaves.dispose();
});

test('empty organs produce a finite, usable shadow frame', () => {
  const frame = directionalShadowFrame(new THREE.Box3(), direction, 2048);
  for (const key of ['left', 'right', 'top', 'bottom', 'near', 'far', 'bias', 'normalBias']) assert.ok(Number.isFinite(frame[key]));
  assert.ok(frame.far > frame.near && frame.right > frame.left && frame.top > frame.bottom);
});
