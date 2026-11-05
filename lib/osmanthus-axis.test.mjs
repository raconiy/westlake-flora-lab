import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { buildRecovered } from './osmanthus-controls.mjs';
import { createOsmanthusAxis, osmanthusAxisPrior } from './osmanthus-axis.ts';
import { woodSections, sectionVolume, sectionProjectedArea } from './wood-loads.ts';
import { createBeamDynamics } from './beam-dynamics.ts';
import { buildRhizosphere } from './rhizosphere.ts';

const build = (age, seed = 42, day = 180) => buildPlant('osmanthus', { age, seed, day, density: 1 });
const wood = b => b.pivot.children.find(o => o.name === 'osmanthus-wood-axis');
const leaves = b => b.pivot.children.find(o => o.userData.connectedBy === 'petiole');
const center = ring => ring.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(ring.length);
// These tolerances bound Float32 and interpolation error in the generated
// mesh. 0.3 micrometres is NOT field measurement or botanical accuracy.
// When comparing homothetic boundaries, the old Float32 encoding error is
// amplified by the measured radial scale; only that comparison scales EPS.
const EPS = 3e-7;
function ringAt(g, s) {
  const spec = g.userData.osmanthusAxis, n = g.userData.woodTube.sides, p = g.attributes.position;
  const material = spec.materialSectionsM;
  let i = 0; while (i < material.length - 2 && material[i + 1] <= s) i++;
  const t = (s - material[i]) / (material[i + 1] - material[i]);
  return Array.from({ length: n }, (_, j) => new THREE.Vector3().fromBufferAttribute(p, i * (n + 1) + j).lerp(new THREE.Vector3().fromBufferAttribute(p, (i + 1) * (n + 1) + j), t));
}
// Intersect actual indexed lateral triangles with their material label. This
// includes the interior diagonal crossing of a twisted quad, which a nominal
// ring-corner interpolation would miss. No generator point/frame function is
// used to decide whether the old surface was retained.
function surfaceAt(g, s) {
  const spec = g.userData.osmanthusAxis, p = g.attributes.position, idx = g.index, result = [];
  const add = v => { if (!result.some(q => q.distanceTo(v) < 1e-8)) result.push(v); };
  for (let i = 0; i < spec.lateralIndexCount; i += 3) for (let j = 0; j < 3; j++) {
    const ia = idx.getX(i+j), ib = idx.getX(i+(j+1)%3), a = spec.vertexMaterialM[ia], b = spec.vertexMaterialM[ib];
    if (s === a) add(new THREE.Vector3().fromBufferAttribute(p, ia));
    if (a !== b && s > Math.min(a,b) && s < Math.max(a,b)) add(new THREE.Vector3().fromBufferAttribute(p, ia).lerp(new THREE.Vector3().fromBufferAttribute(p, ib), (s-a)/(b-a)));
  }
  const c = center(result); result.sort((a,b) => Math.atan2(a.z-c.z,a.x-c.x)-Math.atan2(b.z-c.z,b.x-c.x));
  return result;
}
function retainedSection(old, fresh, s, oldMatrix = new THREE.Matrix4(), freshMatrix = new THREE.Matrix4()) {
  const a = surfaceAt(old, s).map(v => v.applyMatrix4(oldMatrix)), b = surfaceAt(fresh, s).map(v => v.applyMatrix4(freshMatrix));
  const ca = center(ringAt(old, s).map(v => v.applyMatrix4(oldMatrix))), cb = center(ringAt(fresh, s).map(v => v.applyMatrix4(freshMatrix)));
  assert.ok(ca.distanceTo(cb) < EPS, 'actual old section centre is stationary, including a formerly incomplete end ring');
  const basalRadius = (g, matrix) => {
    const ring = ringAt(g, 0).map(v => v.applyMatrix4(matrix)), c = center(ring);
    return ring.reduce((sum, v) => sum+v.distanceTo(c), 0)/ring.length;
  };
  const ratio = basalRadius(fresh, freshMatrix)/basalRadius(old, oldMatrix);
  assert.ok(ratio >= 1-1e-6, 'measured basal radius does not shrink');
  const boundaryDistance = (p, polygon) => Math.min(...polygon.map((v,i) => new THREE.Line3(v, polygon[(i+1)%polygon.length]).closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p)));
  // A clipped quad may add collinear vertices when retriangulated. Compare
  // actual polygon boundaries in BOTH directions, including every diagonal
  // intersection; do not require identical vertex IDs or triangulation counts.
  const outwardError = Math.max(...a.map(p => boundaryDistance(p.clone().sub(ca).multiplyScalar(ratio).add(cb), b)));
  const inwardError = Math.max(...b.map(p => boundaryDistance(p.clone().sub(cb).divideScalar(ratio).add(ca), a)));
  assert.ok(outwardError < EPS*Math.max(1,ratio), 'old triangle-section boundary retains its full frame within amplified Float32 error');
  assert.ok(inwardError < EPS, 'new section is homothetic to the actual past surface');
  const normal = a.reduce((v, p, i) => v.add(p.clone().sub(ca).cross(a[(i+1)%a.length].clone().sub(ca))), new THREE.Vector3()).normalize();
  const u = a[0].clone().sub(ca).normalize(), v = normal.clone().cross(u).normalize();
  const polygon = b.map(p => [p.clone().sub(cb).dot(u),p.clone().sub(cb).dot(v)]);
  for (const p of a) {
    const x = p.clone().sub(cb).dot(u), y = p.clone().sub(cb).dot(v); let inside = false;
    for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const [xi,yi]=polygon[i],[xj,yj]=polygon[j];
      if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside = !inside;
    }
    assert.ok(inside || boundaryDistance(p,b) < EPS, 'past wooden polygon remains inside the new polygon');
  }
  return { centerDriftM: ca.distanceTo(cb), boundaryErrorM: Math.max(outwardError,inwardError) };
}
function triangleVolume(g) {
  const p = g.attributes.position, idx = g.index; let volume = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, idx.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(p, idx.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(p, idx.getX(i + 2));
    volume += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(volume);
}

test('zero target/extension/radius have empty finite geometry; tiny, partial and full ends have closed nondegenerate caps', () => {
  for (const [target, length, radius] of [[0, 0, 0], [0, 1, .02], [2.3, 0, .02], [2.3, 1, 0],
    [2.3, 1e-12, 1e-14], [2.3, .731, .02], [2.3, .79-1e-12, .02], [2.3, .79, .02],
    [2.3, .79+1e-12, .02], [2.3, 2.3-1e-12, .02], [2.3, 2.3, .02]]) {
    const curve = createOsmanthusAxis(42, 'edge/caps', target, 1, [.32, .79]), g = curve.geometry(length, radius);
    try {
      assert.deepEqual(curve.point(0).toArray(), [0, 0, 0]);
      assert.deepEqual(curve.tangent(0).toArray(), [0, 1, 0]);
      assert.deepEqual(curve.frame(0).toArray(), [0, 0, 0, 1]);
      for (const attr of ['position', 'normal', 'uv']) assert.ok(g.attributes[attr].array.every(Number.isFinite));
      if (target === 0 || length === 0 || radius === 0) {
        assert.equal(g.index.count, 0); assert.equal(g.attributes.position.count, 0);
        assert.deepEqual(woodSections(g), []); assert.equal(triangleVolume(g), 0);
        continue;
      }
      const p = g.attributes.position, idx = g.index, edges = new Map(), ids = new Map();
      const vertex = i => {
        const key = [p.getX(i), p.getY(i), p.getZ(i)].join(',');
        if (!ids.has(key)) ids.set(key, ids.size);
        return ids.get(key);
      };
      let signedVolume = 0;
      for (let i = 0; i < idx.count; i += 3) {
        const vi = [0, 1, 2].map(j => idx.getX(i+j));
        const [a,b,c] = vi.map(j => new THREE.Vector3().fromBufferAttribute(p,j));
        const area2 = b.clone().sub(a).cross(c.clone().sub(a)).length();
        assert.ok(Number.isFinite(area2) && area2 > 0, `nonzero actual triangle at ${target}/${length}/${radius}`);
        signedVolume += a.dot(b.cross(c))/6;
        for (let j = 0; j < 3; j++) {
          const a = vertex(vi[j]), b = vertex(vi[(j+1)%3]), key = [Math.min(a,b),Math.max(a,b)].join('/');
          const entry = edges.get(key) ?? {count: 0, winding: 0};
          entry.count++; entry.winding += a < b ? 1 : -1; edges.set(key, entry);
        }
      }
      for (const edge of edges.values()) {
        assert.equal(edge.count, 2, 'every welded side/cap edge has two incident triangles');
        assert.equal(edge.winding, 0, 'adjacent triangles have opposite edge winding');
      }
      assert.ok(signedVolume > 0, 'caps and sides enclose positive outward-oriented volume');
      for (const section of woodSections(g)) assert.ok(sectionVolume(section) > 0);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1);
        assert.ok(Math.abs(uv.getY(i)-g.userData.osmanthusAxis.vertexMaterialM[i]) < 2e-7, 'v retains axial metres for bark integration');
      }
    } finally { g.dispose(); }
  }
});

