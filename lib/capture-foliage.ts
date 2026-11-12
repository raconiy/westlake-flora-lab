import * as THREE from 'three';
import {shadeAsLeaf} from './capture-materials.ts';

/**
 * Leaf laminae for captured crowns.
 *
 * The exported crowns place their blades correctly but draw each as a sliver a
 * few millimetres wide, so a crown reads as wire rather than as foliage. This
 * adds a lamina of realistic area at a deterministic subset of the exported
 * blade positions, taking each one's colour from the blade it stands on.
 * Laminae are parented to the limb that carries them and move with its wind
 * response. They add no wood, no attachment and no collision geometry, and the
 * exported leaf area used by the wind model is unchanged.
 *
 * Lamina size, inclination and outline are priors for a mid-sized broadleaf;
 * species are unresolved in this capture.
 */

const leafPattern = /broadleaf|foliage|leaf spray|blades/i;

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unit lamina: petiole end at the origin, tip at +Y, folded along the midrib and arched. */
export function laminaGeometry() {
  // Two rows keep the arch; a finer lamina costs more than it shows at leaf size.
  const columns = [-.5, 0, .5], rows = 2;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (const x of columns) {
      positions.push(x, v, Math.abs(x) * .32 - .1 * Math.sin(Math.PI * v));
      uvs.push(x + .5, v);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < 2; i++) {
    const a = j * 3 + i;
    indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface FoliageOptions {
  /** Upper bound on laminae per tree. */
  perTree?: number;
  /** Lamina length in metres, before per-leaf variation. */
  length?: number;
  seed?: number;
}

/**
 * Choose which exported blade vertices carry a lamina. Evenly strided with a
 * seeded offset, so the subset is stable between sessions and proportional to
 * the exported density everywhere in the crown.
 */
export function laminaSites(vertexCount: number, wanted: number, seed: number) {
  if (vertexCount <= 0 || wanted <= 0) return new Uint32Array(0);
  const count = Math.min(vertexCount, Math.floor(wanted));
  const stride = vertexCount / count, next = random(seed);
  const sites = new Uint32Array(count);
  for (let i = 0; i < count; i++) sites[i] = Math.min(vertexCount - 1, Math.floor((i + next()) * stride));
  return sites;
}

export function createCaptureFoliage(root: THREE.Object3D, options: FoliageOptions = {}) {
  const perTree = options.perTree ?? 40000, length = options.length ?? .095, seed = options.seed ?? 0x51f0a3;
  root.updateMatrixWorld(true);
  const geometry = laminaGeometry();
  const material = new THREE.MeshStandardMaterial({name: 'Leaf laminae', roughness: .46, metalness: 0, side: THREE.DoubleSide});
  shadeAsLeaf(material, {outline: true, gain: new THREE.Color(3.6, 2.5, 2.4)});
  const meshes: THREE.InstancedMesh[] = [];
  let laminae = 0, treeIndex = 0;
  const point = new THREE.Vector3(), colour = new THREE.Color(), toLimb = new THREE.Matrix4();
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  const tilt = new THREE.Euler();

  for (const tree of root.children) {
    if (!/^tree/i.test(tree.name)) continue;
    treeIndex++;
    // Group the exported blade meshes by the limb that moves them.
    const byLimb = new Map<THREE.Object3D, THREE.Mesh[]>();
    let vertices = 0;
    tree.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
      const first = Array.isArray(object.material) ? object.material[0] : object.material;
      if (!leafPattern.test(first.name)) return;
      let limb: THREE.Object3D | null = object;
      while (limb && limb.userData.wind_joint !== true) limb = limb.parent;
      const carrier = limb ?? tree;
      if (!byLimb.has(carrier)) byLimb.set(carrier, []);
      byLimb.get(carrier)!.push(object);
      vertices += object.geometry.getAttribute('position').count;
    });
    if (!vertices) continue;
    // At most one lamina per three exported blade vertices: sparse stand-in
    // crowns stay sparse instead of every vertex sprouting a leaf.
    const share = Math.min(1/3, perTree / vertices);
    let limbIndex = 0;
    for (const [limb, sources] of byLimb) {
      limbIndex++;
      const limbInverse = new THREE.Matrix4().copy(limb.matrixWorld).invert();
      const total = sources.reduce((sum, mesh) => sum + Math.floor(mesh.geometry.getAttribute('position').count * share), 0);
      if (!total) continue;
      const instanced = new THREE.InstancedMesh(geometry, material, total);
      instanced.name = limb.name + '.laminae';
      // Laminae receive but do not cast. The exported blades already carry the
      // crown's shadow; opaque lamina shadows at shadow-map resolution black out
      // the interior, which in a real crown is filled by penumbra and by light
      // transmitted through the leaves above.
      instanced.castShadow = false; instanced.receiveShadow = true;
      const next = random(seed ^ Math.imul(treeIndex, 0x9e3779b1) ^ Math.imul(limbIndex, 0x85ebca6b));
      let written = 0;
      for (const source of sources) {
        const position = source.geometry.getAttribute('position'), vertexColour = source.geometry.getAttribute('color');
        const flat = (Array.isArray(source.material) ? source.material[0] : source.material) as THREE.MeshStandardMaterial;
        toLimb.multiplyMatrices(limbInverse, source.matrixWorld);
        const sites = laminaSites(position.count, position.count * share, seed ^ source.id);
        for (const site of sites) {
          point.fromBufferAttribute(position, site).applyMatrix4(toLimb);
          // Leaves of a sunlit crown lie near horizontal with a broad spread;
          // the lamina hangs a little from its petiole.
          tilt.set(-Math.PI/2 + (next() - .5) * 1.5 + .25, next() * Math.PI * 2, (next() - .5) * 1.1, 'YXZ');
          quaternion.setFromEuler(tilt);
          const size = length * (.7 + .6 * next());
          scale.set(size * (.4 + .12 * next()), size, size);
          instanced.setMatrixAt(written, matrix.compose(point, quaternion, scale));
          if (vertexColour) colour.fromBufferAttribute(vertexColour, site);
          else colour.copy(flat.color);
          instanced.setColorAt(written, colour.multiplyScalar(.85 + .3 * next()));
          written++;
        }
      }
      instanced.count = written;
      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      instanced.computeBoundingSphere();
      limb.add(instanced);
      meshes.push(instanced);
      laminae += written;
    }
  }
  return {
    meshes, stats: {laminae},
    dispose() {
      for (const mesh of meshes) { mesh.removeFromParent(); mesh.dispose(); }
      geometry.dispose(); material.dispose();
    },
  };
}
