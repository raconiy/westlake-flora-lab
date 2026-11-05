import * as THREE from 'three';
import {LEAF_PRIORS} from './leaf-dynamics.ts';

type Cone = {vector: THREE.Vector3; length: number; cosine: number; sine: number};
type MotionChain = {origin: THREE.Vector3; segments: Cone[]; cosine: number; sine: number};
type MotionHull = {chain: MotionChain; tip: THREE.Vector3; length: number; radius: number};
type GeometryHull = THREE.Box3 | MotionHull;
/** Build-time occupied hulls. Repeated fit/resize reads only these numbers,
 * never geometry, instance matrices or live scene objects. */
export interface GeometryFrame {cells: GeometryHull[]; bounds: THREE.Box3;}
export interface GeometryFrameOptions {
  include?: (mesh: THREE.Mesh) => boolean;
  /** Rest-pose rigid beam pivots; .28 rad is the current solver's hard limit. */
  pivots?: readonly THREE.Object3D[];
  maxDeflectionRad?: number;
  leafBending?: boolean;
  /** Extra bounded displacement, e.g. the welded root collar's moving top ring. */
  displacement?: (mesh: THREE.Mesh) => number;
}

/** Maximum projection of a vector rotated by any axis through <= angle.
 * Includes solver saturation/overshoot rather than a percentage of tree height. */
function coneMaximum(component: number, length: number, cosine: number, sine: number) {
  if (component >= length * cosine) return length;
  return component * cosine + Math.sqrt(Math.max(0, length * length - component * component)) * sine;
}
const anglePair = (angle: number) => ({cosine: Math.cos(Math.min(Math.PI, angle)), sine: Math.sin(Math.min(Math.PI, angle))});

function support(frame: GeometryFrame, axis: THREE.Vector3) {
  let maximum = -Infinity;
  const magnitude = axis.length(), prefixes = new Map<MotionChain, number>();
  for (const hull of frame.cells) {
    if (hull instanceof THREE.Box3) {
      maximum = Math.max(maximum, axis.x * (axis.x >= 0 ? hull.max.x : hull.min.x)
        + axis.y * (axis.y >= 0 ? hull.max.y : hull.min.y) + axis.z * (axis.z >= 0 ? hull.max.z : hull.min.z));
    } else {
      const {chain} = hull;
      let prefix = prefixes.get(chain);
      if (prefix === undefined) {
        prefix = chain.origin.dot(axis);
        for (const segment of chain.segments) prefix += coneMaximum(segment.vector.dot(axis), segment.length * magnitude, segment.cosine, segment.sine);
        prefixes.set(chain, prefix);
      }
      maximum = Math.max(maximum, prefix + coneMaximum(hull.tip.dot(axis), hull.length * magnitude, chain.cosine, chain.sine) + hull.radius * magnitude);
    }
  }
  return maximum;
}

export function modelGeometryFrame(group: THREE.Object3D, options: GeometryFrameOptions = {}): GeometryFrame {
  group.updateWorldMatrix(true, true);
  const include = options.include ?? (() => true), meshes: THREE.Mesh[] = [];
  const coarse = new THREE.Box3(), box = new THREE.Box3();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !include(object)) return;
    meshes.push(object);
    if (object instanceof THREE.InstancedMesh) {
      if (!object.boundingBox) object.computeBoundingBox();
      box.copy(object.boundingBox!);
    } else {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      box.copy(object.geometry.boundingBox!);
    }
    coarse.union(box.applyMatrix4(object.matrixWorld));
  });
  const size = coarse.getSize(new THREE.Vector3()), step = Math.max(1e-9, Math.max(size.x, size.y, size.z) / 32);
  const pivots = new Set(options.pivots), angle = options.maxDeflectionRad ?? .28;
  const chains = new Map<THREE.Object3D, MotionChain>();
  const occupied = new Map<number, {box: THREE.Box3; chain?: MotionChain; pivot?: THREE.Vector3; radius: number}>();
  const point = new THREE.Vector3(), instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position'); if (!position) continue;
    const owners: THREE.Object3D[] = [];
    for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) if (pivots.has(parent)) owners.unshift(parent);
    const owner = owners.at(-1);
    let chain = owner ? chains.get(owner) : undefined;
    if (owner && !chain) {
      const points = owners.map(pivot => pivot.getWorldPosition(new THREE.Vector3()));
      chain = {origin: points[0], segments: [], ...anglePair(angle * points.length)};
      for (let i = 1; i < points.length; i++) {
        const vector = points[i].clone().sub(points[i - 1]);
        chain.segments.push({vector, length: vector.length(), ...anglePair(angle * i)});
      }
      chains.set(owner, chain);
    }
    const pivot = owner?.getWorldPosition(new THREE.Vector3());
    const blade = options.leafBending !== false && mesh.userData.organ === 'leaf' && mesh.userData.connectedBy === 'petiole' && !Array.isArray(mesh.material);
    // Instance bounds need not have populated the geometry's own local box.
    if (blade && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const span = mesh.geometry.boundingBox?.max.y ?? 0, extraRadius = options.displacement?.(mesh) ?? 0;
    const strip = options.leafBending !== false && mesh.userData.organ === 'leaf' && mesh.userData.leafDynamics === 'material-strip' ? mesh.geometry.getAttribute('leafMaterial') : undefined;
    const count = mesh instanceof THREE.InstancedMesh ? mesh.count : 1;
    for (let i = 0; i < count; i++) {
      if (mesh instanceof THREE.InstancedMesh) { mesh.getMatrixAt(i, instance); world.multiplyMatrices(mesh.matrixWorld, instance); }
      else world.copy(mesh.matrixWorld);
      const e = world.elements;
      const leafRadius = blade && span > 1e-6 ? LEAF_PRIORS.maxTipRatio * Math.min(2, span * Math.hypot(e[4], e[5], e[6])) : 0;
      for (let v = 0; v < position.count; v++) {
        point.fromBufferAttribute(position, v).applyMatrix4(world);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
        const x = THREE.MathUtils.clamp(Math.floor((point.x - coarse.min.x) / step), 0, 31);
        const y = THREE.MathUtils.clamp(Math.floor((point.y - coarse.min.y) / step), 0, 31);
        const z = THREE.MathUtils.clamp(Math.floor((point.z - coarse.min.z) / step), 0, 31);
        // Shared cells per dynamic owner, independent of leaf/instance count.
        const key = (owner ? owner.id + 1 : 0) * 32 ** 3 + x + 32 * (y + 32 * z);
        let cell = occupied.get(key);
        if (!cell) { cell = {box: new THREE.Box3(), chain, pivot, radius: 0}; occupied.set(key, cell); }
        cell.box.expandByPoint(point);
        const s = strip ? THREE.MathUtils.clamp(strip.getX(v),0,1) : span > 0 ? THREE.MathUtils.clamp(position.getY(v) / span, 0, 1) : 0;
        const bladeRadius = strip ? LEAF_PRIORS.maxTipRatio * Math.min(2,strip.getY(v)*Math.hypot(e[4],e[5],e[6])) : leafRadius;
        cell.radius = Math.max(cell.radius, extraRadius + bladeRadius * s * s * (6 - 4 * s + s * s) / 3);
      }
    }
  }
  const cells: GeometryHull[] = [];
  for (const {box: cell, chain, pivot, radius} of occupied.values()) {
    if (chain && pivot) {
      const tip = cell.getCenter(new THREE.Vector3()).sub(pivot);
      cells.push({chain, tip, length: tip.length(), radius: cell.getSize(new THREE.Vector3()).length() / 2 + radius});
    } else cells.push(cell.expandByScalar(radius));
  }
  const frame = {cells, bounds: new THREE.Box3()};
  if (cells.length) for (let axis = 0; axis < 3; axis++) {
    const vector = new THREE.Vector3().setComponent(axis, 1);
    frame.bounds.max.setComponent(axis, support(frame, vector));
    frame.bounds.min.setComponent(axis, -support(frame, vector.negate()));
  }
  return frame;
}

