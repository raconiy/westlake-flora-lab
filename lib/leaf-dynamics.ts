import * as THREE from 'three';
import {STRIP_ATTRIBUTES} from './herb-leaf-dynamics.ts';

/** Shared engineering assumptions, NOT measured species/campus material data.
 * SI: length/thickness m, E Pa, areal mass kg/m², velocity m/s, gravity m/s².
 * Equivalent isotropic blade strip under uniform transverse pressure:
 * I=b*t³/12, q=p*b, w_tip=q*L⁴/(8EI)=1.5*p*L⁴/(E*t³).
 * Width cancels; thickness and E represent the blade INCLUDING veins.
 * References for equations (not for these assumed material values):
 * https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/
 * https://eng.libretexts.org/Bookshelves/Mechanical_Engineering/Mechanics_of_Materials_(Roylance)/04%3A_Bending/4.03%3A_Beam_Displacements
 * Quasi-static first bending shape, not FEM or aeroelastic flutter. No inertia,
 * torsion, leaf/air feedback, petiole compliance or species calibration is solved.
 * A slope/deflection limiter confines use outside the small-deflection regime;
 * its saturated result is a bounded approximation, not a large-deflection solver.
 */
export const LEAF_PRIORS = Object.freeze({
  youngModulusPa: 2e8, thicknessM: .0003, arealMassKgM2: .12,
  airDensityKgM3: 1.225, dragCoefficient: .8, maxTipRatio: .12,
  priorStatus: 'engineering-assumption' as const,
});
const finite = (x: number, fallback: number, lo: number, hi: number) => Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;

/** CPU reference also used for dimensional/load tests. Normal velocity is signed.
 * Returns tip displacement in metres, positive along the undeformed blade normal.
 */
export function leafTipDisplacement(lengthM: number, normalWindMS: number, normalGravityMS2: number,
  options: Partial<{[K in Exclude<keyof typeof LEAF_PRIORS, 'priorStatus'>]: number}> = {}) {
  const L = finite(lengthM, 0, 0, 2), t = finite(options.thicknessM ?? LEAF_PRIORS.thicknessM, LEAF_PRIORS.thicknessM, 1e-5, .01);
  const E = finite(options.youngModulusPa ?? LEAF_PRIORS.youngModulusPa, LEAF_PRIORS.youngModulusPa, 1e4, 1e12);
  const mu = finite(options.arealMassKgM2 ?? LEAF_PRIORS.arealMassKgM2, LEAF_PRIORS.arealMassKgM2, 0, 5);
  const air = finite(options.airDensityKgM3 ?? LEAF_PRIORS.airDensityKgM3, LEAF_PRIORS.airDensityKgM3, 0, 20);
  const cd = finite(options.dragCoefficient ?? LEAF_PRIORS.dragCoefficient, LEAF_PRIORS.dragCoefficient, 0, 5);
  const limit = finite(options.maxTipRatio ?? LEAF_PRIORS.maxTipRatio, LEAF_PRIORS.maxTipRatio, .001, .2);
  const u = finite(normalWindMS, 0, -25, 25), g = finite(normalGravityMS2, 0, -30, 30);
  const pressurePa = .5 * air * cd * u * Math.abs(u) + mu * g;
  const x = 1.5 * pressurePa / E * (L / t) ** 3 / limit;
  return L * limit * x / Math.hypot(1, x);
}
/** Fixed base AND fixed base tangent. Uniform-load cantilever shape, f(1)=1. */
export function leafBendShape(fraction: number) {
  const s = finite(fraction, 0, 0, 1);
  return { displacement: s * s * (6 - 4 * s + s * s) / 3, slope: 4 * s * (3 - 3 * s + s * s) / 3 };
}

const declarations = /* glsl */`
uniform float leafSpan;
uniform float leafPressure;
uniform float leafGravity;
uniform float leafStiffness;
// Return local displacement amplitude and its derivative with respect to local y.
vec2 leafBend(vec3 p) {
  mat4 frame = modelMatrix;
  #ifdef USE_INSTANCING
    frame = modelMatrix * instanceMatrix;
  #endif
  float sy = max(length(frame[1].xyz), 1e-8);
  float sz = max(length(frame[2].xyz), 1e-8);
  vec3 n = normalize(cross(frame[0].xyz, frame[1].xyz));
  vec3 wind = normalize(vec3(1.0, 0.0, 0.2));
  float incidence = dot(n, wind);
  float pressure = leafPressure * incidence * abs(incidence) - ${LEAF_PRIORS.arealMassKgM2} * leafGravity * n.y;
  float L = clamp(leafSpan * sy, 0.0, 2.0);
  float ratio = L / ${LEAF_PRIORS.thicknessM};
  float x = 1.5 * pressure / (${LEAF_PRIORS.youngModulusPa.toFixed(1)} * leafStiffness) * ratio * ratio * ratio / ${LEAF_PRIORS.maxTipRatio};
  float amplitude = L * ${LEAF_PRIORS.maxTipRatio} * x / sqrt(1.0 + x*x) / sz;
  float s = clamp(p.y / leafSpan, 0.0, 1.0);
  float shape = s*s*(6.0-4.0*s+s*s)/3.0;
  float derivative = 4.0*s*(3.0-3.0*s+s*s)/3.0;
  return vec2(amplitude * shape, amplitude / leafSpan * derivative);
}
`;

