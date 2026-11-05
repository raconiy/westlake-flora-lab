import * as THREE from 'three';

/** One simple palmate blade, shared by all Acer true-leaf instances.
 * Qualitative evidence: Flora of China Acer palmatum (5–7 lobes, serration),
 * https://www.iplant.cn/foc/pdf/Acer.pdf and NC State's simple, deeply lobed,
 * serrate leaves: https://plants.ces.ncsu.edu/plants/acer-palmatum/ .
 * Lobe proportions, tooth count and relief below are engineering priors, not
 * measurements of a cultivar or the unidentified Yungu tree. No colour prior.
 */
export function acerLeafBlade() {
  const polar = (a: number, r: number) => new THREE.Vector2(Math.sin(a) * r, Math.cos(a) * r);
  const tangent = (a: number) => new THREE.Vector2(Math.cos(a), -Math.sin(a));
  const angles = [-2.10, -1.40, -.70, 0, .70, 1.40, 2.10];
  const lengths = [.031, .046, .051, .052, .051, .046, .031];
  const cuts = [-2.65, -1.75, -1.05, -.35, .35, 1.05, 1.75, 2.65];
  const depths = [.010, .016, .017, .019, .019, .017, .016, .010];
  const outline: THREE.Vector2[] = [new THREE.Vector2()];
  // The two short curved basal flanks meet at the petiole insertion (0,0,0),
  // leaving an actual basal notch rather than a straight polygon base.
  const basal = polar(cuts[0], depths[0]);
  const baseCurve = new THREE.CubicBezierCurve(new THREE.Vector2(), new THREE.Vector2(-.001, -.001), new THREE.Vector2(-.003, -.007), basal);
  for (let j = 1; j <= 5; j++) outline.push(baseCurve.getPoint(j / 5));
  function margin(curve: THREE.CubicBezierCurve, teeth: number) {
    // Sample the underlying curved margin at each tooth's root/acute tip/root.
    // Tooth amplitude tapers to zero at both a sinus and a primary apex.
    for (let tooth = 0; tooth < teeth; tooth++) for (const phase of [0, .58]) {
      const t = (tooth + phase) / teeth;
      if (t === 0) continue;
      const p = curve.getPoint(t), d = curve.getTangent(t);
      if (phase === .58) p.addScaledVector(new THREE.Vector2(-d.y, d.x), .00065 * Math.sin(Math.PI * t));
      outline.push(p);
    }
    outline.push(curve.v3.clone());
  }
  for (let l = 0; l < 7; l++) {
    const a = angles[l], r = lengths[l], tip = polar(a, r), direction = polar(a, 1), across = tangent(a);
    const before = polar(cuts[l], depths[l]), after = polar(cuts[l + 1], depths[l + 1]);
    const teeth = Math.round(r / .0052);
    margin(new THREE.CubicBezierCurve(before, before.clone().addScaledVector(tangent(cuts[l]), r * .11),
      tip.clone().addScaledVector(direction, -r * .40).addScaledVector(across, -r * .27), tip), teeth);
    margin(new THREE.CubicBezierCurve(tip, tip.clone().addScaledVector(direction, -r * .40).addScaledVector(across, r * .27),
      after.clone().addScaledVector(tangent(cuts[l + 1]), -r * .11), after), teeth);
  }
  const last = outline[outline.length - 1];
  const returnCurve = new THREE.CubicBezierCurve(last, new THREE.Vector2(.003, -.007), new THREE.Vector2(.001, -.001), new THREE.Vector2());
  for (let j = 1; j < 5; j++) outline.push(returnCurve.getPoint(j / 5));

  // Preserve the old Float32 template envelope, including its small asymmetry,
  // and keep the insertion fixed. Existing instance scales and metric UVs stay.
  const oldMin = [-.03655235096812248, -.012610341422259808, -.0018174108117818832];
  const oldMax = [.03696165233850479, .03898968547582626, .002478795126080513];
  const minX = Math.min(...outline.map(p => p.x)), maxX = Math.max(...outline.map(p => p.x));
  const minY = Math.min(...outline.map(p => p.y)), maxY = Math.max(...outline.map(p => p.y));
  for (const p of outline) p.set(p.x * (p.x < 0 ? oldMin[0] / minX : oldMax[0] / maxX), p.y * (p.y < 0 ? oldMin[1] / minY : oldMax[1] / maxY));
  const boundaryCount = outline.length;
  const triangles = THREE.ShapeUtils.triangulateShape(outline, []);
  // Interior vein samples make the fold a surface, not just displaced edges.
  // Split a containing triangle without creating cracks or extra GPU resources.
  const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  function insert(p: THREE.Vector2) {
    for (let i = 0; i < triangles.length; i++) {
      const [a, b, c] = triangles[i], area = cross(outline[a], outline[b], outline[c]);
      const weights = [cross(p, outline[b], outline[c]), cross(outline[a], p, outline[c]), cross(outline[a], outline[b], p)].map(v => v / area);
      if (weights.every(w => w >= -1e-9)) {
        if (outline.some(q => q.distanceToSquared(p) < 1e-16)) return;
        const n = outline.push(p) - 1;
        const zero = weights.findIndex(w => w <= 1e-9);
        if (zero < 0) triangles.splice(i, 1, [a, b, n], [b, c, n], [c, a, n]);
        else {
          const edge = [a, b, c].filter((_, j) => j !== zero), replacements: number[][] = [];
          for (let j = triangles.length - 1; j >= 0; j--) {
            const tri = triangles[j];
            if (edge.every(v => tri.includes(v))) {
              const other = tri.find(v => !edge.includes(v))!;
              replacements.push([edge[0], n, other], [n, edge[1], other]);
              triangles.splice(j, 1);
            }
          }
          triangles.push(...replacements);
        }
        return;
      }
    }
  }
  for (let l = 0; l < 7; l++) for (const f of [.22, .45, .68, .86]) {
    const p = polar(angles[l], lengths[l] * f);
    p.set(p.x * (p.x < 0 ? oldMin[0] / minX : oldMax[0] / maxX), p.y * (p.y < 0 ? oldMin[1] / minY : oldMax[1] / maxY));
    insert(p);
  }
  // A few large panel centroids resolve gentle curvature away from the veins.
  const panels = triangles.map(ids => ({ids, area: Math.abs(cross(...ids.map(i => outline[i]) as [THREE.Vector2, THREE.Vector2, THREE.Vector2]))})).sort((a, b) => b.area - a.area).slice(0, 40);
  for (const {ids} of panels) insert(ids.reduce((p, i) => p.add(outline[i]), new THREE.Vector2()).multiplyScalar(1 / 3));

  // Constrained local Delaunay flips leave every serrated boundary edge fixed.
  // Avoid earcut's long slivers spanning a curved panel: those would turn a
  // gentle height field into near-vertical interpolation artefacts.
  for (let pass = 0; pass < 1024; pass++) {
    const edges = new Map<string, {tri: number; a: number; b: number; c: number}>();
    let changed = false;
    for (let t = 0; t < triangles.length; t++) {
      const tri = triangles[t];
      if (cross(...tri.map(i => outline[i]) as [THREE.Vector2, THREE.Vector2, THREE.Vector2]) < 0) [tri[1], tri[2]] = [tri[2], tri[1]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3], c = tri[(e + 2) % 3], key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        const old = edges.get(key);
        if (!old) { edges.set(key, {tri: t, a, b, c}); continue; }
        const d = old.c, A = outline[a], B = outline[b], C = outline[c], D = outline[d];
        if (cross(C, D, A) * cross(C, D, B) >= -1e-18) continue;
        const u = A.clone().sub(D), v = B.clone().sub(D), w = C.clone().sub(D);
        const determinant = u.lengthSq() * v.cross(w) - v.lengthSq() * u.cross(w) + w.lengthSq() * u.cross(v);
        if (determinant <= 1e-16) continue;
        triangles[t] = [c, d, b]; triangles[old.tri] = [d, c, a];
        changed = true; break;
      }
      // Rebuild adjacency after a flip so no cached triangle becomes stale.
      if (changed) break;
    }
    if (!changed) break;
  }

  const relief = outline.map(p => .0025 * Math.sin(p.y * 40) - .001 * Math.abs(p.x) / .05
    + .00028 * Math.sin(p.y / oldMax[1] * Math.PI) * Math.exp(-Math.abs(p.x) / .006));
  const minZ = Math.min(...relief), maxZ = Math.max(...relief), positions: number[] = [], uv: number[] = [];
  outline.forEach((p, i) => {
    const z = relief[i] * (relief[i] < 0 ? oldMin[2] / minZ : oldMax[2] / maxZ);
    positions.push(p.x, p.y, z);
    uv.push(.5 + p.x / .0924, (p.y + .01725) / .06);
  });
  const indices = triangles.flatMap(([a, b, c]) => cross(outline[a], outline[b], outline[c]) > 0 ? [a, b, c] : [a, c, b]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  g.userData.acerBlade = {boundaryCount, primaryLobes: 7, sourceType: 'engineering-prior'};
  return g;
}
