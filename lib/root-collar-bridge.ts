import * as THREE from 'three';
import type {PlantModel} from './plant-engine';
import type {RhizosphereModel} from './rhizosphere';

/** Weld the visible root flare to the ACTUAL basal bark polygon. Bottom soil
 * attachment stays fixed; only the short collar transition deforms. This is an
 * imposed geometric boundary, not solved root anchorage, stress or tissue strain.
 * O(collar vertices), no per-frame plant traversal or geometry allocation. */
export function rootCollarBridge(plant:PlantModel,soil:RhizosphereModel){
 const joint=plant.branches.find(b=>b.order===0),collar=soil.group.getObjectByName('root-shoot-junction') as THREE.Mesh|undefined;
 if(!joint||!collar)return null;
 const bark=joint.pivot.children.find(o=>o instanceof THREE.Mesh&&!(o instanceof THREE.InstancedMesh)&&(o.geometry.userData.woodTube||o.geometry instanceof THREE.CylinderGeometry)) as THREE.Mesh|undefined;
 if(!bark)return null;
 const geometry=collar.geometry as THREE.CylinderGeometry,n=geometry.parameters.radialSegments;
 const source=bark.geometry,sourceN=source instanceof THREE.CylinderGeometry?source.parameters.radialSegments:source.userData.woodTube.sides;
 if(!(sourceN>2&&sourceN<=n))return null;
 const first=source instanceof THREE.CylinderGeometry?source.parameters.heightSegments*(sourceN+1):0;
 const p=geometry.attributes.position,original=new Float64Array(p.count*3),rings=Array.from({length:sourceN},(_,j)=>new THREE.Vector3().fromBufferAttribute(source.attributes.position,first+j));
 const top=new THREE.Vector3(...collar.userData.top),bottom=Number(collar.userData.bottomY),height=top.y-bottom;
 if(!(height>0))return null;
 for(let i=0;i<p.count;i++){original[i*3]=p.getX(i);original[i*3+1]=p.getY(i);original[i*3+2]=p.getZ(i);}
 bark.updateWorldMatrix(true,false);collar.updateWorldMatrix(true,false);
 const transform=new THREE.Matrix4().multiplyMatrices(collar.matrixWorld.clone().invert(),bark.matrixWorld),point=new THREE.Vector3();
 // Align the polygon phase to the original circular collar, without changing
 // its winding. Repeated top vertices preserve every bark corner when counts
 // differ (e.g.12 bark corners and16 collar columns).
 let phase=0,best=Infinity;
 for(let i=0;i<sourceN;i++){point.copy(rings[i]).applyMatrix4(transform);const d=(point.x-top.x)**2+(point.z-top.z-geometry.parameters.radiusTop)**2;if(d<best){best=d;phase=i;}}
 const weights=new Float64Array(p.count),columns=new Int16Array(p.count),centres=new Uint8Array(p.count);
 for(let i=0;i<p.count;i++){
  const x=original[i*3]-top.x,z=original[i*3+2]-top.z,y=original[i*3+1];
  const t=y<=bottom+1e-7?0:y>=top.y-1e-7?1:THREE.MathUtils.clamp((y-bottom)/height,0,1);
  weights[i]=t*t*(3-2*t);centres[i]=Math.hypot(x,z)<1e-9?1:0;
  const column=Math.round(((Math.atan2(x,z)+2*Math.PI)%(2*Math.PI))*n/(2*Math.PI))%n;
  columns[i]=(Math.floor(column*sourceN/n)+phase)%sourceN;
 }
 const targets=rings.map(()=>new THREE.Vector3()),center=new THREE.Vector3(),inverse=new THREE.Matrix4();
 collar.frustumCulled=false;
 collar.userData.continuity='actual bark basal polygon welded; fixed bottom; imposed geometric transition, not a root-soil solver';
 return {update(){
  bark.updateWorldMatrix(true,false);collar.updateWorldMatrix(true,false);inverse.copy(collar.matrixWorld).invert();transform.multiplyMatrices(inverse,bark.matrixWorld);center.set(0,0,0);
  for(let i=0;i<sourceN;i++){targets[i].copy(rings[i]).applyMatrix4(transform);center.add(targets[i]);}center.divideScalar(sourceN);
  for(let i=0;i<p.count;i++){
   const w=weights[i];if(w===0)continue;
   const target=centres[i]?center:targets[columns[i]],x=original[i*3],y=original[i*3+1],z=original[i*3+2];
   // The old ring column's top point is found by projecting its angle onto the
   // original collar radius, so intermediate rings retain their existing flare.
   const radius=geometry.parameters.radiusTop,a=Math.atan2(x-top.x,z-top.z);
   const oldTopX=centres[i]?top.x:top.x+Math.sin(a)*radius,oldTopZ=centres[i]?top.z:top.z+Math.cos(a)*radius;
   p.setXYZ(i,x+w*(target.x-oldTopX),y+w*(target.y-top.y),z+w*(target.z-oldTopZ));
  }
  p.needsUpdate=true;geometry.computeVertexNormals();
 }};
}
