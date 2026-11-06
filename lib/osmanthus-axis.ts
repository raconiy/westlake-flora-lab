import * as THREE from 'three';
import { tagWoodTube, woodSections } from './wood-loads.ts';

/** Qualitative construction prior, NOT measured tropism or a growth trajectory.
 * y is an axial material parameter in metres, not arclength. The complete
 * centreline and section frames are keyed once; age only reveals their prefix.
 */
export const osmanthusAxisPrior = {
  status: 'uncalibrated-engineering-prior',
  source: 'https://plants.ces.ncsu.edu/plants/osmanthus-fragrans/',
  mapping: 'NCSU supports dense evergreen shrub/small tree and pruning response; private habit photographs are qualitative crown references. Curvature, unequal coefficients, angles and sampling are engineering choices; neither source supplies campus measurements or growth paths.',
  construction: 'keyed unequal quadratic/cubic lateral deflection; fixed full-target sampling plus all leaf/branch sites; fixed section frames; clip fixed full-target triangles at an incomplete end, including their diagonal intersections',
  taper: 'basal supported radius unchanged; 1-.51*s/target at fixed material sections, not .49 at every moving apex; this permits homothetic thickening without old polygon retreat',
  limits: 'no measured tropism, phototropism, reaction wood, cambial eccentricity, pruning history, occlusion competition or leaf turnover',
} as const;

