import * as THREE from 'three';
// @ts-ignore Explicit suffix is required by the native Node TypeScript test runner.
import { osmanthusLifecycle, osmanthusPriors, osmanthusGrowth } from './osmanthus-lifecycle.ts';

/** A botanical illustration, not a measured root reconstruction or soil-water solver. */
export type RootSpecies = 'ginkgo' | 'osmanthus' | 'iris' | 'oxalis';
export interface RhizosphereParams {
  age: number; seed: number;
  /** Relative soil moisture and compaction, each 0–1; uncalibrated. */
  moisture: number; compaction: number;
  /** Available soil profile depth, metres. */
  soilDepth: number; cutaway: boolean;
}
export interface RhizosphereModel {
  group: THREE.Group;
  /** Maximum root centreline depth and summed drawn-axis lengths, metres.
   * rootTips counts drawn axis ends, not all biological root tips in a living plant. */
  rootDepth: number; rootLength: number; rootTips: number;
  /** Relative availability / stress, 0–1, not measured water volume. */
  availableWater: number; waterStress: number;
  dispose(): void;
}
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const finite = (x: number, fallback: number) => Number.isFinite(x) ? x : fallback;
function randomSource(seed: number) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** Curved root with continuous rings and a tapered tip; no detached cylinder joints. */
function taperedTube(points: THREE.Vector3[], radius: number, sides: number, segments: number) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segments, false);
  const vertices: number[] = [], indices: number[] = [], colors: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, p = curve.getPointAt(t), r = radius * (.035 + .965 * Math.pow(1 - t, .84));
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      const q = p.clone().addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r);
      vertices.push(q.x, q.y, q.z);
      const light = .73 + .22 * t + .055 * Math.sin(j * 2.9 + i * 1.7);
      colors.push(light, light, light);
      if (i < segments && j < sides) {
        const n = i * (sides + 1) + j;
        indices.push(n, n + sides + 1, n + 1, n + 1, n + sides + 1, n + sides + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return { geometry: g, curve };
}

/** Three illustrative strata with fine world-scale aggregate textures; no DOM/canvas dependency. */
function soilLayer(width: number, depth: number, thickness: number, bottom: number, color: string, half: boolean, seed: number) {
  const zDepth = half ? width * .5 : width;
  const geometry = new THREE.BoxGeometry(width, thickness, zDepth, 32, 9, 20);
  const pos = geometry.attributes.position, normals=geometry.attributes.normal, uv=geometry.attributes.uv, base = new THREE.Color(color), colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const noise = Math.sin(x * 91.7 + y * 173.3 + z * 67.9 + seed) * 43758.5453;
    const fine = noise - Math.floor(noise), bands = Math.sin((y + bottom) / depth * 145 + Math.sin(x * 11) * .2);
    const c = base.clone().multiplyScalar(.94 + fine * .04 + bands * .018);
    const nx=Math.abs(normals.getX(i)),ny=Math.abs(normals.getY(i));uv.setXY(i,(nx>.5?z:x)*2.5,(ny>.5?z:y+bottom)*2.5);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // Millimetre-scale aggregate texture in world-space UVs; avoid metre-sized
  // triangular colour noise being mistaken for the structure of a soil profile.
  const textureRandom=randomSource(seed+71),size=128,pixels=new Uint8Array(size*size*4);
  for(let i=0;i<size*size;i++){const n=textureRandom(),v=n>.975?246:n<.05?118:184+n*42;pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=v;pixels[i*4+3]=255;}
  const map=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', map, bumpMap:map,bumpScale:.001,vertexColors: true, roughness: 1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, bottom + thickness / 2, half ? width / 4 + .002 : 0);
  mesh.userData = { organ: 'soil', sourceType: 'engineering-prior' };
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRhizosphere(species: RootSpecies, params: RhizosphereParams): RhizosphereModel {
  if (!['ginkgo', 'osmanthus', 'iris', 'oxalis'].includes(species)) throw new Error('Unknown root species');
  const age = clamp(finite(params.age, 0), 0, 1500), seed = finite(params.seed, 42);
  const moisture = clamp(finite(params.moisture, .55)), compaction = clamp(finite(params.compaction, .2));
  const soilDepth = clamp(finite(params.soilDepth, 1.6), .05, 8), random = randomSource(seed);
  const group = new THREE.Group(); group.name = `rhizosphere:${species}`;
  const availableWater = clamp((moisture - .08) / .58) * (1 - .62 * compaction) * clamp(soilDepth / .8, .2, 1);
  // Saturation may reduce aeration; this is an illustrative stress proxy, not hydraulic simulation.
  const waterStress = clamp(1 - availableWater + Math.max(0, moisture - .91) * 2.5);
  const expansion = (.56 + .44 * availableWater) * (1 - .46 * compaction);
  const woody = species === 'ginkgo' || species === 'osmanthus';
  const osmanthus = species === 'osmanthus' ? osmanthusLifecycle(age) : null;
  const development = woody ? 1 - Math.exp(-age / 9) : 1 - Math.exp(-age / .65);
  const germination = clamp((age - .012) / .08);
  const reach = woody ? (.035 + development * (species === 'ginkgo' ? 3.9 : 2.5)) * expansion : (.025 + development * (species === 'iris' ? .36 : .48)) * expansion;
  const maxDepth = Math.min(soilDepth * .96, woody ? (.018 + development * (species === 'ginkgo' ? 2.15 : 1.12)) * expansion : (.025 + development * (species === 'iris' ? .28 : .14)) * expansion);
  const rootColor = woody ? '#967349' : '#d9c6a0';
  const coarseMat = new THREE.MeshStandardMaterial({ color: rootColor, roughness: .95, vertexColors: true });
  const fineMat = new THREE.MeshStandardMaterial({ color: '#e2ca96', roughness: 1, vertexColors: true });
  const rhizomeMat = new THREE.MeshStandardMaterial({ color: species === 'iris' ? '#bba267' : '#a5aa64', roughness: .92, vertexColors: true });
  const allMaterials: THREE.Material[] = [coarseMat, fineMat, rhizomeMat];
  const geometries: THREE.BufferGeometry[] = [];
  let rootDepth = 0, rootLength = 0, rootTips = 0;
  group.userData = {
    sourceType: 'engineering-prior', calibrated: false, units: 'metres',
    note: '根系空间、相对水分和压实响应均未校准；土壤纹理不代表校园土层；根尖计数仅为绘制根轴末端数。',
    metricsMeaning: { rootLength: 'sum-of-drawn-root-axis-lengths', rootTips: 'drawn-root-axis-end-count', availableWater: 'relative-illustration-index-not-hydraulic-solver' },
    soilDepth, moisture, compaction, cutaway: params.cutaway,
    architecture: species === 'ginkgo' ? 'primary-root-with-laterals' : species === 'osmanthus' ? 'generalized-lateral-root-system' : species === 'iris' ? 'horizontal-rhizome-and-fibrous-roots' : 'stolon-node-adventitious-roots'
  };
  if (osmanthus) Object.assign(group.userData, { lifecycle: osmanthus, priors: osmanthusPriors, architecture: 'emerging-primary-radicle-then-staggered-laterals' });
  if (species === 'ginkgo') group.userData.collarTransition = {
    source: 'project engineering continuity construction, not empirical growth data', unit: 'years and metres',
    scope: 'buried-seed lower pole to established ginkgo root collar', confidence: 'low',
    calibration: 'uncalibrated-engineering-prior', intervalYears: [.55, .95],
  };
  function addRoot(points: THREE.Vector3[], radius: number, order: number, organ = 'root') {
    // The centreline cannot cross above the soil or below the supplied profile.
    radius = Math.min(radius, soilDepth * .12);
    points = points.map(p => new THREE.Vector3(p.x, clamp(p.y, -soilDepth + radius + .0001, osmanthus ? -.00005 : -.002 - radius), p.z));
    const built = taperedTube(points, radius, order < 2 ? 8 : 5, order < 2 ? 24 : 12);
    // Avoid spline overshoot protruding above the soil or through a shallow hard boundary.
    const positions = built.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setY(i, clamp(positions.getY(i), -soilDepth + .00005, -.00005));
    built.geometry.computeVertexNormals();
    const material = organ === 'rhizome' ? rhizomeMat : order > 1 ? fineMat : coarseMat;
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = `${organ}:order:${order}`;
    mesh.userData = { organ, order, sourceType: 'engineering-prior', start: points[0].toArray(), end: points.at(-1)!.toArray(), radius };
    mesh.castShadow = order < 2; group.add(mesh); geometries.push(built.geometry);
    if (organ === 'root') {
      rootLength += built.curve.getLength(); rootTips++;
      for (const p of built.curve.getPoints(24)) rootDepth = Math.max(rootDepth, Math.min(soilDepth - .00005, -p.y));
    }
    return built.curve;
  }
  function laterals(parent: THREE.CatmullRomCurve3, count: number, length: number, radius: number, order: number, phase: number) {
    for (let j = 0; j < count; j++) {
      const t = .12 + j / Math.max(1, count - 1) * .77;
      const start = parent.getPointAt(t), angle = phase + j * 2.39996 + (random() - .5) * .6;
      const len = length * (.45 + random() * .55) * (1 - t * .38);
      const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * len, -len * (.35 + random() * .5), Math.sin(angle) * len));
      end.y = Math.max(-soilDepth * .96, end.y);
      const mid = start.clone().lerp(end, .48).add(new THREE.Vector3((random() - .5) * len * .24, len * .045, (random() - .5) * len * .24));
      const curve = addRoot([start, mid, end], radius * (.8 + random() * .4), order);
      if (order === 1 && (species !== 'ginkgo' || age > .2)) laterals(curve, 3 + Math.floor(random() * 3), len * .45, radius * .28, 2, angle + .8);
    }
  }
  if (age > .012) {
    if (osmanthus) {
      const radius = osmanthus.radius * .9 + .00035 * osmanthus.radicle;
      const origin = new THREE.Vector3(0, osmanthus.rootOriginY, 0);
      const depth = maxDepth * osmanthus.radicle;
      const primary = addRoot([origin, origin.clone().add(new THREE.Vector3(.02 * development * osmanthus.radicle, -depth * .45, 0)), origin.clone().add(new THREE.Vector3(-.03 * development * osmanthus.radicle, -depth, .02 * development * osmanthus.radicle))], radius, 0);
      // Fixed attachment fractions and per-cohort RNG keep existing roots stable
      // when another cohort is born. New axes expand from zero length AND radius.
      function cohortLaterals(parent: THREE.CatmullRomCurve3, length: number, r: number, birth: number, count: number, key: number, order: number) {
        for (let i = 0; i < count; i++) {
          const growth = osmanthusGrowth(birth + i * .18, birth + i * .18 + .5, age);
          if (growth <= 0) continue;
          const rr = randomSource(key + i * 127), angle = i * 2.39996 + rr() * .5;
          const start = parent.getPointAt(.18 + .68 * (i + .5) / count), len = length * (.65 + rr() * .35) * growth;
          const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * len, -len * .55, Math.sin(angle) * len));
          const mid = start.clone().lerp(end, .5).add(new THREE.Vector3(len * .06, 0, -len * .04));
          const curve = addRoot([start, mid, end], r * Math.sqrt(growth), order);
          if (order === 1) cohortLaterals(curve, len * .35, r * .27, birth + i * .18 + .65, 3, key + i * 311, 2);
        }
      }
      cohortLaterals(primary, reach * .45, radius * .32, .12, 5, seed * 811, 1);
      for (let i = 0; i < 10; i++) {
        const birth = .8 + i * .5, growth = osmanthusGrowth(birth, birth + 1.6, age);
        if (growth <= 0) continue;
        const rr = randomSource(seed * 3253 + i * 197), angle = i * 2.39996 + (rr() - .5) * .4;
        const length = reach * (.65 + rr() * .35) * growth;
        // Root collar is the same coordinate as the shoot; no seven-axis mature
        // root crown at germination. The primary remains present throughout.
        const start = new THREE.Vector3(0, osmanthus.collarY, 0);
        const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * length, -maxDepth * (.3 + rr() * .35) * growth, Math.sin(angle) * length));
        const curve = addRoot([start, start.clone().lerp(end, .3).add(new THREE.Vector3(0, -length * .05, 0)), end], radius * .55 * Math.sqrt(growth), 1);
        cohortLaterals(curve, length * .29, radius * .16 * Math.sqrt(growth), birth + .3, 9, seed * 617 + i * 997, 2);
      }
    } else if (woody) {
      const radius = (.0011 + development * (species === 'ginkgo' ? .065 : .044)) * Math.max(.12, germination);
      if (species === 'ginkgo') {
        // Embryonic radicle first; do not give an opening seed a miniature mature root crown.
        // Onsets are illustrative priors; actual emergence depends on seed history and environment.
        const d = Math.max(.00001, maxDepth * germination);
        const seedLoss = clamp((age - .25) / .4), seedScale = 1 - seedLoss * seedLoss * (3 - 2 * seedLoss) * .7;
        // The seed is centred at -18 mm with a 19 mm vertical half-axis.
        // The radicle must emerge below its lower pole, rather than end inside the coat.
        const collarTransition = osmanthusGrowth(.55, .95, age);
        const originY = -.018 - .019 * seedScale * (1 - collarTransition);
        const primary = addRoot([new THREE.Vector3(0, originY, 0), new THREE.Vector3(.04 * development * germination, originY - d * .42, -.025 * development * germination), new THREE.Vector3(-.07 * development * germination, originY - d, .04 * development * germination)], radius, 0);
        const lateralDevelopment = clamp((age - .06) / .6);
        if (lateralDevelopment > 0) laterals(primary, 1 + Math.floor(lateralDevelopment * (1 + development * 7)), reach * .7 * lateralDevelopment, radius * .38 * Math.sqrt(lateralDevelopment), 1, random() * 6.28);
      }
      const structuralDevelopment = species === 'ginkgo' ? clamp((age - .6) / 1.4) : 1;
      const count = species === 'ginkgo' ? Math.floor((5 + Math.floor(development * 4)) * structuralDevelopment) : 7 + Math.floor(development * 5);
      for (let i = 0; i < count; i++) {
        const a = i / count * Math.PI * 2 + (random() - .5) * .4, r = reach * (.65 + random() * .35) * germination * structuralDevelopment;
        const start = new THREE.Vector3(0, -.018, 0);
        const end = new THREE.Vector3(Math.cos(a) * r, -Math.max(.023, maxDepth * (.28 + random() * .38) * germination), Math.sin(a) * r);
        const curve = addRoot([start, new THREE.Vector3(Math.cos(a + .15) * r * .26, -Math.min(maxDepth * .22 + .018, .22), Math.sin(a + .15) * r * .26), new THREE.Vector3(Math.cos(a - .10) * r * .67, end.y * .72, Math.sin(a - .10) * r * .67), end], radius * .55 * Math.sqrt(structuralDevelopment), 1);
        laterals(curve, 7 + Math.floor(development * 7), r * .29, radius * .16, 2, a + 1.5);
      }
    } else {
      const arms = species === 'iris' ? 3 : 5;
      for (let i = 0; i < arms; i++) {
        const angle = i * 2.39996 + random() * .2, r = reach * (.65 + random() * .35) * germination;
        const end = new THREE.Vector3(Math.cos(angle) * r, species === 'iris' ? -.025 : -.007, Math.sin(angle) * r);
        // Oxalis stolons are at the surface; node roots are represented below it, not as a buried rhizome.
        const curve = addRoot([new THREE.Vector3(0, end.y, 0), new THREE.Vector3(end.x * .5, end.y - .003, end.z * .55), end], species === 'iris' ? .006 + development * .005 : .0012, 0, species === 'iris' ? 'rhizome' : 'stolon');
        const nodes = 2 + Math.floor(development * 4);
        for (let n = 0; n < nodes; n++) {
          const origin = curve.getPointAt(.1 + n / nodes * .85), fibers = species === 'iris' ? 6 : 4;
          for (let f = 0; f < fibers; f++) {
            const a = random() * Math.PI * 2, d = maxDepth * (.4 + random() * .6) * germination;
            const tip = origin.clone().add(new THREE.Vector3(Math.cos(a) * d * .45, -d, Math.sin(a) * d * .45));
            const root = addRoot([origin, origin.clone().lerp(tip, .4).add(new THREE.Vector3(d * .08, 0, 0)), tip], species === 'iris' ? .0014 : .0007, 1);
            laterals(root, 2, d * .26, species === 'iris' ? .0004 : .00022, 2, a);
          }
        }
      }
    }
  }
  // Profile depth is fixed by soilDepth; the display box width follows root reach for framing, not a registered soil volume.
  const width = Math.max(woody ? 1.3 : .42, reach * 2.45);
  const strata = [{ ratio: .12, color: '#564532', label: '有机表层 · 示意' }, { ratio: .35, color: '#8b6846', label: '根系活跃层 · 示意' }, { ratio: .53, color: '#a28b68', label: '下部土层 · 示意' }];
  let top = -.003;
  for (let i = 0; i < strata.length; i++) {
    const layer = strata[i], thickness = layer.ratio * soilDepth;
    const mesh = soilLayer(width, soilDepth, thickness, top - thickness, layer.color, params.cutaway, seed + i * 13);
    mesh.name = layer.label; mesh.userData.layer = i; group.add(mesh);
    geometries.push(mesh.geometry); allMaterials.push(mesh.material as THREE.Material); top -= thickness;
  }
  group.userData.profileWidth = width;
  let disposed = false;
  return { group, rootDepth, rootLength, rootTips, availableWater, waterStress,
    dispose() { if (disposed) return; disposed = true; for (const g of geometries) g.dispose(); for (const m of allMaterials) {if(m instanceof THREE.MeshStandardMaterial)m.map?.dispose();m.dispose();} group.clear(); }
  };
}
