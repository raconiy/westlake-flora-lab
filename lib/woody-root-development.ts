import * as THREE from 'three';
import {osmanthusGrowth, osmanthusLifecycle} from './osmanthus-lifecycle.ts';

/** All dimensions, clocks and branching below are uncalibrated engineering
 * priors, not measured root reconstructions, growth rates or soil mechanics.
 * Material coordinates are metres along an axis parameter, not arc length.
 */
export interface WoodyRootAxis {
  id: string; parentId: string | null; node: number; birth: number; order: number;
  lengthAt(age: number): number;
  radiusAt(age: number): number;
  point(s: number): THREE.Vector3;
  /** Proximal addition connects a disappearing seed coat to the later collar;
   * the original radicle and its positive material coordinates never move. */
  startAt(age: number): number;
  nodes: number[];
}
const smooth = (t: number) => {t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t);};
function keyedRandom(seed: number, id: string) {
  let state = seed >>> 0;
  for (let i = 0; i < id.length; i++) state = Math.imul(state ^ id.charCodeAt(i), 16777619) >>> 0;
  return () => {state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296;};
}

export function woodyRootAxes(species: string, seed: number, expansion: number, soilDepth: number): WoodyRootAxis[] {
  const ginkgo = species === 'ginkgo', osmanthus = species === 'osmanthus';
  const camphor = species === 'camphor', acer = species === 'acer';
  const prefix = `${species}:root`, axes: WoodyRootAxis[] = [];
  const seedY = ginkgo ? -.037 : osmanthus ? -.011 : -.004;
  const birth = camphor || acer ? .008 : .012;
  const primaryLimit = (ginkgo ? 2.18 : camphor ? 1.85 : acer ? 1.0 : 1.15) * expansion;
  function growth(onset: number, duration: number, limit: number, tau: number, age: number) {
    const dt = Math.max(0, age - onset);
    return limit * -Math.expm1(-dt / tau) * smooth(dt / duration);
  }
  function make(id: string, parent: WoodyRootAxis | null, node: number, onset: number,
    limit: number, tau: number, duration: number, thickness: number, order: number,
    origin: THREE.Vector3, angle: number, drop: number, primary = false) {
    const rr = keyedRandom(seed, id), bend = .015 + rr() * .025;
    const room = Math.max(.00001, soilDepth - .0001 + origin.y);
    const axis: WoodyRootAxis = {
      id, parentId: parent?.id ?? null, node, birth: onset, order, nodes: [],
      lengthAt: age => growth(onset, duration, limit, tau, age),
      radiusAt: age => Math.min(soilDepth * .12,
        (.00035 + thickness * -Math.expm1(-Math.max(0, age - onset) / 25)) * smooth((age - onset) / duration)),
      startAt: () => 0,
      point(s) {
        if (primary && s < 0) return new THREE.Vector3(0, seedY - s, 0);
        // Point(s) never depends on today's length, age, radius, siblings or RNG state.
        // A fixed saturating depth map respects a hard soil boundary even in 5 cm soil.
        const side = bend * (1 - Math.cos(s * 2.3));
        const primaryBend = primary ? .025 * smooth(s / .04) : 1;
        return origin.clone().add(new THREE.Vector3(
          Math.cos(angle) * s * primaryBend - Math.sin(angle) * side,
          -room * -Math.expm1(-drop * s / room),
          Math.sin(angle) * s * primaryBend + Math.cos(angle) * side));
      },
    };
    axes.push(axis); if (parent) parent.nodes.push(node);
    return axis;
  }
  const primary = make(`${prefix}:primary`, null, 0, birth, primaryLimit, 9, .068, ginkgo ? .065 : camphor ? .075 : .044,
    0, new THREE.Vector3(0, seedY, 0), keyedRandom(seed, `${prefix}:primary`)() * 6.28, 1, true);
  primary.startAt = age => {
    const seedLoss = smooth((age - .25) / .4), seedScale = 1 - seedLoss * .7;
    const y = ginkgo ? -.018 - .019 * seedScale * (1 - osmanthusGrowth(.55, .95, age))
      : osmanthus ? osmanthusLifecycle(age).rootOriginY : seedY;
    return seedY - y;
  };
  function child(parent: WoodyRootAxis, id: string, node: number, scheduled: number,
    limit: number, thickness: number, order: number, angle: number) {
    // Onsets are lower bounds. Solve the parent's arrival at this immutable node,
    // including the proximal collar extension; nothing can emerge ahead of it.
    let lo = parent.birth, hi = Math.max(scheduled, parent.birth + 1);
    const reached = (age: number) => node >= parent.startAt(age) && node <= parent.lengthAt(age);
    while (!reached(hi) && hi < 4096) hi *= 2;
    for (let i = 0; i < 60; i++) {const mid = (lo + hi) / 2; if (reached(mid)) hi = mid; else lo = mid;}
    const onset = Math.max(scheduled, hi), rr = keyedRandom(seed, id);
    return make(id, parent, node, onset, limit * (.7 + rr() * .3), order === 1 ? 7 : 2.5,
      order === 1 ? .5 : .4, thickness, order, parent.point(node), angle, .3 + rr() * .5);
  }
  function fibers(parent: WoodyRootAxis, count: number, delay: number, limit: number, thickness: number) {
    for (let j = 0; j < count; j++) {
      const scheduled = parent.birth + delay + j * .18, id = `${parent.id}:fine:${j}`;
      const node = parent.lengthAt(scheduled) * (.25 + .5 * (j + .5) / count);
      const rr = keyedRandom(seed, id);
      child(parent, id, node, scheduled, limit, thickness, 2, j * 2.39996 + rr() * .6);
    }
  }
  // Early radicle laterals occupy positive material nodes below the buried seed.
  const earlyCount = ginkgo ? 8 : osmanthus ? 5 : 10;
  for (let i = 0; i < earlyCount; i++) {
    const scheduled = (ginkgo ? .06 : osmanthus ? .12 : .14) + i * (ginkgo ? .23 : osmanthus ? .18 : camphor ? .32 : .42);
    const id = `${prefix}:radicle-lateral:${i}`, rr = keyedRandom(seed, id);
    const node = primary.lengthAt(scheduled) * (.35 + i / earlyCount * .3);
    const lateral = child(primary, id, node, scheduled, (ginkgo ? 1.8 : camphor ? 3.4 : acer ? 2.2 : 1.15) * expansion,
      .018, 1, i * 2.39996 + rr() * .5);
    fibers(lateral, osmanthus ? 3 : 5, .65, .32 * expansion, .0025);
  }
  if (ginkgo || osmanthus || (!camphor && !acer)) {
    const count = osmanthus ? 10 : 9;
    for (let i = 0; i < count; i++) {
      const id = `${prefix}:crown:${i}`, rr = keyedRandom(seed, id);
      const node = seedY - (ginkgo ? -.018 : -.004);
      const scheduled = (ginkgo ? .95 : .9) + i * (ginkgo ? .2625 : .5);
      const lateral = child(primary, id, node, scheduled, (ginkgo ? 3.9 : 2.5) * expansion,
        ginkgo ? .036 : .027, 1, i * 2.39996 + (rr() - .5) * .4);
      fibers(lateral, osmanthus ? 9 : 12, .3, (ginkgo ? .9 : .65) * expansion, .006);
    }
  }
  return axes;
}