const stripDeclarations = /* glsl */`
uniform float leafPressure;
uniform float leafGravity;
uniform float leafStiffness;
attribute vec2 leafMaterial;
attribute vec3 leafLoadNormal;
attribute vec3 leafGradient;
// Each ribbon retains its rest shape. Add one bounded weak-axis strip mode,
// anchored by material s=0 (both displacement and its derivative vanish).
vec2 leafBend(vec3 p) {
  mat4 frame = modelMatrix;
  #ifdef USE_INSTANCING
    frame = modelMatrix * instanceMatrix;
  #endif
  float scale = max(length(frame[1].xyz), 1e-8);
  vec3 n = normalize(mat3(frame) * leafLoadNormal);
  float incidence = dot(n, normalize(vec3(1.0, 0.0, 0.2)));
  float pressure = leafPressure * incidence * abs(incidence) - ${LEAF_PRIORS.arealMassKgM2} * leafGravity * n.y;
  float L = clamp(leafMaterial.y * scale, 0.0, 2.0);
  float ratio = L / ${LEAF_PRIORS.thicknessM};
  float x = 1.5 * pressure / (${LEAF_PRIORS.youngModulusPa.toFixed(1)} * leafStiffness) * ratio * ratio * ratio / ${LEAF_PRIORS.maxTipRatio};
  float amplitude = L * ${LEAF_PRIORS.maxTipRatio} * x / sqrt(1.0 + x*x) / scale;
  float s = clamp(leafMaterial.x, 0.0, 1.0);
  return amplitude * vec2(s*s*(6.0-4.0*s+s*s)/3.0, 4.0*s*(3.0-3.0*s+s*s)/3.0);
}
`;

/** CPU reference for the material-strip shader (uniform-scale herb frames).
 * Returns local position and normal; useful for insertion/load inspection.
 * The normal is the inverse transpose of I + d outer grad(s), including the
 * denominator needed when an initially curved strip's gradient turns.
 */
export function leafStripVertex(geometry: THREE.BufferGeometry, vertex: number, frame: THREE.Matrix4,
  windMS: number, gravityMS2: number, stiffnessMultiplier = 1) {
  const material = geometry.getAttribute('leafMaterial'), s = material.getX(vertex);
  const direction = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('leafLoadNormal'), vertex);
  const gradient = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('leafGradient'), vertex);
  const scale = new THREE.Vector3().setFromMatrixColumn(frame, 1).length();
  const normalWorld = direction.clone().transformDirection(frame), wind = new THREE.Vector3(1, 0, .2).normalize();
  const amplitude = leafTipDisplacement(material.getY(vertex) * scale, finite(windMS, 0, -25, 25) * normalWorld.dot(wind),
    -finite(gravityMS2, 0, 0, 30) * normalWorld.y,
    {youngModulusPa: LEAF_PRIORS.youngModulusPa * finite(stiffnessMultiplier, 1, .05, 20)}) / Math.max(scale, 1e-8);
  const shape = leafBendShape(s), position = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), vertex).addScaledVector(direction, amplitude * shape.displacement);
  const normal = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('normal'), vertex);
  const derivative = amplitude * shape.slope;
  normal.addScaledVector(gradient, -derivative * direction.dot(normal) / (1 + derivative * gradient.dot(direction))).normalize();
  return {position, normal};
}

/** Explicit petiolate blades and tagged herb material strips. O(1) uniform updates,
 * no per-frame traversal or instanceMatrix uploads; branches keep their own solver.
 * Caller must dispose BEFORE disposing its plant/detail meshes.
 */
