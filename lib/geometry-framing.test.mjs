import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {modelGeometryFrame, perspectiveGeometryFrame, cameraContainsGeometry, perspectiveCameraRange, perspectiveBoundsFrame, modelBounds} from './scene-framing.ts';

const direction = new THREE.Vector3(1, .9, 1.65);
function fit(geometry, aspect, view = direction) {
  const frame = perspectiveGeometryFrame(geometry, view, 35, aspect);
  const range = perspectiveCameraRange(geometry.bounds, frame.position, frame.target, frame.distance);
  assert.ok([...frame.position, ...frame.target, frame.distance, ...Object.values(range)].every(Number.isFinite));
  assert.ok(range.near > 0 && range.far > range.near && range.maxDistance > range.minDistance);
  const camera = new THREE.PerspectiveCamera(35, aspect, range.near, range.far);
  camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld(true);
  if (geometry.cells.length) assert.ok(cameraContainsGeometry(geometry, camera));
  return {camera, frame, range};
}
function assertVertices(group, camera, deform = p => p) {
  group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true);
  const instance = new THREE.Matrix4(), matrix = new THREE.Matrix4(), p = new THREE.Vector3();
  group.traverse(mesh => {
    if (!(mesh instanceof THREE.Mesh)) return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < (mesh instanceof THREE.InstancedMesh ? mesh.count : 1); i++) {
      if (mesh instanceof THREE.InstancedMesh) { mesh.getMatrixAt(i, instance); matrix.multiplyMatrices(mesh.matrixWorld, instance); }
      else matrix.copy(mesh.matrixWorld);
      for (let v = 0; v < position.count; v++) {
        deform(p.fromBufferAttribute(position, v), mesh, matrix).applyMatrix4(matrix).project(camera);
        assert.ok(Math.abs(p.x) < .98 && Math.abs(p.y) < .98 && Math.abs(p.z) < 1, `actual vertex ${p.toArray()}`);
      }
    }
  });
}

test('tight fit contains projected vertices of nested rotated anisotropic instances and avoids the empty aggregate-box corners', () => {
  const group = new THREE.Group(), branch = new THREE.Group(); group.add(branch);
  group.position.set(1.7, -2, 3); group.rotation.set(.3, .8, -.1); branch.rotation.set(.2, .4, .85);
  const geometry = new THREE.BoxGeometry(.07, .4, .004), material = new THREE.MeshBasicMaterial();
  const leaves = new THREE.InstancedMesh(geometry, material, 100); branch.add(leaves);
  const transform = new THREE.Object3D();
  for (let i = 0; i < leaves.count; i++) {
    transform.position.set(0, i * .12, 0); transform.rotation.set(i * .1, .5, .3); transform.scale.set(1.2, .8, .5); transform.updateMatrix(); leaves.setMatrixAt(i, transform.matrix);
  }
  const cached = modelGeometryFrame(group, {leafBending: false});
  assert.ok(cached.cells.length <= 24 ** 3);
  let improvement = 0;
  for (const aspect of [.25, .65, 1, 2.4]) for (const view of [direction, new THREE.Vector3(-1, .2, 2)]) {
    const {camera, frame, range} = fit(cached, aspect, view);
    assertVertices(group, camera);
    const old = perspectiveBoundsFrame(modelBounds(group), view, 35, aspect);
    improvement = Math.max(improvement, 1 - frame.distance / old.distance);
    camera.position.copy(frame.target).addScaledVector(view.clone().normalize(), range.maxDistance);
    camera.lookAt(frame.target); camera.updateMatrixWorld(true);
    assertVertices(group, camera);
    assert.ok(range.near < range.minDistance * .02);
  }
  assert.ok(improvement > .15, `tight geometry recovers empty box space (${improvement})`);
  // Repeated resize/reset/containment must only touch the cached small hulls.
  leaves.getMatrixAt = () => { throw Error('no repeated instance scan'); };
  geometry.getAttribute = () => { throw Error('no repeated vertex scan'); };
  for (let i = 0; i < 30; i++) fit(cached, .3 + i * .1);
  leaves.dispose(); geometry.dispose(); material.dispose();
});