/** Rings at fixed material nodes, plus the moving tip. No resampling a growing
 * Catmull-Rom spline and no whole-curve Frenet frame that can rotate old rings.
 * Symmetric radial clipping preserves the actual centreline near soil limits.
 */
export function woodyRootGeometry(axis: WoodyRootAxis, age: number, soilDepth: number) {
  const end = axis.lengthAt(age), start = axis.startAt(age), radius = axis.radiusAt(age);
  const step = axis.order < 2 ? .04 : .02, sides = axis.order < 2 ? 8 : 6;
  const samples = new Set([end]);
  for (let s = step; s < end; s += step) samples.add(s);
  // Resolve the steep initial turn of a root already close to the hard floor.
  // These extra samples are fixed material points, independent of current age.
  for (let s = step / 2; s >= .00001; s /= 2) if (s < end) samples.add(s);
  for (const s of axis.nodes) if (s >= start && s <= end) samples.add(s);
  // Keep a separate seed-pole ring even before proximal extension begins. Its
  // initially coincident basal ring can then move upward without replacing it.
  const coordinates = [start, ...[...samples].filter(s => s > start && s < 0).sort((a, b) => a - b),
    ...(axis.order === 0 ? [0] : []),
    ...[...samples].filter(s => s > 0 && s <= end).sort((a, b) => a - b)];
  const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
  let length = 0, depth = 0, previous: THREE.Vector3 | undefined;
  for (let i = 0; i < coordinates.length; i++) {
    const s = coordinates[i], p = axis.point(s);
    if (previous) length += previous.distanceTo(p); previous = p;
    depth = Math.max(depth, -p.y);
    const tangent = axis.point(s + 1e-5).sub(axis.point(s - 1e-5)).normalize();
    const normal = new THREE.Vector3(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    const taper = .035 + .965 * Math.pow(Math.max(0, 1 - Math.max(0, s) / end), .84);
    const r = Math.max(0, Math.min(radius * taper, -p.y - .00005, p.y + soilDepth - .00005));
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      const v = p.clone().addScaledVector(normal, r * Math.cos(a)).addScaledVector(binormal, r * Math.sin(a));
      vertices.push(v.x, v.y, v.z); colors.push(.82, .82, .82);
      if (i + 1 < coordinates.length) {
        const n = i * sides + j, next = i * sides + (j + 1) % sides;
        indices.push(n, next, n + sides, next, next + sides, n + sides);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return {geometry, length, depth, coordinates, sides, radius};
}
