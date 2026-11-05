import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlant } from './plant-engine.ts';
import { createBeamDynamics } from './beam-dynamics.ts';
import { woodSections, sectionVolume } from './wood-loads.ts';
import { osmanthusSupportedRadius, osmanthusPriors } from './osmanthus-lifecycle.ts';

const build = (age = 12, overrides = {}) => buildPlant('osmanthus', { age, day: 270, seed: 42, density: 1, ...overrides });
const up = new THREE.Vector3(0, 1, 0);

/** Independent rest-pose audit of the SAME mesh loads, not an alternate runtime
 * solver. Circular base EI and child-resultant-at-attachment match the current
 * lumped beam assumptions. Triangle centroids/projections avoid fitting loads to
 * metadata. A separate tapered/eccentric sensitivity includes child moments and
 * the actual .49 tip/base taper. Neither estimate is a nonlinear beam solution.
 */
export function audit(model, wind = 3.2, gravity = 9.81) {
  for (const b of model.branches) b.pivot.quaternion.copy(b.rest);
  model.group.updateMatrixWorld(true);
  const owners = new Map();
  const rows = model.branches.map(b => {
    const row = { b, id: b.pivot.userData.axisId, order: b.order, lengthCm: b.length * 100,
      radiusMm: b.radius * 1000, slenderness: b.length / (2 * b.radius),
      woodKg: 0, leafM2: 0, leafCount: 0, windN: 0, windArm2: 0, massArm2: 0, children: [],
      origin: b.pivot.getWorldPosition(new THREE.Vector3()), axis: up.clone().applyQuaternion(b.pivot.getWorldQuaternion(new THREE.Quaternion())),
      force: new THREE.Vector3(), moment: new THREE.Vector3(), taperAngle: new THREE.Vector3() };
    owners.set(b.pivot, row); return row;
  });
  const windDirection = new THREE.Vector3(1, 0, .2).normalize();
  const pressure = .5 * 1.225 * .8 * wind ** 2, reduction = 1 / Math.sqrt(1 + (wind / 12) ** 2);
  const m = new THREE.Matrix4(), world = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  // Integrals of 1/EI(x) and x/EI(x) for r(x)=r0*(1-.51*x/L).
  function compliance(row, arm) {
    const L = row.b.length, EI = 8e9 * Math.PI * row.b.radius ** 4 / 4, k = .51;
    const u = 1 - k * arm / L;
    return [L * (u ** -3 - 1) / (3 * k * EI),
      L ** 2 * ((u ** -3 - 1) / 3 - (u ** -2 - 1) / 2) / (k ** 2 * EI)];
  }
  function pointLoad(row, position, mass, windForce) {
    const force = windDirection.clone().multiplyScalar(windForce).addScaledVector(up, -mass * gravity);
    const offset = position.clone().sub(row.origin), moment = offset.clone().cross(force);
    const arm = THREE.MathUtils.clamp(offset.dot(row.axis), 0, row.b.length), [c0, c1] = compliance(row, arm);
    row.force.add(force); row.moment.add(moment);
    row.taperAngle.addScaledVector(moment, c0).addScaledVector(row.axis.clone().cross(force), -c1);
  }
  for (const row of rows) {
    const parent = owners.get(row.b.pivot.parent);
    if (parent) parent.children.push(row);
    // Each axis's immediate meshes belong to it, never to its ancestors too.
    for (const mesh of row.b.pivot.children) {
      if (!mesh.isMesh) continue;
      if (!mesh.isInstancedMesh && !mesh.userData.organ) {
        for (const s of woodSections(mesh.geometry)) {
          a.fromArray(s.a).applyMatrix4(mesh.matrixWorld); b.fromArray(s.b).applyMatrix4(mesh.matrixWorld);
          const length = a.distanceTo(b), axial = b.clone().sub(a).normalize().dot(windDirection);
          const mass = 550 * sectionVolume(s) * Math.abs(mesh.matrixWorld.determinant());
          const force = pressure * (Math.sqrt(s.areaA / Math.PI) + Math.sqrt(s.areaB / Math.PI)) * length * Math.sqrt(Math.max(0, 1 - axial ** 2));
          const center = a.add(b).multiplyScalar(.5);
          pointLoad(row, center, mass, force);
          const arm = THREE.MathUtils.clamp(row.b.pivot.worldToLocal(center).y, 0, row.b.length);
          row.woodKg += mass; row.windN += force;
          row.massArm2 += mass * arm ** 2 / 2; row.windArm2 += force * arm ** 2 / 2;
        }
      }
      if (!mesh.isInstancedMesh || mesh.userData.connectedBy !== 'petiole') continue;
      const p = mesh.geometry.attributes.position, idx = mesh.geometry.index;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m); world.multiplyMatrices(mesh.matrixWorld, m); row.leafCount++;
        for (let j = 0; j < (idx ? idx.count : p.count); j += 3) {
          a.fromBufferAttribute(p, idx ? idx.getX(j) : j).applyMatrix4(world);
          b.fromBufferAttribute(p, idx ? idx.getX(j + 1) : j + 1).applyMatrix4(world);
          c.fromBufferAttribute(p, idx ? idx.getX(j + 2) : j + 2).applyMatrix4(world);
          const center = a.clone().add(b).add(c).divideScalar(3);
          const cross = b.sub(a).cross(c.sub(a)).multiplyScalar(.5), area = cross.length();
          const force = pressure * Math.abs(cross.dot(windDirection)) * reduction;
          pointLoad(row, center, .12 * area, force);
          const arm = THREE.MathUtils.clamp(row.b.pivot.worldToLocal(center).y, 0, row.b.length);
          row.leafM2 += area; row.windN += force;
          row.massArm2 += .12 * area * arm ** 2 / 2; row.windArm2 += force * arm ** 2 / 2;
        }
      }
    }
  }
  for (const row of [...rows].reverse()) {
    row.descendantKg = row.children.reduce((s, c) => s + c.subtreeKg, 0);
    row.subtreeKg = row.woodKg + .12 * row.leafM2 + row.descendantKg;
    row.subtreeWindN = row.windN + row.children.reduce((s, c) => s + c.subtreeWindN, 0);
    row.subtreeLeafM2 = row.leafM2 + row.children.reduce((s, c) => s + c.subtreeLeafM2, 0);
    let massArm2 = row.massArm2, windArm2 = row.windArm2;
    for (const child of row.children) {
      const arm = THREE.MathUtils.clamp(child.b.pivot.position.y, 0, row.b.length);
      massArm2 += child.subtreeKg * arm ** 2 / 2; windArm2 += child.subtreeWindN * arm ** 2 / 2;
      const moment = child.moment.clone().add(child.origin.clone().sub(row.origin).cross(child.force));
      const [c0, c1] = compliance(row, arm);
      row.taperAngle.addScaledVector(moment, c0).addScaledVector(row.axis.clone().cross(child.force), -c1);
      row.force.add(child.force); row.moment.add(moment);
    }
    const inverse = row.b.pivot.getWorldQuaternion(new THREE.Quaternion()).invert();
    const w = windDirection.clone().applyQuaternion(inverse), g = up.clone().negate().applyQuaternion(inverse);
    const EI = 8e9 * Math.PI * row.b.radius ** 4 / 4;
    row.windRad = Math.hypot(w.x, w.z) * windArm2 / EI;
    row.gravityRad = Math.hypot(g.x, g.z) * gravity * massArm2 / EI;
    row.demandRad = Math.hypot(w.z * windArm2 + g.z * gravity * massArm2, w.x * windArm2 + g.x * gravity * massArm2) / EI;
    row.taperEccentricRad = row.taperAngle.projectOnPlane(row.axis).length();
  }
  return rows.sort((a, b) => b.demandRad - a.demandRad);
}