export function unionGeometryFrames(...frames: GeometryFrame[]): GeometryFrame {
  const bounds = new THREE.Box3();
  for (const frame of frames) bounds.union(frame.bounds);
  return {cells: frames.flatMap(frame => frame.cells), bounds};
}

/** Solve four perspective half-space constraints with a free screen centre.
 * Motion support is evaluated along each actual projection constraint: no
 * rotated global AABB and no empty corners of axis-aligned wind envelopes. */
export function perspectiveGeometryFrame(geometry: GeometryFrame, direction: THREE.Vector3, fov: number, aspect: number) {
  const frame = geometry.cells.length ? geometry : {cells: [new THREE.Box3(new THREE.Vector3(-.01, 0, -.01), new THREE.Vector3(.01, .02, .01))], bounds: geometry.bounds};
  const backward = direction.lengthSq() ? direction.clone().normalize() : new THREE.Vector3(0, 0, 1);
  const basis = new THREE.Matrix4().lookAt(backward, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0), up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
  const ky = 1.08 / Math.tan(THREE.MathUtils.degToRad(fov) / 2), kx = ky / Math.max(.001, aspect);
  const plusX = support(frame, backward.clone().addScaledVector(right, kx)), minusX = support(frame, backward.clone().addScaledVector(right, -kx));
  const plusY = support(frame, backward.clone().addScaledVector(up, ky)), minusY = support(frame, backward.clone().addScaledVector(up, -ky));
  const front = support(frame, backward), depth = (front - support(frame, backward.clone().negate())) / 2;
  const target = right.multiplyScalar((plusX - minusX) / (2 * kx)).addScaledVector(up, (plusY - minusY) / (2 * ky)).addScaledVector(backward, depth);
  // An end-on axis can have zero projected width/height. Leave at least the
  // scale-relative near-plane ceiling used by perspectiveCameraRange.
  const clearance = Math.max(1e-6, geometry.bounds.isEmpty() ? .001 : geometry.bounds.getSize(new THREE.Vector3()).length() * .001);
  const distance = Math.max(clearance, (plusX + minusX) / 2 - depth, (plusY + minusY) / 2 - depth, front - depth + clearance);
  return {target, position: target.clone().addScaledVector(backward, distance), distance};
}

/** Full containment (not frustum intersection), including clip depth. */
export function cameraContainsGeometry(geometry: GeometryFrame, camera: THREE.PerspectiveCamera) {
  if (!geometry.cells.length) return false;
  camera.updateMatrixWorld(true);
  const projection = camera.projectionMatrix.clone(), e = projection.elements;
  for (const i of [0, 4, 8, 12, 1, 5, 9, 13]) e[i] /= .98;
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projection.multiply(camera.matrixWorldInverse));
  return frustum.planes.every(plane => -support(geometry, plane.normal.clone().negate()) + plane.constant >= 0);
}