test('actual basal rings retain the flat collar frame and contact the supplied root junction in rest pose', t => {
  let checked = 0, maxCenterDriftM = 0;
  for (const age of [.035 + 1e-5, .2, 2, 12]) for (const density of [.3, 1.8]) {
    const model = buildPlant('osmanthus', {age, density, seed: 42, day: 180});
    const trunk = model.branches[0]; model.group.position.set(.13, 0, -.17); model.group.updateMatrixWorld(true);
    const mesh = wood(trunk), p = mesh.geometry.attributes.position;
    const ring = Array.from({length: 10}, (_,i) => new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld));
    const collar = trunk.pivot.getWorldPosition(new THREE.Vector3()), drift = center(ring).distanceTo(collar);
    const root = buildRhizosphere('osmanthus', {age, density, seed: 42, moisture: .55, compaction: .2, cutaway: true, soilDepth: .1,
      shootCollar: {position: collar.toArray(), radius: trunk.radius}});
    try {
      assert.ok(drift < 1e-8); maxCenterDriftM = Math.max(maxCenterDriftM,drift); checked++;
      const junction = root.group.getObjectByName('root-shoot-junction');
      if (trunk.radius <= 1e-7) {
        // Existing root renderer omits its junction below 0.1 micrometres.
        // Still inspect the real newborn shoot frame, and expose this limit.
        assert.ok(!junction);
        for (const v of ring) assert.ok(Math.abs(v.y-collar.y) < 1e-8);
        continue;
      }
      assert.ok(junction);
      const rp = junction.geometry.attributes.position;
      const top = Array.from({length: rp.count}, (_,i) => new THREE.Vector3().fromBufferAttribute(rp,i))
        .filter(v => Math.abs(v.y-collar.y) < 1e-8);
      assert.ok(top.length >= 16);
      for (const v of ring) {
        assert.ok(Math.abs(v.y-collar.y) < 1e-8, 'actual basal ring has no construction tilt');
        assert.ok(Math.abs(v.clone().sub(collar).length()-trunk.radius) < 1e-7, 'actual supported basal radius');
        assert.ok(top.some(q => Math.abs(Math.hypot(q.x-collar.x,q.z-collar.z)-trunk.radius) < 1e-7), 'rendered root collar reaches the same supplied radius');
      }
    } finally { root.dispose(); model.dispose(); }
  }
  t.diagnostic(JSON.stringify({restPoseCollars: checked, maxCenterDriftM,
    limit: 'root renderer omits junctions at radius <=1e-7m; lumped branch rotation can open the basal ring under load; no flexible collar or root/soil mechanics solved'}));
});

