import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPlant} from './plant-engine.ts';
import {buildAdditionalPlant} from './additional-species.ts';
import {STRIP_ATTRIBUTES, tagLeafStrip} from './herb-leaf-dynamics.ts';
import {leafStripVertex} from './leaf-dynamics.ts';

const vector = (g, name, i) => new THREE.Vector3().fromBufferAttribute(g.getAttribute(name), i);
const angle = (a, b) => Math.atan2(new THREE.Vector3().crossVectors(a, b).length(), a.dot(b)) * 180 / Math.PI;
const shape = s => s * s * (6 - 4 * s + s * s) / 3;
// Independent SI calculation; do not use the production load/normal helpers
// to construct the expected deformed surface.
function amplitude(g, i, frame) {
  const scale = new THREE.Vector3().setFromMatrixColumn(frame, 1).length();
  const n = vector(g, 'leafLoadNormal', i).transformDirection(frame);
  const u = 4 * n.dot(new THREE.Vector3(1, 0, .2).normalize());
  const pressure = .5 * 1.225 * .8 * u * Math.abs(u) - .12 * 9.81 * n.y;
  const L = Math.min(2, g.getAttribute('leafMaterial').getY(i) * scale);
  const x = 1.5 * pressure / 2e8 * (L / .0003) ** 3 / .12;
  return L * .12 * x / Math.hypot(1, x) / scale;
}
function firstStrip(species) {
  const params = {age: 2, day: 180, seed: 17, density: .3};
  const plant = species === 'iris' ? buildPlant(species, params) : buildAdditionalPlant(species, params);
  let blade;
  plant.group.traverse(o => {if (!blade && o.isMesh && o.userData.leafDynamics === 'material-strip') blade = o;});
  assert.ok(blade); plant.group.updateMatrixWorld(true);
  const source = blade.geometry, g = new THREE.BufferGeometry();
  // Iris is an indexed strip. Ophiopogon really merges nonindexed triangles;
  // recover only its first leaf's row vertices, retaining its stored gradients.
  const rows = source.index ? source.getAttribute('position').count / 3 : blade.userData.leafVertexCount / 12 + 1;
  const sourceIndex = (r, c) => source.index ? r * 3 + c : r === rows - 1 ? (r - 1) * 12 + [1, 5, 11][c] : r * 12 + [0, 2, 8][c];
  for (const name of ['position', 'normal', 'uv', ...Object.keys(STRIP_ATTRIBUTES)]) {
    const attr = source.getAttribute(name); if (!attr) continue;
    const values = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < 3; c++) {
      for (let k = 0; k < attr.itemSize; k++) values.push(attr.getComponent(sourceIndex(r, c), k));
    }
    g.setAttribute(name, new THREE.Float32BufferAttribute(values, attr.itemSize));
  }
  return {plant, g, frame: blade.matrixWorld.clone(), rows};
}
function derivatives(g, r, c) {
  const coord = g.getAttribute('leafMaterial'), i = r * 3 + c;
  const U = vector(g, 'position', r * 3 + Math.min(c + 1, 2)).sub(vector(g, 'position', r * 3 + Math.max(c - 1, 0)));
  const ds = coord.getX(i + 3) - coord.getX(i - 3);
  const V = vector(g, 'position', i + 3).sub(vector(g, 'position', i - 3)).divideScalar(ds);
  return {i, U, V};
}