export function createLeafDynamics(root: THREE.Object3D) {
  const uniforms = { leafPressure: { value: 0 }, leafGravity: { value: 0 }, leafStiffness: { value: 1 } };
  const unsupportedBlades: {mesh: string; reason: string}[] = [];
  const records: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; depth: THREE.Material | undefined; distance: THREE.Material | undefined; culled: boolean }[] = [];
  const owned = new Set<THREE.Material>();
  const cache = new Map<THREE.BufferGeometry, Map<THREE.Material, { material: THREE.Material; depth: THREE.MeshDepthMaterial; distance: THREE.MeshDistanceMaterial }>>();
  let disposed = false;
  root.updateWorldMatrix(true, true);
  function patch(material: THREE.Material, span: number, strip: boolean) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms, { leafSpan: { value: span } });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + (strip ? stripDeclarations : declarations))
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + (strip
          ? 'float leafDerivative = leafBend(position).y;\nobjectNormal -= leafGradient * (leafDerivative * dot(leafLoadNormal, objectNormal) / (1.0 + leafDerivative * dot(leafGradient, leafLoadNormal)));'
          : 'objectNormal.y -= leafBend(position).y * objectNormal.z;'))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (strip ? 'transformed += leafLoadNormal * leafBend(position).x;' : 'transformed.z += leafBend(position).x;'));
    };
    material.customProgramCacheKey = () => strip ? 'leaf-material-strip-si-v1' : 'leaf-cantilever-si-v1';
    owned.add(material);
  }
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.organ !== 'leaf' || Array.isArray(object.material)) return;
    const geometry = object.geometry;
    const strip = object.userData.leafDynamics === 'material-strip';
    if (strip) {
      const unsupported = (reason: string) => unsupportedBlades.push({mesh: object.name || object.uuid, reason});
      if (!Object.entries(STRIP_ATTRIBUTES).every(([name, size]) => geometry.getAttribute(name)?.itemSize === size && geometry.getAttribute(name).count === geometry.getAttribute('position').count)) {
        unsupported('Missing or incomplete per-blade material coordinates/frame'); return;
      }
      const axes = [0, 1, 2].map(i => new THREE.Vector3().setFromMatrixColumn(object.matrixWorld, i));
      const scale = axes[1].length(), tolerance = 1e-5 * Math.max(scale, 1e-8);
      if (scale < 1e-8 || axes.some(v => Math.abs(v.length() - scale) > tolerance) || axes.some((v, i) => axes.some((w, j) => i !== j && Math.abs(v.dot(w)) > tolerance * scale))) {
        unsupported('Material strips require a rigid/uniform-scale frame; nonuniform scale or shear is unsupported'); return;
      }
    } else if (object.userData.connectedBy !== 'petiole') return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const span = geometry.boundingBox?.max.y ?? 0;
    if (!(span > 1e-6)) return;
    let materials = cache.get(geometry); if (!materials) { materials = new Map(); cache.set(geometry, materials); }
    let bundle = materials.get(object.material);
    if (!bundle) {
      const material = object.material.clone();
      const source = object.material as THREE.MeshStandardMaterial;
      const shadow = { side: source.side, map: source.map, alphaMap: source.alphaMap, alphaTest: source.alphaTest };
      const depth = new THREE.MeshDepthMaterial({ ...shadow, depthPacking: THREE.RGBADepthPacking });
      const distance = new THREE.MeshDistanceMaterial(shadow);
      patch(material, span, strip); patch(depth, span, strip); patch(distance, span, strip);
      bundle = { material, depth, distance }; materials.set(object.material, bundle);
    }
    records.push({ mesh: object, material: object.material, depth: object.customDepthMaterial, distance: object.customDistanceMaterial, culled: object.frustumCulled });
    object.material = bundle.material; object.customDepthMaterial = bundle.depth; object.customDistanceMaterial = bundle.distance;
    // CPU bounds do not see vertex displacement (nor arbitrary instance scales).
    // Avoid clipping blades/shadows rather than traversing instances every frame.
    object.frustumCulled = false;
  });
  return {
    bladeMeshes: records.length,
    unsupportedBlades,
    update(windMS: number, gravityMS2: number, stiffnessMultiplier = 1) {
      if (disposed) return;
      const u = finite(windMS, 0, -25, 25);
      uniforms.leafPressure.value = .5 * LEAF_PRIORS.airDensityKgM3 * LEAF_PRIORS.dragCoefficient * u * Math.abs(u);
      uniforms.leafGravity.value = finite(gravityMS2, 0, 0, 30);
      uniforms.leafStiffness.value = finite(stiffnessMultiplier, 1, .05, 20);
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const r of records) { r.mesh.material = r.material; r.mesh.customDepthMaterial = r.depth; r.mesh.customDistanceMaterial = r.distance; r.mesh.frustumCulled = r.culled; }
      owned.forEach(m => m.dispose()); owned.clear(); cache.clear(); records.length = 0;
    },
  };
}
