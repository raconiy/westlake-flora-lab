import * as THREE from 'three';
import type { PlantModel, BranchJoint } from './plant-engine';
import { woodSections, sectionVolume, sectionArmFactors, sectionProjectedArea } from './wood-loads.ts';

/** SI engineering priors, NOT measurements of Ginkgo/Osmanthus or a campus specimen. */
export interface BeamDynamicsOptions {
  youngModulusPa?: number;
  woodDensityKgM3?: number;
  leafArealMassKgM2?: number;
  airDensityKgM3?: number;
  dragCoefficient?: number;
  dampingRatio?: number;
  windDirection?: THREE.Vector3;
  gravityDirection?: THREE.Vector3;
  tipRadiusRatio?: number;
  reconfigurationSpeedMS?: number;
  maxWindMS?: number;
  maxDeflectionRad?: number;
  fixedStepSeconds?: number;
  maxCatchUpSeconds?: number;
}
export interface BeamDynamicsStats {
  windForceN: number;
  estimatedMassKg: number;
  maxDeflectionRad: number;
  /** Linear equilibrium demand BEFORE clipping, not a measured large-angle pose. */
  maxUnclampedTargetRad: number;
  maxWindTargetRad: number;
  maxGravityTargetRad: number;
  maxTargetBranchIndex: number;
  youngModulusPa: number;
  dragCoefficient: number;
  outOfRange: boolean;
  clampedBranches: number;
  droppedTimeSeconds: number;
  leafAreaM2: number;
  countedLeaves: number;
  resolvedWoodSegments: number;
  priorStatus: 'engineering-assumption';
}
interface LeafLoad { area: number; projectedArea: number; arm: number; }
interface BeamState {
  branch: BranchJoint; parent: number; attach: number;
  length: number; radius: number; woodMass: number; leafMass: number;
  woodArea: number; woodWindArm2: number; woodMassArm2: number; resolvedWood: boolean;
  subtreeMass: number; worldRest: THREE.Quaternion; leaves: LeafLoad[];
  leafWind: number; woodWind: number; subtreeWind: number;
  angleX: number; angleZ: number; velocityX: number; velocityZ: number;
  targetX: number; targetZ: number; omega: number;
}
const UP = new THREE.Vector3(0, 1, 0);
const finite = (n: number | undefined, fallback: number, min: number, max = Infinity) => Number.isFinite(n) ? Math.max(min, Math.min(max, n!)) : fallback;

/** Hierarchical lumped cantilevers, not FEM: direct child subtrees are applied once
 * at their attachment. Eccentric child moments, torsion, root/soil compliance,
 * collision, fracture, growth stress and fluid feedback are not solved.
 * Priors: E=8GPa, fresh wood density=550kg/m³, leaf areal mass=.12kg/m²,
 * Cd=.8, damping ratio=.28. These require specimen calibration.
 * Force definition: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/
 * Small-deflection reference: MIT OCW 1.050, Deflections due to Bending.
 * Rest-frame force projection is a first-order approximation; orientations and
 * leaf normals are not re-solved at every deformed-configuration iteration.
 * The displayed axis is rotated rigidly by its lumped end slope, rather than
 * deformed along a clamped-beam shape. Its basal ring may open on one side of a
 * fixed root flare even though the pivot and part of the ring still intersect.
 * EI uses nominal BranchJoint.radius, not reconstructed mesh section inertia,
 * and omits along-axis taper/curvature compliance and unioning branch overlaps.
 */
