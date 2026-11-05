import * as THREE from 'three';

const boxCorners = (box: THREE.Box3) => Array.from({length: 8}, (_, i) => new THREE.Vector3(
  i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
const usableBounds = (bounds: THREE.Box3) => bounds.isEmpty()
  ? new THREE.Box3(new THREE.Vector3(-.01, 0, -.01), new THREE.Vector3(.01, .02, .01)) : bounds;

/** Playback chooses interpolation, never camera ownership. Enlarged crowns must
 * fit immediately; interpolate only while the current view still contains them. */
export function cameraFrameAction(userControlled: boolean, autoFrame: boolean, currentFits: boolean, reclaim = false) {
  if (userControlled && !reclaim) return 'preserve';
  return !reclaim && autoFrame && currentFits ? 'ease' : 'snap';
}

/** Fit all eight corners in the actual perspective/aspect, in world metres.
 * direction points from the observation target toward the camera. */
export function perspectiveBoundsFrame(bounds: THREE.Box3, direction: THREE.Vector3, fov: number, aspect: number) {
  const box = usableBounds(bounds), target = box.getCenter(new THREE.Vector3());
  const backward = direction.lengthSq() > 0 ? direction.clone().normalize() : new THREE.Vector3(0, 0, 1);
  const basis = new THREE.Matrix4().lookAt(backward, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0), up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov) / 2), tanX = tanY * Math.max(.001, aspect);
  let distance = .001;
  for (const corner of boxCorners(box)) {
    const offset = corner.sub(target), z = offset.dot(backward);
    distance = Math.max(distance, z + Math.abs(offset.dot(right)) * 1.12 / tanX, z + Math.abs(offset.dot(up)) * 1.12 / tanY);
  }
  return {target, position: target.clone().addScaledVector(backward, distance), distance};
}

/** Cached-box check on rebuild/resize, never a per-frame mesh traversal. */
export function cameraContainsBounds(bounds: THREE.Box3, camera: THREE.PerspectiveCamera) {
  camera.updateMatrixWorld(true);
  return boxCorners(usableBounds(bounds)).every(point => {
    const p = point.project(camera);
    // Perspective depth is nonlinear: valid distant geometry often has z near
    // 1 even when it is far inside the clip volume. Margin applies only to XY.
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
      && Math.abs(p.x) < .98 && Math.abs(p.y) < .98 && p.z >= -1 && p.z <= 1;
  });
}

/** Scale-relative orbit/clip limits. Include the owned distance after shrinking
 * so applying new limits cannot pull the user's camera inward. The entire orbit
 * zoom range fits inside the clip range, including a panned observation target. */
export function perspectiveCameraRange(bounds: THREE.Box3, position: THREE.Vector3, target: THREE.Vector3, fitDistance = 0) {
  const box = usableBounds(bounds), center = box.getCenter(new THREE.Vector3());
  const scale = Math.max(.001, box.getSize(new THREE.Vector3()).length()), radius = scale / 2;
  const distance = position.distanceTo(target);
  const minDistance = Math.max(.000001, Math.min(scale * .02, distance * .5));
  const maxDistance = Math.max(scale * 12, fitDistance * 4, distance * 1.25);
  const near = Math.max(.0000001, Math.min(scale * .001, minDistance * .01));
  const far = maxDistance + target.distanceTo(center) + radius * 2;
  return {near, far, minDistance, maxDistance};
}

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

export {modelGeometryFrame,unionGeometryFrames,perspectiveGeometryFrame,cameraContainsGeometry} from './geometry-framing.ts';