test('fixed target geometry grows an exact prefix, including unchanged-length thickening and arbitrary old end sections', () => {
  const curve = createOsmanthusAxis(42, 'sample/unequal', 2.3, 1, [.32, .79]);
  const cases = [[.731, .02], [.731, .026], [1.279, .026], [2.3, .04]], geometries = cases.map(([l, r]) => curve.geometry(l, r));
  try {
    for (let i = 1; i < geometries.length; i++) for (const s of [0, .137, .32, .618, .731]) retainedSection(geometries[i - 1], geometries[i], s);
    assert.ok(curve.tangent(.731).distanceTo(new THREE.Vector3(0, 1, 0)) > .02);
    const q = curve.frame(.731); assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(q).distanceTo(curve.tangent(.731)) < 1e-12);
    assert.match(osmanthusAxisPrior.status, /uncalibrated/);
  } finally { geometries.forEach(g => g.dispose()); }
});

test('selected actual world-space bark polygons, nodes and petiole bases persist through 2/8/12/40 years for seeds 42/73', t => {
  for (const seed of [42, 73]) {
    let previous;
    for (const age of [2, 8, 12, 40]) {
      const model = build(age, seed); model.group.updateMatrixWorld(true);
      let maxDrift = 0, maxBoundaryErrorM = 0, checked = 0;
      try {
        const byId = new Map(model.branches.map(b => [b.pivot.userData.axisId, b]));
        if (previous) for (const old of previous.selected) {
          const b = byId.get(old.id); assert.ok(b, 'no age-only wood retirement');
          assert.ok(b.radius >= old.radius && b.length >= old.length);
          assert.deepEqual(b.rest.toArray(), old.rest);
          const g = wood(b).geometry;
          for (const s of old.sections) { const metric = retainedSection(old.geometry, g, s, old.matrix, wood(b).matrixWorld); maxDrift = Math.max(maxDrift, metric.centerDriftM); maxBoundaryErrorM = Math.max(maxBoundaryErrorM, metric.boundaryErrorM); checked++; }
          const nodes = new Map((leaves(b)?.userData.nodes ?? []).map(n => [n.index, n]));
          for (const node of old.nodes) {
            const fresh = nodes.get(node.index); assert.ok(fresh);
            assert.deepEqual(fresh.attachment, node.attachment); assert.deepEqual(fresh.sectionFrame, node.sectionFrame);
            const stalk = b.pivot.children.find(o => o.userData.role === 'petiole'), matrix = new THREE.Matrix4();
            const i = leaves(b).userData.nodes.findIndex(n => n.index === node.index); stalk.getMatrixAt(2 * i, matrix);
            const base = new THREE.Vector3(0, -.5, 0).applyMatrix4(matrix).applyMatrix4(stalk.matrixWorld);
            assert.ok(base.distanceTo(node.world) < EPS, 'actual old petiole base is stationary');
          }
        }
        // A few selected axes on every available order, including weak axes.
        const selected = [0, 1, 2, 3].flatMap(order => model.branches.filter(b => b.order === order).filter((_, i) => i === 0));
        const next = selected.map(b => ({ id: b.pivot.userData.axisId, length: b.length, radius: b.radius, rest: b.rest.toArray(), geometry: wood(b).geometry.clone(), matrix: wood(b).matrixWorld.clone(),
          sections: [0, .173 * b.length, .637 * b.length, b.length],
          nodes: (leaves(b)?.userData.nodes ?? []).filter((_, i) => i === 0).map(n => ({ ...n, world: new THREE.Vector3(...n.attachment).applyMatrix4(b.pivot.matrixWorld) })) }));
        previous?.selected.forEach(b => b.geometry.dispose()); previous = { selected: next };
        t.diagnostic(JSON.stringify({ seed, age, checkedSections: checked, maxActualSectionCenterDriftM: maxDrift, maxActualBoundaryHomothetyErrorM: maxBoundaryErrorM }));
      } finally { model.dispose(); }
    }
    previous?.selected.forEach(b => b.geometry.dispose());
  }
});

