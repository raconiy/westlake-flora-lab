import * as THREE from 'three';
import {naturalFanBlade} from './plant-engine.ts';

/** Observe source geometry in metres, removing only a rigid world transform.
 * All source instance scales, stalk geometry and compound-leaf rotations survive. */
export function createLeafObservation(root:THREE.Object3D,species:string):THREE.Group|null{
 let source:THREE.Mesh|undefined;
 root.updateMatrixWorld(true);
 root.traverse(o=>{if(!source&&o instanceof THREE.Mesh&&o.userData.organ==='leaf'&&o.userData.connectedBy==='petiole')source=o;});
 if(!source)root.traverse(o=>{if(!source&&o instanceof THREE.Mesh&&o.userData.organ==='leaf')source=o;});
 if(!source)return null;
 const object=source as THREE.Mesh,detail=new THREE.Group();detail.name='source-leaf-observation';
 const inverseRigid=(matrix:THREE.Matrix4)=>{const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();matrix.decompose(p,q,s);return new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1)).invert();};
 const cloneMesh=(mesh:THREE.Mesh)=>{mesh.geometry=mesh.geometry.clone();mesh.material=Array.isArray(mesh.material)?mesh.material.map(m=>m.clone()):mesh.material.clone();mesh.castShadow=mesh.receiveShadow=true;};
 let compound:THREE.Object3D|undefined;
 for(let p:THREE.Object3D|null=object;p&&p!==root;p=p.parent)if(p.userData.role==='trifoliate-leaf'){compound=p;break;}
 if(compound){
  const inverse=inverseRigid(compound.matrixWorld),leaf=compound.clone(true);
  leaf.matrixAutoUpdate=false;leaf.matrix.multiplyMatrices(inverse,compound.matrixWorld);
  leaf.traverse(o=>{if(o instanceof THREE.Mesh)cloneMesh(o);});detail.add(leaf);
  const petiole=compound.parent?.children.find(o=>o instanceof THREE.Mesh&&o.userData.role==='petiole') as THREE.Mesh|undefined;
  if(petiole){const stalk=petiole.clone();cloneMesh(stalk);stalk.matrixAutoUpdate=false;stalk.matrix.multiplyMatrices(inverse,petiole.matrixWorld);detail.add(stalk);}
  detail.userData={sourceRole:'trifoliate-leaf',leaflets:3,petioleFromSource:!!petiole};return detail;
 }
 let geometry=species==='ginkgo'?naturalFanBlade(128,12):object.geometry.clone();
 const material=(Array.isArray(object.material)?object.material[0]:object.material).clone();
 const leafWorld=object.matrixWorld.clone();
 if(object instanceof THREE.InstancedMesh){const instance=new THREE.Matrix4();object.getMatrixAt(0,instance);leafWorld.multiply(instance);
  if(object.instanceColor&&material instanceof THREE.MeshStandardMaterial){const color=new THREE.Color();object.getColorAt(0,color);material.color.multiply(color);}
 }else if(Number.isInteger(object.userData.leafVertexCount)&&object.userData.leafVertexCount>0){
  const count=object.userData.leafVertexCount,one=new THREE.BufferGeometry();
  for(const [name,attribute]of Object.entries(geometry.attributes))if(attribute instanceof THREE.BufferAttribute)one.setAttribute(name,new THREE.BufferAttribute(attribute.array.slice(0,count*attribute.itemSize),attribute.itemSize,attribute.normalized));
  const index=geometry.getIndex();if(index&&object.userData.leafIndexCount)one.setIndex(new THREE.BufferAttribute(index.array.slice(0,object.userData.leafIndexCount),1));geometry.dispose();geometry=one;
 }
 const inverse=inverseRigid(leafWorld),blade=new THREE.Mesh(geometry,material);
 blade.matrixAutoUpdate=false;blade.matrix.multiplyMatrices(inverse,leafWorld);blade.userData={...object.userData};blade.castShadow=blade.receiveShadow=true;material.shadowSide=THREE.DoubleSide;detail.add(blade);
 let petioleLength=0;
 if(object instanceof THREE.InstancedMesh){
  const sourceStalk=object.parent?.children.find(o=>o instanceof THREE.InstancedMesh&&o.count===object.count&&
   (o.userData.organ==='petiole'||o.userData.role==='petiole'||(o.userData.organ==='leaf'&&!o.userData.connectedBy))) as THREE.InstancedMesh|undefined;
  if(sourceStalk){
   const instance=new THREE.Matrix4();sourceStalk.getMatrixAt(0,instance);
   const stalk=new THREE.Mesh(sourceStalk.geometry.clone(),(Array.isArray(sourceStalk.material)?sourceStalk.material[0]:sourceStalk.material).clone());
   stalk.matrixAutoUpdate=false;stalk.matrix.copy(inverse).multiply(sourceStalk.matrixWorld).multiply(instance);stalk.userData.organ='petiole';stalk.castShadow=stalk.receiveShadow=true;detail.add(stalk);
   if(!stalk.geometry.boundingBox)stalk.geometry.computeBoundingBox();const box=stalk.geometry.boundingBox!;
   petioleLength=new THREE.Vector3(0,box.min.y,0).applyMatrix4(stalk.matrix).distanceTo(new THREE.Vector3(0,box.max.y,0).applyMatrix4(stalk.matrix));
  }
 }
 detail.userData={sourceRole:object.userData.role||'blade',petioleFromSource:petioleLength>0,petioleLengthM:petioleLength};return detail;
}
