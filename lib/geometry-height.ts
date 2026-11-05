import * as THREE from 'three';

/** Exact maximum rest-pose vertex height, in world metres. A transformed local
 * AABB may contain empty corners, so it is suitable for safe camera framing but
 * must not be presented as a measured/generated plant height. Build-time only;
 * shader blade deformation is intentionally outside this rest-pose statistic. */
export function geometryHeight(group:THREE.Object3D){
 group.updateWorldMatrix(true,true);
 let maximum=0;const instance=new THREE.Matrix4(),world=new THREE.Matrix4();
 group.traverse(object=>{
  const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
  const p=mesh.geometry.getAttribute('position');if(!p)return;
  const instanced=mesh as THREE.InstancedMesh,count=instanced.isInstancedMesh?instanced.count:1;
  for(let i=0;i<count;i++){
   if(instanced.isInstancedMesh){instanced.getMatrixAt(i,instance);world.multiplyMatrices(mesh.matrixWorld,instance);}else world.copy(mesh.matrixWorld);
   const e=world.elements;
   for(let v=0;v<p.count;v++)maximum=Math.max(maximum,e[1]*p.getX(v)+e[5]*p.getY(v)+e[9]*p.getZ(v)+e[13]);
  }
 });return maximum;
}
