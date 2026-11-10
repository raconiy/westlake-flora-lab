import * as THREE from 'three';

// Root-plane height is measured on the decoded asset. Blade length, drag response
// and settling time are engineering estimates for the unmeasured mown lawn.
const shaderHeader = `
uniform float lawnResponse;
uniform float lawnPhase;
uniform float lawnRootY;
const vec2 lawnDirection = vec2(0.9745552, 0.2241477);
vec3 lawnOffset(vec3 rest) {
  float height = clamp(rest.y - lawnRootY, 0.0, 0.09);
  float wave = 0.84 + 0.16 * sin(lawnPhase - dot(rest.xz, vec2(1.7, 0.91)));
  float slope = lawnResponse * wave * min(0.5, 7.0 * height);
  float lateral = height * slope;
  float loss = height * (1.0 - sqrt(max(0.0, 1.0 - slope * slope)));
  return vec3(lawnDirection.x * lateral, -loss, lawnDirection.y * lateral);
}
`;

function attachShader(material: THREE.Material, uniforms: {
  lawnResponse: {value: number}; lawnPhase: {value: number}; lawnRootY: {value: number};
}, surface: boolean) {
  const prior = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    prior.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shaderHeader + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec3 lawnRest = (modelMatrix * vec4(transformed, 1.0)).xyz;
      transformed += inverse(mat3(modelMatrix)) * lawnOffset(lawnRest);
    `);
    if (surface) {
      // Transform the normal as well as the vertex. The local derivative is in
      // world metres even when gltfpack stores vertex positions as large integers.
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        vec3 lawnBase = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 lawnSlope = (lawnOffset(lawnBase + vec3(0.0, .0002, 0.0)) - lawnOffset(lawnBase)) / .0002;
        mat3 lawnBasis = mat3(modelMatrix);
        vec3 lawnNormal = transpose(inverse(lawnBasis)) * objectNormal;
        lawnNormal.y = (lawnNormal.y - dot(lawnSlope.xz, lawnNormal.xz)) / max(.2, 1.0 + lawnSlope.y);
        objectNormal = transpose(lawnBasis) * lawnNormal;
      `);
    }
  };
  material.customProgramCacheKey = () => cacheKey + (surface ? ':captured-grass' : ':captured-grass-shadow');
}

function inCapturedVerge(node: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = node; current; current = current.parent) {
    if (current.name.replace(/[^a-z0-9]/gi,'').toLowerCase() === 'turfnearvergeblades') return true;
  }
  return false;
}

/** Drives the captured short-grass meshes, including the depth pass of the scene's sun. */
export function createCaptureGrass(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const strength = {value:0}, phase = {value:0};
  const restore: (()=>void)[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !inCapturedVerge(object)) return;
    const original = object.material;
    const materials: THREE.Material[] = Array.isArray(original) ? original : [original];
    if (!materials.length || !materials.every(m => /^Turf\.Blade\.\d+$/.test(m.name))) return;
    const pos = object.geometry.getAttribute('position');
    if (!pos?.count) return;
    const point = new THREE.Vector3();
    let rootY = Infinity;
    for (let i=0; i<pos.count; i++) {
      point.fromBufferAttribute(pos, i).applyMatrix4(object.matrixWorld);
      rootY = Math.min(rootY, point.y);
    }
    if (!Number.isFinite(rootY)) return;
    const uniforms = {lawnResponse:strength, lawnPhase:phase, lawnRootY:{value:rootY}};
    const patched = materials.map(mat => {
      const copy = mat.clone();
      copy.onBeforeCompile = mat.onBeforeCompile;
      copy.customProgramCacheKey = mat.customProgramCacheKey.bind(mat);
      attachShader(copy, uniforms, true);
      return copy;
    });
    const originalDepth = object.customDepthMaterial;
    const depth = originalDepth?.clone() ?? new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking, side:materials[0].side});
    attachShader(depth, uniforms, false);
    const originalDistance = object.customDistanceMaterial;
    const distance = originalDistance?.clone() ?? new THREE.MeshDistanceMaterial({side:materials[0].side});
    attachShader(distance, uniforms, false);
    object.material = Array.isArray(original) ? patched : patched[0];
    object.customDepthMaterial = depth;
    object.customDistanceMaterial = distance;
    restore.push(()=>{
      object.material = original;
      object.customDepthMaterial = originalDepth;
      object.customDistanceMaterial = originalDistance;
      patched.forEach(m=>m.dispose());
      depth.dispose(); distance.dispose();
    });
  });
  return {
    bladeMeshes: restore.length,
    step(seconds: number, speed: number): boolean {
      if (!restore.length || !Number.isFinite(seconds) || seconds<=0) return false;
      const wind = Number.isFinite(speed) ? THREE.MathUtils.clamp(speed, -12, 12) : 0;
      const target = wind*Math.abs(wind)/(36+wind*wind);
      const previous = strength.value;
      if (previous===0 && target===0) return false;
      const dt = Math.min(seconds,.2);
      strength.value += (target-previous) * -Math.expm1(-dt/.22);
      if (target===0 && Math.abs(strength.value)<.0001) strength.value=0;
      phase.value = strength.value===0 ? 0 : (phase.value + dt*(1.5+Math.abs(wind)*.32))%(2*Math.PI);
      return true;
    },
    dispose() { for (const undo of restore.splice(0)) undo(); }
  };
}
