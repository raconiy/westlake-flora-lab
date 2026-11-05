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
    base.copy(centres[0]); length = distances.at(-1)!;
    const mid = Math.floor(centres.length / 2), width = new THREE.Vector3().fromBufferAttribute(p, mid * 3 + 2).sub(new THREE.Vector3().fromBufferAttribute(p, mid * 3));
    normal.crossVectors(width, centres[mid + 1].clone().sub(centres[mid - 1])).normalize();
  }
  length = Math.max(length, 1e-8);
  for (let i = 0; i < count; i++) {
    const ring = Math.floor(i / 3), s = planar ? (p.getY(i) - base.y) / length : distances[ring] / length;
    const gradient = planar ? new THREE.Vector3(0, 1 / length, 0) : centres[Math.min(ring + 1, centres.length - 1)].clone().sub(centres[Math.max(0, ring - 1)]).normalize().divideScalar(length);
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