test('cached rest geometry contains compound bounded joint rotations and saturated blade displacement', () => {
  const root = new THREE.Group(), trunk = new THREE.Group(), twig = new THREE.Group();
  root.add(trunk); trunk.add(twig); twig.position.set(.1, 1, .05); twig.rotation.set(.2, 0, -.5);
  const geometry = new THREE.PlaneGeometry(.08, .5, 2, 12); geometry.translate(0, .25, 0);
  const material = new THREE.MeshBasicMaterial(), blade = new THREE.Mesh(geometry, material); twig.add(blade);
  blade.scale.set(1.1, 1.4, .6);
  blade.userData = {organ: 'leaf', connectedBy: 'petiole'};
  const rest = twig.quaternion.clone();
  const cached = modelGeometryFrame(root, {pivots: [trunk, twig]});
  for (const aspect of [.3, 2.4]) {
    const {camera} = fit(cached, aspect);
    for (let step = 0; step < 24; step++) {
      const a = step * Math.PI / 12;
      trunk.quaternion.setFromAxisAngle(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), .28);
      twig.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), .28));
      for (const sign of [-1, 1]) assertVertices(root, camera, (p, _mesh, matrix) => {
        const s = THREE.MathUtils.clamp(p.y / .5, 0, 1);
        const e = matrix.elements, sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
        p.z += sign * Math.min(2, .5 * sy) * .12 / sz * s * s * (6 - 4 * s + s * s) / 3; return p;
      });
    }
  }
  geometry.dispose(); material.dispose();
});

test('empty, degenerate and centimetre/14-metre geometry retain finite frames and scale-relative orbit/clip support', () => {
  fit({cells: [], bounds: new THREE.Box3()}, .2);
  fit({cells: [new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())], bounds: new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())}, .3);
  const axis = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(0, 0, 14));
  fit({cells: [axis], bounds: axis}, .3, new THREE.Vector3(0, 0, 1));
  for (const scale of [.01, 14]) {
    const group = new THREE.Group(), geometry = new THREE.BoxGeometry(scale * 2, scale, scale * .1), material = new THREE.MeshBasicMaterial();
    group.add(new THREE.Mesh(geometry, material));
    const cache = modelGeometryFrame(group);
    for (const aspect of [.22, 2.4]) {
      const {camera, frame, range} = fit(cache, aspect, new THREE.Vector3());
      assertVertices(group, camera); assert.ok(range.minDistance < frame.distance && range.maxDistance > frame.distance);
      camera.position.copy(frame.target); camera.lookAt(frame.target.clone().add(new THREE.Vector3(0, 0, 1))); camera.updateMatrixWorld(true);
      assert.equal(cameraContainsGeometry(cache, camera), false, 'geometry behind/intersecting the camera is not contained');
    }
    geometry.dispose(); material.dispose();
  }
});

test('100k leaf instances compact to occupied cells and repeated fitting never scans the plant again', t => {
  const group = new THREE.Group(), geometry = new THREE.PlaneGeometry(.04, .08), material = new THREE.MeshBasicMaterial();
  const leaves = new THREE.InstancedMesh(geometry, material, 100_000), matrix = new THREE.Matrix4(); group.add(leaves);
  for (let i = 0; i < leaves.count; i++) leaves.setMatrixAt(i, matrix.makeTranslation((i % 100) * .03, Math.floor(i / 1000) * .07, (Math.floor(i / 100) % 10) * .1));
  const start = performance.now(), cache = modelGeometryFrame(group), built = performance.now();
  assert.ok(cache.cells.length <= 32 ** 3 && cache.cells.length < leaves.count / 10);
  leaves.getMatrixAt = () => { throw Error('cached framing must not rescan 100k instances'); };
  geometry.getAttribute = () => { throw Error('cached framing must not rescan vertices'); };
  for (let i = 0; i < 20; i++) fit(cache, .3 + i * .1);
  t.diagnostic(`100k instances → ${cache.cells.length} cells; build ${(built - start).toFixed(1)} ms; 20 cached fits+containment ${(performance.now() - built).toFixed(1)} ms (CPU only)`);
  leaves.dispose(); geometry.dispose(); material.dispose();
});


test('material-coordinate herb strips reserve their own bounded displacement after merging',async()=>{
 const {tagLeafStrip}=await import('./herb-leaf-dynamics.ts');
 const {leafStripVertex}=await import('./leaf-dynamics.ts');
 const group=new THREE.Group(),geometry=tagLeafStrip(new THREE.PlaneGeometry(.003,.4,1,20).translate(0,.2,0),true),material=new THREE.MeshBasicMaterial();
 const leaf=new THREE.Mesh(geometry,material);leaf.userData={organ:'leaf',leafDynamics:'material-strip'};group.add(leaf);
 const cache=modelGeometryFrame(group);assert.ok(cache.bounds.max.z>.047&&cache.bounds.min.z<-.047,'reserve the actual per-blade 12% limit, independent of connectedBy metadata');
 for(const aspect of [.3,2.4]){
  const {camera}=fit(cache,aspect);
  for(const wind of [-12,12]){
   group.updateMatrixWorld(true);const p=geometry.getAttribute('position');
   for(let i=0;i<p.count;i++){
    const v=leafStripVertex(geometry,i,leaf.matrixWorld,wind,19.62,.2).position.applyMatrix4(leaf.matrixWorld).project(camera);
    assert.ok(Math.abs(v.x)<.98&&Math.abs(v.y)<.98&&Math.abs(v.z)<1);
   }
  }
 }
 geometry.dispose();material.dispose();
});