test('actual tube vertices have unequal nonplanar curvature, honest lengths and real nodal contact', t => {
  const model = build(12, 42, 280), signatures = new Set(); let nonplanar = 0, maxOffsetM = 0, maxArcRatio = 1;
  try {
    for (const b of model.branches) {
      const mesh = wood(b), g = mesh.geometry, spec = g.userData.osmanthusAxis;
      assert.equal(g.userData.woodTube.sides, 10); assert.equal(spec.axialParameterM, b.length);
      const sections = spec.materialSectionsM, rings = sections.map(s => ringAt(g, s)), centers = rings.map(center);
      let arc = 0; for (let i = 1; i < centers.length; i++) arc += centers[i].distanceTo(centers[i - 1]);
      assert.ok(Math.abs(arc - spec.arcLengthM) < EPS * centers.length);
      assert.ok(spec.arcLengthM >= b.length - EPS);
      maxArcRatio = Math.max(maxArcRatio, arc / b.length);
      assert.ok(g.attributes.position.array.every(Number.isFinite));
      if (b.length > .15) {
        const mid = center(ringAt(g, .47 * b.length)), end = centers.at(-1), late = center(ringAt(g, .81 * b.length));
        const normal = mid.clone().cross(end); const offPlane = Math.abs(late.dot(normal)) / normal.length();
        if (offPlane > 1e-6) nonplanar++;
        const offset = mid.clone().cross(end).length() / end.length(); maxOffsetM = Math.max(maxOffsetM, offset);
        // Rotation-invariant shape descriptors distinguish actual curvature,
        // not merely the same wiggle rotated around local Y.
        signatures.add([mid.length()/b.length, late.length()/b.length, end.length()/b.length, mid.dot(end)/b.length**2, mid.dot(late.clone().cross(end))/b.length**3].map(n => n.toFixed(7)).join(','));
      }
      for (const n of leaves(b)?.userData.nodes ?? []) {
        assert.ok(center(ringAt(g, n.materialS)).distanceTo(new THREE.Vector3(...n.attachment)) < EPS, 'actual nodal ring centre is the leaf/child support');
        const frame = new THREE.Quaternion(...n.sectionFrame), tangent = new THREE.Vector3(0, 1, 0).applyQuaternion(frame);
        const delta = Math.min(.0001, b.length * .0001), lo = Math.max(0, n.materialS - delta), hi = Math.min(b.length, n.materialS + delta);
        const actualTangent = center(ringAt(g, hi)).sub(center(ringAt(g, lo))).normalize();
        assert.ok(actualTangent.dot(tangent) > .999, 'smooth construction tangent agrees with actual sampled centreline');
      }
    }
    assert.ok(nonplanar > 150 && signatures.size > 150 && maxOffsetM > .015);
    t.diagnostic(JSON.stringify({ nonplanarAxes: nonplanar, uniqueCurvatures: signatures.size, maxChordDepartureM: maxOffsetM, maxArcToAxialRatio: maxArcRatio }));
  } finally { model.dispose(); }
});

