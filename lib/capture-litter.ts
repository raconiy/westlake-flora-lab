import * as THREE from 'three';
import {laminaGeometry} from './capture-foliage.ts';
import {shadeAsLeaf} from './capture-materials.ts';
import {isMeadowPoint, meadowCoreBounds} from './capture-meadow-layout.ts';

/**
 * Fallen leaves on the lawn. The photographs show the turf scattered with
 * yellowed leaves, denser beneath the crowns; a lawn without them reads as
 * synthetic. Leaves lie on the grass tips, inside the lawn only (never on
 * paving or inside a stem), with a fixed seed.
 *
 * Counts and the fall-off with distance from each stem are priors read off the
 * photographs by eye; no leaf was counted. Litter is static and has no
 * collision or wind response.
 */
export interface LitterOptions { seed?: number; perTree?: number; scattered?: number; restHeight?: number }

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ground positions [x, z, ...] for litter around the given stems and across the lawn core. */
export function litterSites(stems: ArrayLike<readonly [number, number]>, options: LitterOptions = {}) {
  const next = random(options.seed ?? 0x1eaf17), perTree = options.perTree ?? 520, scattered = options.scattered ?? 2600;
  const sites: number[] = [];
  const place = (x: number, z: number, clearOf: number) => {
    if (!isMeadowPoint(x, z, .12)) return;
    for (let i = 0; i < stems.length; i++) if (Math.hypot(x - stems[i][0], z - stems[i][1]) < clearOf) return;
    sites.push(x, z);
  };
  for (let s = 0; s < stems.length; s++) {
    for (let i = 0; i < perTree; i++) {
      // Most leaves land under the crown; a tail drifts farther.
      const reach = 5.5 * Math.sqrt(-Math.log(1 - next() * .98)), bearing = next() * Math.PI * 2;
      place(stems[s][0] + reach * Math.cos(bearing), stems[s][1] + reach * Math.sin(bearing), .45);
    }
  }
  const b = meadowCoreBounds;
  for (let i = 0; i < scattered; i++) place(b.minX + next() * (b.maxX - b.minX), b.minZ + next() * (b.maxZ - b.minZ), .45);
  return Float32Array.from(sites);
}

export function createCaptureLitter(root: THREE.Object3D, options: LitterOptions = {}) {
  root.updateMatrixWorld(true);
  const stems: [number, number][] = [];
  const at = new THREE.Vector3();
  for (const tree of root.children) if (/^tree/i.test(tree.name)) { tree.getWorldPosition(at); stems.push([at.x, at.z]); }
  const sites = litterSites(stems, options), count = sites.length / 2;
  const geometry = laminaGeometry();
  const material = new THREE.MeshStandardMaterial({name: 'Fallen leaves', roughness: .7, metalness: 0, side: THREE.DoubleSide});
  // Senescent laminae: chlorophyll gone, so little green-shifted transmission.
  shadeAsLeaf(material, {outline: true, gain: new THREE.Color(1, 1, 1), transmission: new THREE.Color(.5, .42, .12)});
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.name = 'Fallen leaves';
  mesh.count = count;
  mesh.castShadow = false; mesh.receiveShadow = true;
  const next = random((options.seed ?? 0x1eaf17) ^ 0x5bd1e995), rest = options.restHeight ?? .055;
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), tilt = new THREE.Euler();
  const colour = new THREE.Color();
  // Yellow through tan to brown, as linear reflectance.
  const palette = [new THREE.Color(.40, .33, .09), new THREE.Color(.34, .25, .08), new THREE.Color(.24, .17, .07), new THREE.Color(.30, .31, .10)];
  for (let i = 0; i < count; i++) {
    // Lying nearly flat on the grass tips, slightly propped.
    tilt.set(-Math.PI/2 + (next() - .5) * .5, next() * Math.PI * 2, (next() - .5) * .4, 'YXZ');
    quaternion.setFromEuler(tilt);
    const size = .06 + .05 * next();
    scale.set(size * (.42 + .12 * next()), size, size);
    at.set(sites[i*2], rest + .02 * next(), sites[i*2 + 1]);
    mesh.setMatrixAt(i, matrix.compose(at, quaternion, scale));
    const a = palette[Math.floor(next() * palette.length)], b = palette[Math.floor(next() * palette.length)];
    mesh.setColorAt(i, colour.copy(a).lerp(b, next()).multiplyScalar(.8 + .4 * next()));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return {mesh, stats: {leaves: count}, dispose() { mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); material.dispose(); }};
}