for (const species of ['iris', 'ophiopogon']) test(`${species}: actual crossed-width curved rows have a material dual and independent deformed normals`, t => {
  const {plant, g, frame} = firstStrip(species);
  try {
    const analytic = g.clone();
    const rows = species === 'iris' ? [4, 8, 12] : [4, 9, 14];
    let maxWidthResidual = 0, maxAxisResidual = 0, maxNormalAngle = 0, maxSmoothAngle = 0;
    for (const r of rows) for (const c of [0, 1, 2]) {
      const {i, U, V} = derivatives(g, r, c), gradient = vector(g, 'leafGradient', i);
      const widthResidual = Math.abs(gradient.dot(U)), axisResidual = Math.abs(gradient.dot(V) - 1);
      maxWidthResidual = Math.max(maxWidthResidual, widthResidual); maxAxisResidual = Math.max(maxAxisResidual, axisResidual);
      assert.ok(widthResidual < 2e-8, `row ${r}/${c}: g.U=${gradient.dot(U)}`);
      assert.ok(axisResidual < 2e-6, `row ${r}/${c}: g.V=${gradient.dot(V)}`);
      assert.ok(Math.abs(gradient.dot(new THREE.Vector3().crossVectors(U, V).normalize())) < 2e-5, 'minimum tangent dual');
      const s = g.getAttribute('leafMaterial').getX(i), A = amplitude(g, i, frame), direction = vector(g, 'leafLoadNormal', i);
      const h = 1e-5, slope = (shape(s + h) - shape(s - h)) / (2 * h);
      const deformedV = V.clone().addScaledVector(direction, A * slope);
      const expected = new THREE.Vector3().crossVectors(U, deformedV).normalize();
      const restNormal = new THREE.Vector3().crossVectors(U, V).normalize();
      if (restNormal.dot(vector(g, 'normal', i)) < 0) {restNormal.negate(); expected.negate();}
      analytic.getAttribute('normal').setXYZ(i, ...restNormal.toArray());
      const result = leafStripVertex(analytic, i, frame, 4, 9.81);
      const expectedPosition = vector(g, 'position', i).addScaledVector(direction, A * shape(s));
      assert.ok(result.position.distanceTo(expectedPosition) < 1e-12, 'unchanged displacement and cap');
      maxNormalAngle = Math.max(maxNormalAngle, angle(result.normal, expected));
      assert.ok(angle(result.normal, expected) < 2e-5, `row ${r}/${c}: independent cross-product normal`);
      const smooth = leafStripVertex(g, i, frame, 4, 9.81).normal;
      maxSmoothAngle = Math.max(maxSmoothAngle, angle(smooth, expected));
      // The actual crease/smoothing normal need not equal U x V. Independently
      // deform a plane with that stored normal, then cross its two tangents.
      const N = new THREE.Vector3().crossVectors(U, V);
      const dual = new THREE.Vector3().crossVectors(N, U).divideScalar(N.lengthSq());
      const stored = vector(g, 'normal', i).normalize();
      const tangentA = U.clone().addScaledVector(stored, -U.dot(stored)).normalize();
      const tangentB = new THREE.Vector3().crossVectors(stored, tangentA).normalize();
      tangentA.addScaledVector(direction, A * slope * dual.dot(tangentA));
      tangentB.addScaledVector(direction, A * slope * dual.dot(tangentB));
      const expectedSmooth = new THREE.Vector3().crossVectors(tangentA, tangentB).normalize();
      assert.ok(angle(smooth, expectedSmooth) < 2e-5, 'stored smooth normal agrees with independently deformed plane');
      if (species === 'iris' && r === 12 && c === 0) {
        t.diagnostic(`Iris row12 vertex36: s=${s}, gradient=${gradient.toArray()}, g.U=${gradient.dot(U)}, analytic error=${angle(result.normal, expected)}deg, smooth error=${angle(smooth, expected)}deg`);
      }
    }
    t.diagnostic(`${species}: max |g.U|=${maxWidthResidual}; max |g.V-1|=${maxAxisResidual}; analytic normal=${maxNormalAngle}deg; stored smooth normal=${maxSmoothAngle}deg`);
    analytic.dispose();
  } finally {g.dispose(); plant.dispose();}
});