export function createBeamDynamics(model: PlantModel, options: BeamDynamicsOptions = {}) {
  const E = finite(options.youngModulusPa, 8e9, 1e3, 1e12);
  const density = finite(options.woodDensityKgM3, 550, 1, 3000);
  const leafArealMass = finite(options.leafArealMassKgM2, .12, 0, 5);
  const air = finite(options.airDensityKgM3, 1.225, 0, 20);
  const Cd = finite(options.dragCoefficient, .8, 0, 5);
  const damping = finite(options.dampingRatio, .28, .01, 3);
  const tip = finite(options.tipRadiusRatio, .5, .01, 1);
  const windLimit = finite(options.maxWindMS, 25, 1, 100);
  const angleLimit = finite(options.maxDeflectionRad, .28, .01, .5);
  const step = finite(options.fixedStepSeconds, 1 / 240, 1 / 2000, 1 / 60);
  const catchUp = finite(options.maxCatchUpSeconds, .2, step, .5);
  // Assumed area multiplier only, NOT measured streamlining or effective wind.
  // https://doi.org/10.1093/jxb/erz288 distinguishes these mechanisms.
  // https://doi.org/10.1111/j.1469-8137.2011.03887.x does not supply a
  // universal species-independent calibration for this 12 m/s speed.
  // Infinity explicitly disables this assumed law for calibration/tests.
  const reconfigure = options.reconfigurationSpeedMS === Infinity ? Infinity : finite(options.reconfigurationSpeedMS, 12, .01);
  const windDirection = (options.windDirection?.clone() || new THREE.Vector3(1, 0, .2)).normalize();
  const gravityDirection = (options.gravityDirection?.clone() || new THREE.Vector3(0, -1, 0)).normalize();
  const stats: BeamDynamicsStats = { windForceN: 0, estimatedMassKg: 0, maxDeflectionRad: 0, maxUnclampedTargetRad: 0, maxWindTargetRad: 0, maxGravityTargetRad: 0, maxTargetBranchIndex: -1, youngModulusPa: E, dragCoefficient: Cd, outOfRange: false, clampedBranches: 0, droppedTimeSeconds: 0, leafAreaM2: 0, countedLeaves: 0, resolvedWoodSegments: 0, priorStatus: 'engineering-assumption' };
  const owner = new Map<THREE.Object3D, number>();
  model.branches.forEach((b, i) => { owner.set(b.pivot, i); b.pivot.quaternion.copy(b.rest); });
  model.group.updateMatrixWorld(true);
  const states: BeamState[] = model.branches.map(branch => {
    const length = Math.max(1e-5, branch.length), radius = Math.max(1e-6, branch.radius);
    // Exact conical-frustum volume using the assumed tip/base radius ratio.
    const woodMass = density * Math.PI * radius * radius * length * (1 + tip + tip * tip) / 3;
    const axial = UP.clone().applyQuaternion(branch.pivot.getWorldQuaternion(new THREE.Quaternion())).dot(windDirection);
    const woodArea = radius * length * (1 + tip) * Math.sqrt(Math.max(0, 1 - axial * axial));
    let parent = branch.pivot.parent; while (parent && !owner.has(parent)) parent = parent.parent;
    return { branch, parent: parent ? owner.get(parent)! : -1, attach: 0, length, radius, woodMass, woodArea, woodWindArm2: woodArea * length ** 2 / 6, woodMassArm2: woodMass * length ** 2 / 6, resolvedWood: false, leafMass: 0, subtreeMass: woodMass, worldRest: branch.pivot.getWorldQuaternion(new THREE.Quaternion()), leaves: [], leafWind: 0, woodWind: 0, subtreeWind: 0, angleX: 0, angleZ: 0, velocityX: 0, velocityZ: 0, targetX: 0, targetZ: 0, omega: 0 };
  });
  for (const s of states) if (s.parent >= 0) {
    const parent = states[s.parent];
    const attachment = parent.branch.pivot.worldToLocal(s.branch.pivot.getWorldPosition(new THREE.Vector3()));
    s.attach = THREE.MathUtils.clamp(attachment.y, 0, parent.length);
  }
  const children = states.map(() => [] as number[]);
  states.forEach((s, i) => { if (s.parent >= 0) children[s.parent].push(i); });
  const stateIndex = new Map(states.map((s, i) => [s, i]));
  // Merged fine shoots are still real wood: collect their actual mesh sections
  // once, assigning each to its nearest dynamic owner. Never add an equivalent
  // primary frustum on top of resolved geometry. Arms are lumped onto the owner
  // beam; off-axis torsion and deformation of merged twigs remain unsolved.
  model.group.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.geometry) return;
    let parent: THREE.Object3D | null = mesh;
    while (parent && !owner.has(parent)) {
      if (['leaf', 'root', 'rhizome', 'seed', 'bud', 'flower'].includes(parent.userData.organ)) return;
      parent = parent.parent;
    }
    if (!parent || parent.userData.woody === false) return;
    const sections = woodSections(mesh.geometry); if (!sections.length) return;
    const state = states[owner.get(parent)!];
    if (!state.resolvedWood) {
      state.woodMass = state.woodArea = state.woodWindArm2 = state.woodMassArm2 = 0;
      state.resolvedWood = true;
    }
    const volumeScale = Math.abs(mesh.matrixWorld.determinant());
    for (const section of sections) {
      const a = new THREE.Vector3(...section.a), b = new THREE.Vector3(...section.b), localLength = a.distanceTo(b);
      a.applyMatrix4(mesh.matrixWorld); b.applyMatrix4(mesh.matrixWorld);
      const length = a.distanceTo(b); if (!(localLength > 0 && length > 0)) continue;
      const mass = density * sectionVolume(section) * volumeScale;
      const area = sectionProjectedArea(section, mesh.matrixWorld, windDirection);
      const armA = state.branch.pivot.worldToLocal(a.clone()).y, armB = state.branch.pivot.worldToLocal(b.clone()).y;
      const factors = sectionArmFactors(section, armA, armB, state.length);
      state.woodMass += mass; state.woodArea += area;
      state.woodMassArm2 += mass * factors.mass; state.woodWindArm2 += area * factors.drag;
      stats.resolvedWoodSegments++;
    }
    state.subtreeMass = state.woodMass;
  });
  // Precompute one-sided blade areas from actual triangles; each instance has its
  // own scale/rotation. Cylinder petioles are excluded from leaf count and mass.
  // Transform each triangle's area vector: folded normals can cancel and a
  // mean-normal area scale is incorrect under anisotropic scaling. Summing
  // absolute projections is an unshielded blade proxy (either side counts once);
  // overlapping
  // folds/crown sheltering and aerodynamic interactions remain unsolved.
  const geometryCache = new Map<THREE.BufferGeometry, THREE.Vector3[]>();
  function bladeGeometry(geometry: THREE.BufferGeometry) {
    let record = geometryCache.get(geometry); if (record) return record;
    const pos = geometry.getAttribute('position'), idx = geometry.index;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), triangles: THREE.Vector3[] = [];
    const count = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t); b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1); c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2);
      triangles.push(new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).multiplyScalar(.5));
    }
    geometryCache.set(geometry, triangles); return triangles;
  }
  const instance = new THREE.Matrix4(), transform = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), center = new THREE.Vector3(), areaVector = new THREE.Vector3();
  model.group.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.organ !== 'leaf' || !mesh.geometry || mesh.geometry.type === 'CylinderGeometry' || mesh.userData.organPart === 'petiole') return;
    let parent: THREE.Object3D | null = mesh.parent; while (parent && !owner.has(parent)) parent = parent.parent;
    if (!parent) return; const state = states[owner.get(parent)!], shape = bladeGeometry(mesh.geometry);
    const count = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); mesh.geometry.boundingBox!.getCenter(center);
    for (let i = 0; i < count; i++) {
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) { (mesh as THREE.InstancedMesh).getMatrixAt(i, instance); transform.multiplyMatrices(mesh.matrixWorld, instance); } else transform.copy(mesh.matrixWorld);
      normalMatrix.getNormalMatrix(transform);
      const determinant = Math.abs(transform.determinant()); let area = 0, projectedArea = 0;
      for (const triangle of shape) {
        areaVector.copy(triangle).applyMatrix3(normalMatrix).multiplyScalar(determinant);
        area += areaVector.length(); projectedArea += Math.abs(areaVector.dot(windDirection));
      }
      if (!(area > 0) || !Number.isFinite(area)) continue;
      const localCenter = state.branch.pivot.worldToLocal(center.clone().applyMatrix4(transform));
      const arm = THREE.MathUtils.clamp(localCenter.y, 0, state.length);
      state.leaves.push({ area, projectedArea, arm }); state.leafMass += area * leafArealMass;
      stats.leafAreaM2 += area; stats.countedLeaves++;
    }
  });
  // Explicit postorder: does not assume branch array is already topologically sorted.
  const depth = (i: number) => { let d = 0, p = states[i].parent; while (p >= 0 && d <= states.length) { d++; p = states[p].parent; } return d; };
  const postorder = states.map((_, i) => i).sort((a, b) => depth(b) - depth(a));
  for (const s of states) { s.subtreeMass += s.leafMass; stats.estimatedMassKg += s.woodMass + s.leafMass; }
  for (const i of postorder) if (states[i].parent >= 0) states[states[i].parent].subtreeMass += states[i].subtreeMass;
  const localWind = new THREE.Vector3(), localGravity = new THREE.Vector3(), axis = new THREE.Vector3(), rotation = new THREE.Quaternion();
  let previousTime: number | null = null, accumulator = 0, disposed = false;

  function update(timeSeconds: number, windMS: number, gravityMS2: number, stiffnessMultiplier: number) {
    if (disposed) return;
    stats.outOfRange = false; stats.clampedBranches = 0;
    stats.maxUnclampedTargetRad = stats.maxWindTargetRad = stats.maxGravityTargetRad = 0; stats.maxTargetBranchIndex = -1;
    const rawWind = Number.isFinite(windMS) ? windMS : 0, speed = Math.min(windLimit, Math.abs(rawWind));
    const gravity = finite(gravityMS2, 9.81, 0, 30), stiffness = finite(stiffnessMultiplier, 1, .05, 20);
    if (!Number.isFinite(windMS) || !Number.isFinite(gravityMS2) || !Number.isFinite(stiffnessMultiplier) || Math.abs(rawWind) > windLimit || gravityMS2 < 0 || gravityMS2 > 30 || stiffnessMultiplier < .05 || stiffnessMultiplier > 20) stats.outOfRange = true;
    stats.youngModulusPa = E * stiffness; stats.windForceN = 0;
    const pressure = .5 * air * Cd * speed * speed;
    const areaReduction = 1 / Math.sqrt(1 + (speed / reconfigure) ** 2);
    for (const s of states) {
      s.woodWind = pressure * s.woodArea; s.leafWind = 0;
      for (const leaf of s.leaves) s.leafWind += pressure * leaf.projectedArea * areaReduction;
      s.subtreeWind = s.woodWind + s.leafWind; stats.windForceN += s.subtreeWind;
    }
    for (const i of postorder) if (states[i].parent >= 0) states[states[i].parent].subtreeWind += states[i].subtreeWind;
    for (const s of states) {
      const inverse = s.worldRest.clone().invert(); localWind.copy(windDirection).multiplyScalar(rawWind < 0 ? -1 : 1).applyQuaternion(inverse); localGravity.copy(gravityDirection).applyQuaternion(inverse);
      const EI = E * stiffness * Math.PI * s.radius ** 4 / 4;
      // End slope: point force at a -> F a²/(2EI); distributed force -> F L²/(6EI).
      let windSlope = pressure * s.woodWindArm2 / EI;
      let gravitySlope = gravity * s.woodMassArm2 / EI;
      for (const leaf of s.leaves) { windSlope += pressure * leaf.projectedArea * areaReduction * leaf.arm ** 2 / (2 * EI); gravitySlope += leaf.area * leafArealMass * gravity * leaf.arm ** 2 / (2 * EI); }
      // Direct children only: the already accumulated subtree is never counted twice.
      for (const childIndex of children[stateIndex.get(s)!]) { const child = states[childIndex]; windSlope += child.subtreeWind * child.attach ** 2 / (2 * EI); gravitySlope += child.subtreeMass * gravity * child.attach ** 2 / (2 * EI); }
      s.targetX = localWind.z * windSlope + localGravity.z * gravitySlope;
      s.targetZ = -localWind.x * windSlope - localGravity.x * gravitySlope;
      const targetLength = Math.hypot(s.targetX, s.targetZ);
      stats.maxWindTargetRad = Math.max(stats.maxWindTargetRad, Math.hypot(localWind.x, localWind.z) * windSlope);
      stats.maxGravityTargetRad = Math.max(stats.maxGravityTargetRad, Math.hypot(localGravity.x, localGravity.z) * gravitySlope);
      if (targetLength > stats.maxUnclampedTargetRad) { stats.maxUnclampedTargetRad = targetLength; stats.maxTargetBranchIndex = stateIndex.get(s)!; }
      if (targetLength > angleLimit) { const ratio = angleLimit / targetLength; s.targetX *= ratio; s.targetZ *= ratio; stats.clampedBranches++; stats.outOfRange = true; }
      const effectiveMass = Math.max(1e-10, .236 * s.woodMass + s.leafMass + Math.max(0, s.subtreeMass - s.woodMass - s.leafMass));
      s.omega = Math.sqrt(3 * EI / (s.length ** 3 * effectiveMass));
    }
    const time = Number.isFinite(timeSeconds) ? timeSeconds : previousTime ?? 0;
    if (previousTime === null) previousTime = time;
    const elapsed = time - previousTime; previousTime = time;
    if (elapsed < 0) { accumulator = 0; for (const s of states) { s.angleX = s.angleZ = s.velocityX = s.velocityZ = 0; } }
    else { accumulator += Math.min(catchUp, elapsed); if (elapsed > catchUp) { stats.droppedTimeSeconds += elapsed - catchUp; stats.outOfRange = true; } }
    let substeps = Math.floor((accumulator + 1e-12) / step); accumulator -= substeps * step;
    while (substeps-- > 0) for (const s of states) {
      const w2 = s.omega * s.omega, drag = 2 * damping * s.omega;
      // Semi-implicit Euler for resolved modes. Very stiff modes use the implicit
      // spring denominator to prevent instability (numerical high-mode damping,
      // not an invented low natural frequency or a prescribed sine animation).
      const denominator = 1 + drag * step + (s.omega * step > .5 ? w2 * step * step : 0);
      s.velocityX = (s.velocityX + step * w2 * (s.targetX - s.angleX)) / denominator;
      s.velocityZ = (s.velocityZ + step * w2 * (s.targetZ - s.angleZ)) / denominator;
      s.angleX += step * s.velocityX; s.angleZ += step * s.velocityZ;
      const magnitude = Math.hypot(s.angleX, s.angleZ);
      if (magnitude > angleLimit) { const scale = angleLimit / magnitude; s.angleX *= scale; s.angleZ *= scale; s.velocityX = s.velocityZ = 0; stats.outOfRange = true; }
    }
    stats.maxDeflectionRad = 0;
    for (const s of states) {
      const angle = Math.hypot(s.angleX, s.angleZ); stats.maxDeflectionRad = Math.max(stats.maxDeflectionRad, angle);
      if (angle > 1e-15) { axis.set(s.angleX / angle, 0, s.angleZ / angle); rotation.setFromAxisAngle(axis, angle); s.branch.pivot.quaternion.copy(s.branch.rest).multiply(rotation); }
      else s.branch.pivot.quaternion.copy(s.branch.rest);
    }
  }
  return { update, stats, dispose() { disposed = true; geometryCache.clear(); } };
}
