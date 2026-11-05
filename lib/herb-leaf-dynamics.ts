import * as THREE from 'three';

/** Rest/material coordinates, never inferred from the bounds of a merged tuft.
 * s is centreline arc fraction; L is rest arc length in local metres. The
 * gradient is ds/dp. A representative mid-blade normal defines a single weak
 * bending plane: this is a strip proxy, not an anisotropic shell model.
 * Frames support the rigid/uniform-scale transforms used by these herbs.
 */
export const STRIP_ATTRIBUTES = { leafMaterial: 2, leafBase: 3, leafLoadNormal: 3, leafGradient: 3 } as const;
export function tagLeafStrip(geometry: THREE.BufferGeometry, planar = false) {
  const p = geometry.getAttribute('position'), count = p.count;
  const coords: number[] = [], bases: number[] = [], normals: number[] = [], gradients: number[] = [];
  const base = new THREE.Vector3(), normal = new THREE.Vector3(0, 0, 1);
  let length = 0;
  const centres: THREE.Vector3[] = [], distances = [0];
  if (planar) {
    geometry.computeBoundingBox(); base.y = geometry.boundingBox!.min.y; length = geometry.boundingBox!.max.y - base.y;
  } else {
    for (let i = 0; i < count; i += 3) {
      const centre = new THREE.Vector3().fromBufferAttribute(p, i).add(new THREE.Vector3().fromBufferAttribute(p, i + 2)).multiplyScalar(.5);
      if (centres.length) distances.push(distances.at(-1)! + centre.distanceTo(centres.at(-1)!));
      centres.push(centre);
    }
    if (centres.length) base.copy(centres[0]); length = distances.at(-1)!;
    if (centres.length > 1) {
      const mid = Math.floor(centres.length / 2), width = new THREE.Vector3().fromBufferAttribute(p, mid * 3 + 2).sub(new THREE.Vector3().fromBufferAttribute(p, mid * 3));
      const candidate = new THREE.Vector3().crossVectors(width, centres[Math.min(mid + 1, centres.length - 1)].clone().sub(centres[Math.max(0, mid - 1)]));
      if (candidate.lengthSq() > 0) normal.copy(candidate).normalize();
    }
  }
  length = Math.max(length, 1e-8);
  for (let i = 0; i < count; i++) {
    const ring = Math.floor(i / 3), s = planar ? (p.getY(i) - base.y) / length : distances[ring] / length;
    const gradient = new THREE.Vector3(0, planar ? 1 / length : 0, 0);
    if (!planar) {
      const lo = Math.max(0, ring - 1), hi = Math.min(ring + 1, centres.length - 1);
      const ds = (distances[hi] - distances[lo]) / length;
      if (ds > 0) {
        const column = i % 3;
        const longitudinal = new THREE.Vector3().fromBufferAttribute(p, hi * 3 + column).sub(new THREE.Vector3().fromBufferAttribute(p, lo * 3 + column)).divideScalar(ds);
        // One-sided width at either edge retains the raised midrib; the
        // middle vertex uses the centred width derivative across both sides.
        const width = new THREE.Vector3().fromBufferAttribute(p, ring * 3 + Math.min(column + 1, 2)).sub(new THREE.Vector3().fromBufferAttribute(p, ring * 3 + Math.max(column - 1, 0)));
        // Minimum tangent dual: g.U=0, g.(dP/ds)=1. A centreline unit
        // tangent / L is not ds/dp when width crosses the longitudinal axis.
        gradient.copy(longitudinal);
        if (width.lengthSq() > 0) {
          width.normalize(); gradient.addScaledVector(width, -gradient.dot(width));
        }
        const transverseSq = gradient.lengthSq();
        // Zero width leaves the longitudinal dual; a collapsed or nearly
        // collinear frame has no stable dual, so use a finite zero gradient.
        if (transverseSq > Math.max(1e-16, longitudinal.lengthSq() * 1e-12)) gradient.divideScalar(transverseSq);
        else gradient.set(0, 0, 0);
      }
    }
    coords.push(s, length); bases.push(...base.toArray()); normals.push(...normal.toArray()); gradients.push(...gradient.toArray());
  }
  geometry.setAttribute('leafMaterial', new THREE.Float32BufferAttribute(coords, 2));
  geometry.setAttribute('leafBase', new THREE.Float32BufferAttribute(bases, 3));
  geometry.setAttribute('leafLoadNormal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('leafGradient', new THREE.Float32BufferAttribute(gradients, 3));
  return geometry;
}

/** Match the existing generator's nonindexed merge without touching its wood
 * sections or geometry. Build before that merge disposes its temporary parts. */
export function mergedLeafStripAttributes(parts: THREE.BufferGeometry[]) {
  return Object.fromEntries(Object.entries(STRIP_ATTRIBUTES).map(([name, size]) => {
    const values: number[] = [];
    for (const g of parts) {
      const attribute = g.getAttribute(name), index = g.index;
      for (let i = 0; i < (index?.count ?? attribute.count); i++) {
        const vertex = index ? index.getX(i) : i;
        for (let j = 0; j < size; j++) values.push(attribute.getComponent(vertex, j));
      }
    }
    return [name, new THREE.Float32BufferAttribute(values, size)];
  }));
}
