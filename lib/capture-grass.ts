import * as THREE from 'three';



type Scalar = {value:number};
type Uniforms = {
  lawnResponse:Scalar; lawnPhase:Scalar; lawnRootY:Scalar;
};

export function advanceLawnWind(response:Scalar, phase:Scalar,
  seconds:number, speed:number):boolean {
  if (!Number.isFinite(seconds) || seconds<=0) return false;
  const w=Number.isFinite(speed)?THREE.MathUtils.clamp(speed,-12,12):0;
  const target=w*Math.abs(w)/(36+w*w);
  if (response.value===0 && target===0) {phase.value=0;return false;}
  const dt=Math.min(seconds,.2);
  response.value+=(target-response.value)*-Math.expm1(-dt/.22);
  if (target===0 && Math.abs(response.value)<.0001) response.value=0;
  phase.value=response.value===0?0:
    (phase.value+dt*(1.5+.32*Math.abs(w)))%(2*Math.PI);
  return true;
}

const header=`
uniform float lawnResponse;
uniform float lawnPhase;
uniform float lawnRootY;
vec3 lawnWorld(vec3 p) {
  #ifdef USE_INSTANCING
    return (modelMatrix * instanceMatrix * vec4(p,1.0)).xyz;
  #else
    return (modelMatrix * vec4(p,1.0)).xyz;
  #endif
}
float lawnBaseY() {
  #ifdef USE_INSTANCING
    return (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).y;
  #else
    return lawnRootY;
  #endif
}
vec3 lawnOffset(vec3 p,float root) {
  float h=clamp(p.y-root,0.,.09);
  float wave=.84+.16*sin(lawnPhase-dot(p.xz,vec2(1.7,.91)));
  float slope=lawnResponse*wave*min(.5,7.*h);
  return vec3(.9745552*h*slope,
    -h*(1.-sqrt(max(0.,1.-slope*slope))),.2241477*h*slope);
}
`;

export function attachLawnWind(material:THREE.Material,
  uniforms:Uniforms, surface:boolean) {
  const prior=material.onBeforeCompile;
  const key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer) {
    prior.call(this,shader,renderer);
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=header+shader.vertexShader.replace(
      '#include <begin_vertex>',`
      #include <begin_vertex>
      mat3 lawnPositionBasis=mat3(modelMatrix);
      #ifdef USE_INSTANCING
        lawnPositionBasis=mat3(modelMatrix)*mat3(instanceMatrix);
      #endif
      transformed+=inverse(lawnPositionBasis)*
        lawnOffset(lawnWorld(transformed),lawnBaseY());
    `);
    if (surface) shader.vertexShader=shader.vertexShader.replace(
      '#include <beginnormal_vertex>',`
      #include <beginnormal_vertex>
      if (lawnResponse!=0.) {
        vec3 lp=lawnWorld(position);
        float lr=lawnBaseY();
        float e=.0002;
        vec3 lo=lawnOffset(lp,lr);
        mat3 J=mat3(
          vec3(1.,0.,0.)+(lawnOffset(lp+vec3(e,0.,0.),lr)-lo)/e,
          vec3(0.,1.,0.)+(lawnOffset(lp+vec3(0.,e,0.),lr)-lo)/e,
          vec3(0.,0.,1.)+(lawnOffset(lp+vec3(0.,0.,e),lr)-lo)/e);
        mat3 B=mat3(modelMatrix);
        #ifdef USE_INSTANCING
          B=mat3(modelMatrix)*mat3(instanceMatrix);
        #endif
        objectNormal=transpose(B)*transpose(inverse(J))*
          transpose(inverse(B))*objectNormal;
      }
    `);
  };
  material.customProgramCacheKey=()=>key+
    ':lawn-world-coherence-v2:'+(surface?'surface':'shadow');
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
      attachLawnWind(copy, uniforms, true);
      return copy;
    });
    const originalDepth = object.customDepthMaterial;
    const depth = originalDepth?.clone() ?? new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking, side:materials[0].side});
    attachLawnWind(depth, uniforms, false);
    const originalDistance = object.customDistanceMaterial;
    const distance = originalDistance?.clone() ?? new THREE.MeshDistanceMaterial({side:materials[0].side});
    attachLawnWind(distance, uniforms, false);
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
      return restore.length>0 && advanceLawnWind(strength,phase,seconds,speed);
    },
    dispose() { for (const undo of restore.splice(0)) undo(); }
  };
}
