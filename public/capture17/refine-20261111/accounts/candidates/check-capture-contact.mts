// Read-only geometry check. This minimal reader ignores materials, skinning and morphs.
// Use a decompressed GLB; quantized accessors and GPU instancing are supported.
import * as THREE from 'three';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { inspectGroundContacts } from './inspectGroundContacts.mts';

const file = process.argv[2];
if (!file) throw new Error('Pass a decompressed GLB path');
const b = fs.readFileSync(file);
let doc:any, bin:Buffer|undefined;
for(let o=12;o<b.length;) {
  const length=b.readUInt32LE(o),type=b.readUInt32LE(o+4);
  if(type===0x4e4f534a) doc=JSON.parse(b.subarray(o+8,o+8+length).toString());
  if(type===0x004e4942) bin=b.subarray(o+8,o+8+length);
  o+=8+length;
}
if(!doc||!bin) throw new Error('Missing GLB chunks');
const sizes:any={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const component:any={5120:[Int8Array,1,'getInt8'],5121:[Uint8Array,1,'getUint8'],5122:[Int16Array,2,'getInt16'],5123:[Uint16Array,2,'getUint16'],5125:[Uint32Array,4,'getUint32'],5126:[Float32Array,4,'getFloat32']};
function attribute(i:number) {
  const a=doc.accessors[i],v=doc.bufferViews[a.bufferView];
  if(a.sparse||v.extensions?.EXT_meshopt_compression) throw new Error('Require expanded non-sparse accessors');
  const [Ctor,bytes,getter]=component[a.componentType],size=sizes[a.type],stride=v.byteStride||bytes*size;
  const array=new Ctor(a.count*size),data=new DataView(bin!.buffer,bin!.byteOffset,bin!.byteLength);
  const base=(v.byteOffset||0)+(a.byteOffset||0);
  for(let j=0;j<a.count;j++)for(let k=0;k<size;k++) array[j*size+k]=(data as any)[getter](base+j*stride+k*bytes,true);
  return new THREE.BufferAttribute(array,size,!!a.normalized);
}
const geometries=new Map<number,THREE.BufferGeometry>();
function geometry(position:number) {
  if(!geometries.has(position)) geometries.set(position,new THREE.BufferGeometry().setAttribute('position',attribute(position)));
  return geometries.get(position)!;
}
const objects=doc.nodes.map((n:any)=>{
  const group=new THREE.Group();group.name=n.name||'';group.userData=n.extras||{};
  if(n.matrix){group.matrix.fromArray(n.matrix);group.matrix.decompose(group.position,group.quaternion,group.scale);}
  else {if(n.translation)group.position.fromArray(n.translation);if(n.rotation)group.quaternion.fromArray(n.rotation);if(n.scale)group.scale.fromArray(n.scale);}
  if(n.skin!==undefined||n.weights)throw new Error('Skin/morph sampling not implemented');
  if(n.mesh!==undefined)for(const p of doc.meshes[n.mesh].primitives) {
    if(p.attributes.POSITION===undefined)continue;
    const inst=n.extensions?.EXT_mesh_gpu_instancing?.attributes;
    let mesh:THREE.Mesh;
    if(inst){
      const t=inst.TRANSLATION!==undefined?attribute(inst.TRANSLATION):null;
      const r=inst.ROTATION!==undefined?attribute(inst.ROTATION):null;
      const s=inst.SCALE!==undefined?attribute(inst.SCALE):null;
      const count=t?.count||r?.count||s?.count||0;
      const im=new THREE.InstancedMesh(geometry(p.attributes.POSITION),undefined,count);
      for(let i=0;i<count;i++) {
        const v=t?new THREE.Vector3().fromBufferAttribute(t,i):new THREE.Vector3();
        const q=r?new THREE.Quaternion(r.getX(i),r.getY(i),r.getZ(i),r.getW(i)):new THREE.Quaternion();
        const scale=s?new THREE.Vector3().fromBufferAttribute(s,i):new THREE.Vector3(1,1,1);
        im.setMatrixAt(i,new THREE.Matrix4().compose(v,q,scale));
      }
      mesh=im;
    }else mesh=new THREE.Mesh(geometry(p.attributes.POSITION));
    group.add(mesh);
  }
  return group;
});
doc.nodes.forEach((n:any,i:number)=>{for(const c of n.children||[])objects[i].add(objects[c]);});
const root=new THREE.Group();for(const i of doc.scenes[doc.scene||0].nodes)root.add(objects[i]);
root.updateWorldMatrix(true,true);
const terrain=objects.find((o:THREE.Object3D)=>o.name==='Turf.ContinuousSurface');
if(!terrain)throw new Error('No named terrain');
const bounds=new THREE.Box3().setFromObject(terrain,true),groundY=bounds.max.y;
const supportTargets=objects.filter((o:THREE.Object3D)=>o.name.endsWith('.trunk')||o.name==='Lamp.TaperedPost'||/^GroundLight\.\d+\.Foot$/.test(o.name));
// The reconstructed multi-stem right group stores its root wood inside one named subtree.
const right=objects.find((o:THREE.Object3D)=>o.name==='tree.right-group');if(right&&!supportTargets.some((o:THREE.Object3D)=>o.name==='tree.right-group.trunk'))supportTargets.push(right);
const results=inspectGroundContacts(root,supportTargets.map((node:THREE.Object3D)=>({id:node.name,node,groundY})),.005);
const counts:any={};for(const r of results)counts[r.status]=(counts[r.status]||0)+1;
const report={assetSha256:crypto.createHash('sha256').update(b).digest('hex'),asset:'candidate-plain.glb',method:'Actual decompressed candidate GLB position vertices, quantization, world hierarchy and instance transforms; explicit trunk/post/foot targets.',groundY,terrainYRange:[bounds.min.y,bounds.max.y],toleranceM:.005,counts,results,limitations:['Flat terrain reference only; not a collision solver.','Includes all accessor vertices, without index-range filtering.','Shader displacement and animation are not sampled.','Penetration does not imply a defect: roots/post bases may be intentionally embedded.','Current capture asset only; does not validate all growth stages or other plant assets.']};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