// Reconstruct only the old diameters on a fresh model, for a reproducible
// before/after control with identical lengths, nodes, blades and randomness.
function replaceRadii(model, radiusAt) {
  for (const branch of model.branches) {
    branch.radius = radiusAt(branch);
    const wood = branch.pivot.children.find(o => o.isMesh && !o.isInstancedMesh && o.geometry.type === 'CylinderGeometry');
    if (!wood) continue;
    wood.geometry.dispose();
    wood.geometry = new THREE.CylinderGeometry(branch.radius * .49, branch.radius, branch.length, branch.radius > .04 ? 10 : 6, 1);
  }
}
const restoreOrderOnlyRadii = model => replaceRadii(model, b => b.pivot.userData.secondaryThickening.ageOrderFloorM);

const clean = ({ b, children, origin, axis, force, moment, taperAngle, ...r }) => r;
if (process.env.OSMANTHUS_LOAD_PROBE) {
  for (const age of [2, 8, 12, 40]) for (const variant of ['before', 'after']) {
    const model = build(age);
    if (variant === 'before') restoreOrderOnlyRadii(model);
    const actualRows = audit(model), actualDynamics = createBeamDynamics(model);
    actualDynamics.update(0, 3.2, 9.81, 1);
    console.log(JSON.stringify({ age, variant, axes: actualRows.length, leaves: model.leafCount,
      canopy: model.group.userData.canopyMetrics, solver: actualDynamics.stats,
      auditMassKg: actualRows.reduce((s, r) => s + r.woodKg + .12 * r.leafM2, 0),
      auditClamped: actualRows.filter(r => r.demandRad > .28).length,
      maxWindRad: Math.max(...actualRows.map(r => r.windRad)), maxGravityRad: Math.max(...actualRows.map(r => r.gravityRad)),
      maxTaperEccentricRad: Math.max(...actualRows.map(r => r.taperEccentricRad)),
      worst: actualRows.slice(0, 3).map(clean),
      worstWithDescendants: clean(actualRows.find(r => r.children.length) ?? actualRows[0]),
      previousWorst: actualRows.find(r => r.id === 'leader/4:1/1:1/1:0') && clean(actualRows.find(r => r.id === 'leader/4:1/1:1/1:0')) }));
    actualDynamics.dispose(); model.dispose();
  }
  // Deliberately broad coefficient perturbations, not claimed species ranges.
  // These expose dependence on the uncalibrated budgets instead of presenting
  // a single successful default as a uniquely validated biological diameter.
  for (const [diameterFactor, areaRatioFactor] of [[.7, 2], [1.3, .5]]) {
    const model = build();
    replaceRadii(model, b => Math.max(b.pivot.userData.secondaryThickening.ageOrderFloorM,
      .005 * diameterFactor * b.length ** 1.5,
      Math.sqrt(b.pivot.userData.secondaryThickening.supportedLeafAreaM2 / (Math.PI * 2500 * areaRatioFactor))));
    const rows = audit(model), dynamics = createBeamDynamics(model); dynamics.update(0, 3.2, 9.81, 1);
    console.log(JSON.stringify({ sensitivity: { diameterFactor, areaRatioFactor },
      massKg: dynamics.stats.estimatedMassKg, clamped: dynamics.stats.clampedBranches,
      demandRad: rows[0].demandRad, maxTaperEccentricRad: Math.max(...rows.map(r => r.taperEccentricRad)) }));
    dynamics.dispose(); model.dispose();
  }
}