for (const species of ['iris', 'ophiopogon']) test(`${species}: corrected normals survive an anisotropic instance and rigid/uniform-scale retagging`, () => {
  const {plant, g, frame} = firstStrip(species);
  const material = new THREE.MeshStandardMaterial(), instance = new THREE.InstancedMesh(g, material, 1);
  try {
    // This is geometric normal-transform coverage, not expanded strip load
    // support: createLeafDynamics still rejects nonuniform herb object frames.
    const localInstance = new THREE.Matrix4().compose(new THREE.Vector3(.1, -.2, .3), new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, -.4, .2)), new THREE.Vector3(.55, 1.4, .8));
    instance.setMatrixAt(0, localInstance); instance.matrix.copy(frame); instance.matrixAutoUpdate = false; instance.updateMatrixWorld(true);
    const actualInstance = new THREE.Matrix4(); instance.getMatrixAt(0, actualInstance);
    const combined = new THREE.Matrix4().multiplyMatrices(instance.matrixWorld, actualInstance), worldLinear = new THREE.Matrix3().setFromMatrix4(combined);
    const instanceLinear = new THREE.Matrix3().setFromMatrix4(actualInstance), modelNormal = new THREE.Matrix3().getNormalMatrix(instance.matrixWorld);
    for (const r of [4, 12]) {
      const {i, U, V} = derivatives(g, r, 0), s = g.getAttribute('leafMaterial').getX(i);
      const restNormal = new THREE.Vector3().crossVectors(U, V).normalize();
      const analytic = g.clone(); analytic.getAttribute('normal').setXYZ(i, ...restNormal.toArray());
      const result = leafStripVertex(analytic, i, frame, 4, 9.81);
      const h = 1e-5, slope = (shape(s + h) - shape(s - h)) / (2 * h);
      const deformedV = V.clone().addScaledVector(vector(g, 'leafLoadNormal', i), amplitude(g, i, frame) * slope);
      const expected = new THREE.Vector3().crossVectors(U.clone().applyMatrix3(worldLinear), deformedV.applyMatrix3(worldLinear)).normalize();
      // Three defaultnormal_vertex's separate instance and model chain.
      const axisSq = [0, 1, 2].map(c => new THREE.Vector3().setFromMatrixColumn(actualInstance, c).lengthSq());
      const actual = result.normal.clone().divide(new THREE.Vector3(...axisSq)).applyMatrix3(instanceLinear).applyMatrix3(modelNormal).normalize();
      assert.ok(angle(actual, expected) < 2e-5, 'world normal agrees with independently transformed deformed tangents');
      analytic.dispose();
    }
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(.02, -.01, .04), new THREE.Quaternion().setFromEuler(new THREE.Euler(.4, -.7, .2)), new THREE.Vector3(1.7, 1.7, 1.7));
    const rotated = g.clone().applyMatrix4(transform); tagLeafStrip(rotated);
    const inverseTranspose = new THREE.Matrix3().getNormalMatrix(transform);
    for (const r of [4, 12]) for (const c of [0, 1, 2]) {
      const i = r * 3 + c;
      assert.ok(Math.abs(rotated.getAttribute('leafMaterial').getX(i) - g.getAttribute('leafMaterial').getX(i)) < 2e-7);
      assert.ok(Math.abs(rotated.getAttribute('leafMaterial').getY(i) / g.getAttribute('leafMaterial').getY(i) - 1.7) < 1e-6);
      const expected = vector(g, 'leafGradient', i).applyMatrix3(inverseTranspose);
      assert.ok(vector(rotated, 'leafGradient', i).distanceTo(expected) / expected.length() < 2e-5, 'gradient transforms as a covector');
    }
    for (const name of ['position', 'normal', 'uv', 'leafMaterial', 'leafBase', 'leafLoadNormal']) {
      const before = g.getAttribute(name); if (!before) continue;
      const copy = g.clone(); tagLeafStrip(copy);
      assert.deepEqual(copy.getAttribute(name).array, before.array, `${name} preserved when retagging actual geometry`); copy.dispose();
    }
    rotated.dispose();
  } finally {instance.dispose(); material.dispose(); g.dispose(); plant.dispose();}
});

test('collapsed width, collinear frames, repeated rows and zero length have finite material attributes and responses', () => {
  const fixtures = [
    // Zero width, but a valid longitudinal derivative.
    [0,0,0, 0,0,0, 0,0,0, 0,1,0, 0,1,0, 0,1,0, 0,2,0, 0,2,0, 0,2,0],
    // Width and longitudinal directions coincide: no compatible dual exists.
    [-1,0,0, 0,0,0, 1,0,0, 0,0,0, 1,0,0, 2,0,0, 1,0,0, 2,0,0, 3,0,0],
    // Repeated material stations and total zero-length strips.
    [-1,0,0, 0,0,0, 1,0,0, -1,0,0, 0,0,0, 1,0,0],
    Array(9).fill(0),
    // Almost parallel U/V must not create a divergent inverse.
    [-1,0,0, 0,0,0, 1,0,0, 0,1e-9,0, 1,1e-9,0, 2,1e-9,0],
  ];
  for (const [f, positions] of fixtures.entries()) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({length: positions.length}, (_, i) => i % 3 === 2 ? 1 : 0), 3));
    tagLeafStrip(g);
    for (const name of Object.keys(STRIP_ATTRIBUTES)) assert.ok([...g.getAttribute(name).array].every(Number.isFinite), `${f}/${name}`);
    if (f === 0) assert.ok(vector(g, 'leafGradient', 3).distanceTo(new THREE.Vector3(0, .5, 0)) < 1e-12);
    else assert.ok([...g.getAttribute('leafGradient').array].every(v => v === 0), `rank-deficient ${f} uses zero dual`);
    for (let i = 0; i < positions.length / 3; i++) {
      const result = leafStripVertex(g, i, new THREE.Matrix4(), 4, 9.81);
      assert.ok([...result.position.toArray(), ...result.normal.toArray()].every(Number.isFinite));
    }
    g.dispose();
  }
});