test('actual final tube sections feed unchanged mass/drag solver with bounded triangulated-volume approximation', t => {
  const model = build(12), dynamics = createBeamDynamics(model); let sectionKg = 0, triangleKg = 0, sectionArea = 0, triangleWoodArea = 0, triangleLeafArea = 0, maxVolumeRelativeError = 0;
  const wind = new THREE.Vector3(1, 0, .2).normalize();
  try {
    model.group.updateMatrixWorld(true);
    for (const b of model.branches) {
      const mesh = wood(b), sections = woodSections(mesh.geometry);
      const volume = sections.reduce((s, q) => s + sectionVolume(q), 0), triangles = triangleVolume(mesh.geometry);
      maxVolumeRelativeError = Math.max(maxVolumeRelativeError, Math.abs(volume / triangles - 1));
      sectionKg += 550 * volume; triangleKg += 550 * triangles;
      sectionArea += sections.reduce((s, q) => s + sectionProjectedArea(q, mesh.matrixWorld, wind), 0);
      const p = mesh.geometry.attributes.position, idx = mesh.geometry.index, { segments, sides } = mesh.geometry.userData.woodTube;
      // Half the absolute projected lateral-triangle area is the two-sided
      // tube convention; caps are excluded just as in the section drag model.
      for (let i = 0; i < mesh.geometry.userData.osmanthusAxis.lateralIndexCount; i += 3) {
        const v = [0,1,2].map(j => new THREE.Vector3().fromBufferAttribute(p, idx.getX(i+j)).applyMatrix4(mesh.matrixWorld));
        triangleWoodArea += Math.abs(v[1].sub(v[0]).cross(v[2].sub(v[0])).dot(wind))/4;
      }
      const leaf = leaves(b);
      if (leaf) for (let i = 0; i < leaf.count; i++) {
        const m = new THREE.Matrix4(); leaf.getMatrixAt(i, m); m.premultiply(leaf.matrixWorld);
        const p = leaf.geometry.attributes.position, idx = leaf.geometry.index;
        for (let j = 0; j < (idx ? idx.count : p.count); j += 3) {
          const v = [0,1,2].map(k => new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(j+k) : j+k).applyMatrix4(m));
          triangleLeafArea += Math.abs(v[1].sub(v[0]).cross(v[2].sub(v[0])).dot(wind))/2;
        }
      }
    }
    dynamics.update(0, 3.2, 9.81, 1);
    const combinedLoad = { ...dynamics.stats };
    const leafKg = .12 * model.group.userData.canopyMetrics.oneSidedLeafAreaM2;
    assert.ok(Math.abs(dynamics.stats.estimatedMassKg - sectionKg - leafKg) < 1e-6, 'no missing wood or extra cylinder proxy');
    assert.ok(maxVolumeRelativeError < .001, 'section/frustum integration is an explicitly bounded mesh approximation, not exact polyhedral volume');
    dynamics.update(0, 3.2, 0, 1);
    // Wood and actual leaf triangles are independently recovered in the legacy
    // load audit as well; no radius/E/force/guard tuning is allowed here.
    assert.ok(Math.abs(triangleWoodArea/sectionArea-1) < .001);
    const recoveredForce = .5*1.225*.8*3.2**2*(sectionArea + triangleLeafArea/Math.sqrt(1+(3.2/12)**2));
    assert.ok(Math.abs(recoveredForce-dynamics.stats.windForceN) < 1e-6, 'actual blade triangles and final wood sections are counted exactly once');
    assert.equal(dynamics.stats.youngModulusPa, 8e9); assert.equal(dynamics.stats.clampedBranches, 0);
    assert.ok(dynamics.stats.maxUnclampedTargetRad < .1 && dynamics.stats.maxDeflectionRad <= .28);
    t.diagnostic(JSON.stringify({ sectionWoodKg: sectionKg, triangleWoodKg: triangleKg, maxVolumeRelativeError, sectionProjectedAreaM2: sectionArea, triangleWoodProjectedAreaM2: triangleWoodArea, triangleLeafProjectedAreaM2: triangleLeafArea, forceN: dynamics.stats.windForceN, windOnlyRawDemandRad: dynamics.stats.maxUnclampedTargetRad, combinedLoad }));
  } finally { dynamics.dispose(); model.dispose(); }
});