if (!process.env.OSMANTHUS_LOAD_PROBE) {
  test('mesh audit recovers analytical tip-load slopes for a uniform base EI and a tapered beam', () => {
    const group = new THREE.Group(), pivot = new THREE.Group(); group.add(pivot);
    pivot.quaternion.setFromUnitVectors(up, new THREE.Vector3(1, 0, 0));
    pivot.userData.axisId = 'analytical-fixture';
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.01, 1, -.01, .01, 1, -.01, 0, 1, .02], 3));
    const material = new THREE.MeshBasicMaterial(), leaf = new THREE.InstancedMesh(geometry, material, 1);
    leaf.setMatrixAt(0, new THREE.Matrix4()); leaf.userData = { organ: 'leaf', connectedBy: 'petiole' }; pivot.add(leaf);
    const branch = { pivot, rest: pivot.quaternion.clone(), length: 1, radius: .01, order: 0 };
    try {
      const [row] = audit({ group, branches: [branch] }, 0, 9.81);
      const force = row.leafM2 * .12 * 9.81, EI = 8e9 * Math.PI * .01 ** 4 / 4, t = .49;
      assert.ok(Math.abs(row.demandRad / (force / (2 * EI)) - 1) < 1e-12);
      const taperedSlope = force / EI * (t ** -2 / 6 - .5 + t / 3) / (1 - t) ** 2;
      assert.ok(Math.abs(row.taperEccentricRad / taperedSlope - 1) < 1e-12);
    } finally { geometry.dispose(); material.dispose(); leaf.dispose(); }
  });

  test('secondary thickening obeys elastic-similarity self-weight scaling and additive pipe support', () => {
    const selfSlope = length => {
      const radius = osmanthusSupportedRadius(length, 0, 0);
      const g = new THREE.CylinderGeometry(radius * .49, radius, length, 6, 1);
      try {
        return woodSections(g).reduce((sum, s) => {
          const arm = (s.a[1] + s.b[1]) / 2 + length / 2;
          return sum + sectionVolume(s) * 550 * 9.81 * arm ** 2 / 2;
        }, 0) / (8e9 * Math.PI * radius ** 4 / 4);
      } finally { g.dispose(); }
    };
    assert.ok(Math.abs(selfSlope(.5) / selfSlope(2) - 1) < 1e-6,
      'fourfold axial extension with elastic-similarity thickening preserves self-weight end slope');
    const rA = osmanthusSupportedRadius(.01, .03, 0), rB = osmanthusSupportedRadius(.01, .07, 0);
    const rAB = osmanthusSupportedRadius(.01, .10, 0);
    assert.ok(Math.abs(rA ** 2 + rB ** 2 - rAB ** 2) < 1e-18, 'conducting section areas add at forks');
    assert.equal(osmanthusSupportedRadius(.01, .03, .02), .02, 'existing woody radius is retained');
    assert.match(osmanthusPriors.secondaryThickening.status, /uncalibrated/);
  });

  test('actual mesh masses and descendant support are counted once, without a primary proxy on top', () => {
    const model = build(), dynamics = createBeamDynamics(model);
    try {
      const rows = audit(model), root = rows.find(r => r.order === 0);
      const totalArea = rows.reduce((s, r) => s + r.leafM2, 0);
      const totalMass = rows.reduce((s, r) => s + r.woodKg + .12 * r.leafM2, 0);
      const analyticWood = model.branches.reduce((s, b) => s + 550 * Math.PI * b.radius ** 2 * b.length * (1 + .49 + .49 ** 2) / 3, 0);
      assert.ok(Math.abs(rows.reduce((s, r) => s + r.woodKg, 0) / analyticWood - 1) < 1e-6);
      assert.ok(Math.abs(totalMass - dynamics.stats.estimatedMassKg) < 1e-7);
      assert.ok(Math.abs(root.subtreeKg - totalMass) < 1e-10);
      assert.equal(rows.reduce((s, r) => s + r.leafCount, 0), model.leafCount);
      assert.equal(dynamics.stats.countedLeaves, model.leafCount);
      assert.ok(Math.abs(totalArea - model.group.userData.canopyMetrics.oneSidedLeafAreaM2) < 1e-6);
      for (const r of rows) {
        assert.ok(Math.abs(r.b.pivot.userData.secondaryThickening.supportedLeafAreaM2 - r.subtreeLeafM2) < 1e-6);
        assert.ok(Math.abs(r.descendantKg - r.children.reduce((s, c) => s + c.subtreeKg, 0)) < 1e-12);
      }
    } finally { dynamics.dispose(); model.dispose(); }
  });

  test('default crown preserves actual foliage and supports while resolving the order-only slenderness failure', () => {
    const before = build(), after = build(); restoreOrderOnlyRadii(before);
    const oldDynamics = createBeamDynamics(before), dynamics = createBeamDynamics(after);
    try {
      const oldRows = audit(before), rows = audit(after);
      oldDynamics.update(0, 3.2, 9.81, 1); dynamics.update(0, 3.2, 9.81, 1);
      assert.ok(oldRows[0].demandRad > 10 && oldDynamics.stats.clampedBranches > 190, 'control reproduces the reported incompatibility');
      assert.ok(rows[0].demandRad < .1, 'unbounded demand lies in a small-angle regime');
      assert.ok(Math.max(...rows.map(r => r.taperEccentricRad)) < .2,
        'actual taper and eccentric descendant moments do not restore the old large-angle failure');
      for (const [wind, gravity] of [[3.2, 9.81], [3.2, 0], [0, 9.81]]) {
        dynamics.update(0, wind, gravity, 1);
        assert.equal(dynamics.stats.clampedBranches, 0); assert.equal(dynamics.stats.outOfRange, false);
      }
      assert.equal(dynamics.stats.youngModulusPa, 8e9);
      assert.ok(dynamics.stats.estimatedMassKg > oldDynamics.stats.estimatedMassKg, 'thicker actual wood contributes extra weight');
      assert.ok(dynamics.stats.windForceN === 0); // Last case is gravity-only.
      dynamics.update(0, 25, 19.62, .2);
      assert.ok(dynamics.stats.outOfRange && dynamics.stats.clampedBranches > 0, 'large loads still expose the existing guard');
      assert.deepEqual(after.group.userData.canopyMetrics, before.group.userData.canopyMetrics);
      assert.equal(after.leafCount, before.leafCount);
      const byId = new Map(oldRows.map(r => [r.id, r]));
      for (const r of rows) {
        const old = byId.get(r.id);
        assert.equal(r.b.length, old.b.length); assert.deepEqual(r.b.rest, old.b.rest);
        assert.deepEqual(r.b.pivot.position, old.b.pivot.position);
        assert.deepEqual(r.b.pivot.userData.supportNode, old.b.pivot.userData.supportNode);
        const leaves = pivot => pivot.children.find(o => o.userData.connectedBy === 'petiole');
        if (leaves(r.b.pivot)) assert.deepEqual(leaves(r.b.pivot).instanceMatrix.array, leaves(old.b.pivot).instanceMatrix.array);
      }
      const worst = byId.get('leader/4:1/1:1/1:0'), improved = rows.find(r => r.id === worst.id);
      assert.ok(worst.slenderness > 600 && improved.slenderness < 100);
    } finally { oldDynamics.dispose(); dynamics.dispose(); before.dispose(); after.dispose(); }
  });

  test('secondary growth is monotone and seasonal flower disappearance never thins wood', () => {
    let previous, previousAge = 0;
    for (const age of [.5, 2, 8, 12, 40, 120]) {
      const model = build(age);
      try {
        const now = new Map(model.branches.map(b => [b.pivot.userData.axisId, b]));
        if (previous) for (const [id, old] of previous) {
          const b = now.get(id); assert.ok(b);
          assert.ok(b.radius >= old.radius && b.length >= old.length);
          // Existing seed-coat loss raises the collar until .9 y; it does not
          // translate established lateral material supports after establishment.
          if (b.order > 0 || previousAge >= .9) assert.deepEqual(b.pivot.position, old.pivot.position);
          assert.deepEqual(b.rest, old.rest);
        }
        previous = now; previousAge = age;
      } finally { model.dispose(); }
    }
    const winter = build(12, { day: 15 }), flowering = build(12, { day: 280 });
    try {
      assert.deepEqual(winter.branches.map(b => b.radius), flowering.branches.map(b => b.radius));
      assert.deepEqual(winter.branches.map(b => b.pivot.userData.secondaryThickening), flowering.branches.map(b => b.pivot.userData.secondaryThickening));
    } finally { winter.dispose(); flowering.dispose(); }
  });

  test('new woody axes start at zero size at actual keyed branch births', () => {
    const adult = build(40);
    const samples = [1, 2, 3].flatMap(order => {
      const branches = adult.branches.filter(b => b.order === order);
      return [branches[0], branches.at(-1)].map(b => ({ id: b.pivot.userData.axisId, birth: b.pivot.userData.birth }));
    });
    adult.dispose();
    for (const { id, birth } of samples) {
      const before = build(birth - 1e-5), after = build(birth + 1e-5);
      try {
        assert.ok(!before.branches.some(b => b.pivot.userData.axisId === id));
        const newborn = after.branches.find(b => b.pivot.userData.axisId === id);
        assert.ok(newborn && newborn.length < 1e-6 && newborn.radius < 1e-6);
        const old = new Map(before.branches.map(b => [b.pivot.userData.axisId, b]));
        for (const b of after.branches) if (old.has(b.pivot.userData.axisId)) {
          const previous = old.get(b.pivot.userData.axisId);
          assert.ok(Math.abs(b.radius - previous.radius) < 1e-5);
          assert.deepEqual(b.pivot.position, previous.pivot.position);
        }
      } finally { before.dispose(); after.dispose(); }
    }
  });
}
