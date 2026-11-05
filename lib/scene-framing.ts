import * as THREE from 'three';

/** World-space metres. Called on model rebuild, never from the animation loop.
 * InstancedMesh caches its local bounds, so subsequent framing needs no leaf scan. */
export function modelBounds(group: THREE.Object3D, include = (_mesh: THREE.Mesh) => true) {
  group.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3(), box = new THREE.Box3();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !include(object)) return;
    if (object instanceof THREE.InstancedMesh) {
      if (!object.boundingBox) object.computeBoundingBox();
      box.copy(object.boundingBox!);
    } else {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      box.copy(object.geometry.boundingBox!);
    }
    bounds.union(box.applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

/** Rendering heuristics, not empirical plant parameters. Fit in light space,
 * including the cast footprint on the receiving ground (not the entire stage).
 * focus narrows XY for a stem close-up while retaining upstream caster depth. */
export function directionalShadowFrame(bounds: THREE.Box3, direction: THREE.Vector3, mapSize: number, groundY?: number, focus?: THREE.Box3) {
  const box = bounds.isEmpty() ? new THREE.Box3(new THREE.Vector3(-.01, 0, -.01), new THREE.Vector3(.01, .02, .01)) : bounds.clone();
  const corners = (b: THREE.Box3) => Array.from({length: 8}, (_, i) => new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
  const points = corners(box), ray = direction.clone().normalize();
  if (groundY !== undefined && ray.y > .01) for (const point of [...points]) {
    if (point.y >= groundY) points.push(point.clone().addScaledVector(ray, -(point.y - groundY) / ray.y));
  }
  const world = new THREE.Box3().setFromPoints(points), target = world.getCenter(new THREE.Vector3());
  const scale = Math.max(.005, world.getSize(new THREE.Vector3()).length());
  const position = target.clone().addScaledVector(ray, scale * 2);
  const view = new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0));
  view.setPosition(position).invert();
  const lightBox = new THREE.Box3().setFromPoints(points.map(p => p.applyMatrix4(view)));
  const xy = focus ? new THREE.Box3().setFromPoints(corners(focus).map(p => p.applyMatrix4(view))) : lightBox;
  const span = Math.max(.005, xy.max.x - xy.min.x, xy.max.y - xy.min.y), margin = span * .06;
  const left = xy.min.x - margin, right = xy.max.x + margin, bottom = xy.min.y - margin, top = xy.max.y + margin;
  const near = Math.max(scale * .001, -lightBox.max.z - scale * .06), far = -lightBox.min.z + scale * .06;
  const texel = Math.max(right - left, top - bottom) / mapSize;
  return {position, target, left, right, bottom, top, near, far,
    // Normal offset is in metres; depth bias is normalized by the fitted range.
    // Keep the lightward depth offset larger than the normal offset: on the
    // reverse side of a thin blade its vertex normal can point away from light.
    normalBias: texel * .2, bias: -texel * .35 / (far - near), texel};
}