test('children depart the actual fixed parent tangent and selected branch births are zero-size continuous', () => {
  const adult = build(12, 73), samples = [];
  try {
    for (const b of adult.branches.filter(b => b.order === 1)) {
      const parentWood = b.pivot.parent.children.find(o => o.name === 'osmanthus-wood-axis');
      const s = b.pivot.userData.supportNode.materialS, ring = ringAt(parentWood.geometry, s);
      const c = center(ring), tangent = new THREE.Vector3();
      for (let i = 0; i < ring.length; i++) tangent.add(ring[i].clone().sub(c).cross(ring[(i+1)%ring.length].clone().sub(c)));
      tangent.normalize();
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(b.rest);
      assert.ok(Math.abs(Math.acos(Math.abs(tangent.dot(dir))) - b.pivot.userData.inclination) < 1e-5,
        'primary departure angle is relative to the actual parent section normal, not its original local Y');
    }
    for (const order of [1, 2, 3]) {
      const b = adult.branches.find(b => b.order === order); assert.ok(b);
      samples.push({ id: b.pivot.userData.axisId, birth: b.pivot.userData.birth });
    }
  } finally { adult.dispose(); }
  for (const { id, birth } of samples) {
    const before = build(birth - 1e-5, 73), at = build(birth, 73), after = build(birth + 1e-5, 73);
    try {
      assert.ok(!before.branches.some(b => b.pivot.userData.axisId === id));
      assert.ok(!at.branches.some(b => b.pivot.userData.axisId === id));
      const b = after.branches.find(b => b.pivot.userData.axisId === id); assert.ok(b && b.length < 1e-6 && b.radius < 1e-6);
      const g = wood(b).geometry; g.computeBoundingBox();
      assert.ok(g.boundingBox.getSize(new THREE.Vector3()).length() < 2e-6);
      assert.ok(g.attributes.position.array.every(Number.isFinite));
      assert.ok(g.attributes.normal.array.every(Number.isFinite));
      const a = new THREE.Box3().setFromObject(before.group), c = new THREE.Box3().setFromObject(after.group);
      assert.ok(a.min.distanceTo(c.min) < .0003 && a.max.distanceTo(c.max) < .0003);
      const dynamics = createBeamDynamics(after);
      try {
        dynamics.update(0, 3.2, 9.81, 1); dynamics.update(1/60, 3.2, 9.81, 1);
        for (const field of ['windForceN', 'estimatedMassKg', 'maxUnclampedTargetRad', 'maxDeflectionRad']) assert.ok(Number.isFinite(dynamics.stats[field]), field);
        for (const branch of after.branches) assert.ok(branch.pivot.quaternion.toArray().every(Number.isFinite));
      } finally { dynamics.dispose(); }
    } finally { before.dispose(); at.dispose(); after.dispose(); }
  }
});