function keyed(key: number) {
  let s = key >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export type OsmanthusAxis = ReturnType<typeof createOsmanthusAxis>;

/** Fail closed on detached organs: a catalogue coordinate alone is not wood.
 * Inspect the encoded mesh at every formed node before publishing the axis.
 * The tolerance bounds Float32 geometry error in metres, not field accuracy.
 */
export function assertOsmanthusWoodSupport(geometry: THREE.BufferGeometry,
  nodes: readonly { materialS?: number; attachment: number[] }[]) {
  if (!nodes.length) return;
  const spec = geometry.userData.osmanthusAxis, sides = geometry.userData.woodTube?.sides;
  const position = geometry.getAttribute('position'), index = geometry.index;
  if (!spec || !sides || !position || !index?.count) throw new Error('Osmanthus organ has no actual parent wood');
  const stationIndex = new Map<number, number>(spec.materialSectionsM.map((s: number, i: number) => [s, i]));
  for (const node of nodes) {
    const s = node.materialS, ring = s === undefined ? undefined : stationIndex.get(s);
    if (s === undefined || !Number.isFinite(s) || s < 0 || s > spec.axialParameterM || ring === undefined) {
      throw new Error(`Osmanthus organ is beyond parent wood: ${spec.id}/${s}`);
    }
    const corners = Array.from({ length: sides }, (_, j) => {
      const index = ring * (sides + 1) + j;
      return new THREE.Vector3().fromBufferAttribute(position, index);
    });
    const center = corners.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(sides);
    const areaVector = corners.reduce((sum, p, i) => sum.add(p.clone().sub(center)
      .cross(corners[(i + 1) % sides].clone().sub(center))), new THREE.Vector3());
    if (!(areaVector.lengthSq() > 0) || !areaVector.toArray().every(Number.isFinite)
      || !(center.distanceTo(new THREE.Vector3(...node.attachment)) <= 3e-7)) {
      throw new Error(`Osmanthus organ lacks a positive woody section at its attachment: ${spec.id}/${s}`);
    }
  }
}

export function createOsmanthusAxis(key: number, id: string, target: number, order: number, sites: number[]) {
  if (!Number.isFinite(target) || target < 0) throw new RangeError('Osmanthus target must be finite and nonnegative');
  let identity = key; for (const c of id) identity = Math.imul(identity ^ c.charCodeAt(0), 16777619);
  const random = keyed(identity), amplitude = order === 0 ? .035 : .14;
  const azimuth = random() * Math.PI * 2, bend = amplitude * (.65 + .7 * random());
  const a = new THREE.Vector2(Math.cos(azimuth), Math.sin(azimuth)).multiplyScalar(bend);
  // An independent transverse component prevents a rotated copy of one planar
  // wiggle. Derivatives at the basal material point are exactly (0,1,0).
  const b = new THREE.Vector2(-Math.sin(azimuth), Math.cos(azimuth)).multiplyScalar(amplitude * (.55 + .75 * random()) * (random() < .5 ? -1 : 1));
  b.addScaledVector(a, (random() - .5) * .8);
  const analyticPoint = (s: number) => { const t = target > 0 ? s / target : 0; return new THREE.Vector3(target * (a.x * t * t + b.x * t ** 3), s, target * (a.y * t * t + b.y * t ** 3)); };
  const tangent = (s: number) => { const t = target > 0 ? s / target : 0; return new THREE.Vector3(2 * a.x * t + 3 * b.x * t * t, 1, 2 * a.y * t + 3 * b.y * t * t).normalize(); };
  const frame = (s: number) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent(s));
  // Sampling depends on target and fixed sites, never on today's length/age.
  const count = Math.max(8, Math.min(48, Math.ceil(target / .12)));
  const stations = [...new Set([...Array.from({ length: count + 1 }, (_, i) => target * i / count), ...sites])].filter(s => s >= 0 && s <= target).sort((x, y) => x - y);
  const points = stations.map(analyticPoint), frames = stations.map(frame);
  function interval(s: number) {
    if (target === 0) return { i: 0, t: 0 };
    const value = Math.max(0, Math.min(target, s));
    let i = 0; while (i < stations.length - 2 && stations[i + 1] <= value) i++;
    return { i, t: (value - stations[i]) / (stations[i + 1] - stations[i]) };
  }
  const point = (s: number) => { const { i, t } = interval(s); return target === 0 ? points[0].clone() : points[i].clone().lerp(points[i + 1], t); };
  const ringVector = (i: number, side: number, sides: number) => new THREE.Vector3(Math.sin(side * 2 * Math.PI / sides), 0, Math.cos(side * 2 * Math.PI / sides)).applyQuaternion(frames[i]).multiplyScalar(target > 0 ? 1 - .51 * stations[i] / target : 1);
  function section(s: number, radius: number, sides = 10) {
    const { i, t } = interval(s), center = point(s);
    return Array.from({ length: sides }, (_, j) => (target === 0 ? ringVector(0, j, sides) : ringVector(i, j, sides).lerp(ringVector(i + 1, j, sides), t)).multiplyScalar(radius).add(center));
  }
  const definitions = {
    lengthDefinition: 'axial y material parameter; arcLengthM is the sampled centreline arclength',
    uvDefinition: 'u: fixed polygon phase; v: axial material metres; diagonal vertices use fixed-triangle interpolation',
    frameDefinition: 'age-independent shortest-arc frame of the underlying keyed smooth tangent; incomplete end clips fixed full-target triangles, preserving their diagonal intersections',
  };
  function geometry(length: number, radius: number) {
    if (!Number.isFinite(length) || !Number.isFinite(radius) || radius < 0) throw new RangeError('Osmanthus length/radius must be finite; radius must be nonnegative');
    const end = Math.max(0, Math.min(target, length));
    // An unborn/zero-volume axis has no surface or caps. Avoid coincident
    // rings, zero-area triangles and division by a zero target at exact birth.
    if (end === 0 || radius === 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([], 2)); g.setIndex([]);
      tagWoodTube(g, 0, 10); g.userData.woodSections = [];
      g.userData.osmanthusAxis = { id, targetM: target, axialParameterM: end, arcLengthM: 0, materialSectionsM: [0], basalRadiusM: radius, vertexMaterialM: [], lateralIndexCount: 0, ...definitions };
      return g;
    }
    const material = [...stations.filter(s => s < end), end];
    // Fixed polygon topology, even as the basal radius crosses .04m. Changing
    // 6 to 10 sides with age can move old polygon faces inward.
    const sides = 10, positions: number[] = [], uvs: number[] = [], indices: number[] = [], vertexMaterialM: number[] = [];
    const { i: endInterval, t: endFraction } = interval(end);
    const partialEnd = endFraction > 0 && endFraction < 1;
    let arcLengthM = 0;
    material.forEach((s, i) => {
      if (i) arcLengthM += point(s).distanceTo(point(material[i - 1]));
      const ring = section(s, radius, sides);
      for (let j = 0; j <= sides; j++) { positions.push(...ring[j % sides].toArray()); uvs.push(j / sides, s); vertexMaterialM.push(s); }
      if (i) for (let j = 0; j < sides; j++) {
        const x = (i - 1) * (sides + 1) + j, y = x + sides + 1;
        if (i === material.length - 1 && partialEnd) continue;
        indices.push(x, x + 1, y, x + 1, y + 1, y);
      }
    });
    // A twisted quad is not planar. Merely interpolating its corner ring and
    // redrawing two triangles moves the old diagonal as the apex advances.
    // Clip BOTH original triangles instead. The extra diagonal intersection
    // is a real end-section vertex and enters the final wood section metadata.
    const diagonals: number[] = [];
    if (partialEnd) for (let j = 0; j < sides; j++) {
      const a = points[endInterval].clone().addScaledVector(ringVector(endInterval, (j+1)%sides, sides), radius);
      const b = points[endInterval+1].clone().addScaledVector(ringVector(endInterval+1, j, sides), radius);
      const d = a.lerp(b, endFraction), index = positions.length/3; diagonals.push(index);
      positions.push(...d.toArray()); uvs.push((j + 1 - endFraction)/sides, end); vertexMaterialM.push(end);
      const x = (material.length-2)*(sides+1)+j, y = x+sides+1;
      indices.push(x, x+1, index, x, index, y, x+1, y+1, index);
    }
    const unfilteredLateralIndexCount = indices.length;
    // Caps use the exact same (possibly clipped 20-vertex) end polygon.
    for (const i of [0, material.length - 1]) {
      const center = positions.length / 3; positions.push(...point(material[i]).toArray()); uvs.push(.5, material[i]); vertexMaterialM.push(material[i]);
      for (let j = 0; j < sides; j++) {
        const x = i * (sides + 1) + j;
        if (i === 0) indices.push(center, x + 1, x);
        else if (partialEnd) indices.push(center, x, diagonals[j], center, diagonals[j], x+1);
        else indices.push(center, x, x + 1);
      }
    }
    const g = new THREE.BufferGeometry(), position = new THREE.Float32BufferAttribute(positions, 3);
    // At an extremely short partial end, the diagonal crossing can round to a
    // ring corner in Float32. Drop only triangles with exactly zero encoded
    // area; no coordinates, radii or nonzero faces are changed. Keep the ring
    // layout and seam UVs intact for woodSections and downstream bark mapping.
    const encodedIndices: number[] = [];
    let lateralIndexCount = 0;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (let i = 0; i < indices.length; i += 3) {
      va.fromBufferAttribute(position, indices[i]); vb.fromBufferAttribute(position, indices[i+1]); vc.fromBufferAttribute(position, indices[i+2]);
      if (vb.sub(va).cross(vc.sub(va)).lengthSq() === 0) continue;
      encodedIndices.push(indices[i], indices[i+1], indices[i+2]);
      if (i < unfilteredLateralIndexCount) lateralIndexCount += 3;
    }
    g.setAttribute('position', position); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(encodedIndices); g.computeVertexNormals();
    tagWoodTube(g, material.length - 1, sides);
    if (partialEnd) {
      const sections = woodSections(g), p = g.attributes.position;
      const ring = Array.from({ length: sides }, (_, j) => [(material.length-1)*(sides+1)+j, diagonals[j]]).flat().map(j => new THREE.Vector3().fromBufferAttribute(p, j));
      const center = ring.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(ring.length), offsets = ring.map(v => v.sub(center));
      const area = offsets.reduce((a, v, i) => a.add(v.clone().cross(offsets[(i+1)%offsets.length])), new THREE.Vector3()).length()/2;
      const last = sections[sections.length-1]; last.b = center.toArray(); last.ringB = offsets.map(v => v.toArray()); last.areaB = area;
      g.userData.woodSections = sections;
    }
    // Adjacent material labels can encode exactly the same ring just after a
    // station. Such a section has exactly zero mass/drag in the rendered mesh.
    g.userData.woodSections = woodSections(g).filter(s =>
      new THREE.Vector3(...s.a).distanceToSquared(new THREE.Vector3(...s.b)) > 0 && s.areaA > 0 && s.areaB > 0);
    g.userData.osmanthusAxis = { id, targetM: target, axialParameterM: end, arcLengthM, materialSectionsM: material, basalRadiusM: radius, vertexMaterialM, lateralIndexCount,
      ...definitions };
    return g;
  }
  return { id, target, stations, point, tangent, frame, section, geometry };
}