test('leaf-only catalogue refinement retains recovered woody branch births, supports and rest transforms', () => {
  for (const [age,seed,density] of [[12,42,1],[80,73,1.8]]) {
    const params={age,seed,density,day:180},old=buildRecovered('osmanthus',params),fresh=buildPlant('osmanthus',params);
    try {
      assert.equal(fresh.branches.length,old.branches.length);
      const before=new Map(old.branches.map(b=>[b.pivot.userData.axisId,b]));
      let changedLeafOnlyNodes=0;
      for(const b of fresh.branches) {
        const a=before.get(b.pivot.userData.axisId);assert.ok(a);
        assert.equal(b.length,a.length,'extension clock remains unchanged');
        assert.equal(b.pivot.userData.birth,a.pivot.userData.birth,'woody birth remains unchanged');
        assert.deepEqual(b.pivot.position.toArray(),a.pivot.position.toArray(),'formed branch support is unchanged');
        assert.deepEqual(b.rest.toArray(),a.rest.toArray(),'formed branch direction is unchanged');
        if(b.order>0)assert.deepEqual(b.pivot.userData.supportNode,a.pivot.userData.supportNode,'wood-bearing material node catalogue remains intact');
        const oldNodes=new Map((leaves(a)?.userData.nodes??[]).map(n=>[n.index,n]));
        for(const n of leaves(b)?.userData.nodes??[])if(oldNodes.has(n.index)&&n.materialS!==oldNodes.get(n.index).materialS)changedLeafOnlyNodes++;
      }
      assert.ok(changedLeafOnlyNodes>0,'test the intentional cross-version leaf-only change');
      assert.equal(fresh.group.userData.architecture.leafCatalogue.lifetimePairsBound,old.group.userData.architecture.leafCatalogue.lifetimePairsBound);
    } finally {old.dispose();fresh.dispose();}
  }
});
