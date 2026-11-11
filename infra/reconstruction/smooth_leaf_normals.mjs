// node infra/reconstruction/smooth_leaf_normals.mjs input.glb output.glb receipt.json
// Correct leaf-local faceting in the delivered asset without moving any organ.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {smoothLeafNormals} from '../../lib/capture-leaf-normals.ts';
const [source,target,receipt]=process.argv.slice(2);
if(!source||!target||!receipt||source===target) throw Error('Provide distinct input/output plus receipt');
await MeshoptDecoder.ready;
const raw=fs.readFileSync(source), size=raw.readUInt32LE(12);
assert.equal(raw.toString('ascii',0,4),'glTF');assert.equal(raw.readUInt32LE(8),raw.length);
const doc=JSON.parse(raw.subarray(20,20+size));
const blob=raw.subarray(28+size,28+size+doc.buffers[0].byteLength);
const views=new Map();
function view(id) {
  if(views.has(id)) return views.get(id);
  const v=doc.bufferViews[id],c=v.extensions?.EXT_meshopt_compression;
  let bytes;
  if(c){bytes=new Uint8Array(c.count*c.byteStride);MeshoptDecoder.decodeGltfBuffer(bytes,c.count,c.byteStride,blob.subarray(c.byteOffset,c.byteOffset+c.byteLength),c.mode,c.filter);}
  else {assert.equal(v.buffer,0);bytes=blob.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);}
  views.set(id,bytes);return bytes;
}
const types={5120:[1,'getInt8',127],5121:[1,'getUint8',255],5122:[2,'getInt16',32767],5123:[2,'getUint16',65535],5125:[4,'getUint32',4294967295],5126:[4,'getFloat32',1]};
function accessor(id) {
  const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],data=view(a.bufferView);
  const dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type], [width,get,denominator]=types[a.componentType];
  const stride=v.byteStride??width*components,out=new Float64Array(a.count*components);
  for(let i=0;i<a.count;i++)for(let k=0;k<components;k++){
    const raw=dv[get]((a.byteOffset??0)+i*stride+k*width,true);
    out[i*components+k]=a.normalized?Math.max(-1,raw/denominator):raw;
  }
  return out;
}
const additions=[],changes=[];let length=blob.length;
const append=data=>{const padding=Buffer.alloc((4-length%4)%4);additions.push(padding,data);length+=padding.length+data.length;return length-data.length;};
for(const [meshId,mesh] of doc.meshes.entries())for(const [primitiveId,p] of mesh.primitives.entries()) {
  const name=doc.materials[p.material]?.name??'';
  if(!/^(Living broadleaf blades|Broadleaf \d{2}|Foliage\.\d+)$/.test(name))continue;
  assert.ok(p.indices!==undefined && p.attributes.NORMAL!==undefined);
  const positions=accessor(p.attributes.POSITION),indices=accessor(p.indices),original=accessor(p.attributes.NORMAL);
  const out=smoothLeafNormals(positions,indices,original);
  if(!out.changedVertices)continue;
  // Signed normalised byte normals are supported by the asset's existing
  // KHR_mesh_quantization contract. Four-byte stride meets vertex alignment.
  const normals=Buffer.alloc(positions.length/3*4);
  for(let v=0;v<positions.length/3;v++)for(let k=0;k<3;k++)normals.writeInt8(Math.round(Math.max(-1,Math.min(1,out.normals[v*3+k]))*127),v*4+k);
  const byteOffset=append(normals),bufferView=doc.bufferViews.length;
  doc.bufferViews.push({buffer:0,byteOffset,byteLength:normals.length,byteStride:4,target:34962});
  const normalAccessor=doc.accessors.length;
  doc.accessors.push({bufferView,componentType:5120,count:positions.length/3,type:'VEC3',normalized:true});
  const prior=p.attributes.NORMAL;p.attributes.NORMAL=normalAccessor;
  changes.push({meshId,primitiveId,material:name,originalNormalAccessor:prior,newNormalAccessor:normalAccessor,
    vertices:positions.length/3,changedVertices:out.changedVertices,leafComponents:out.smoothedComponents,skippedComponents:out.skippedComponents});
}
assert.ok(changes.length>0,'No eligible leaf normals changed');
const padding=Buffer.alloc((4-length%4)%4);additions.push(padding);length+=padding.length;doc.buffers[0].byteLength=length;
for(const key of ['extensionsUsed','extensionsRequired'])doc[key]=[...new Set([...(doc[key]??[]),'KHR_mesh_quantization'])];
doc.asset.extras??={};doc.asset.extras.leafNormalsRevision='R7.1: edge-connected per-leaf area-weighted normals; positions, indices, organ sockets and material pigments preserved';
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
binHeader.writeUInt32LE(length);binHeader.writeUInt32LE(0x004e4942,4);
const output=Buffer.concat([header,json,binHeader,blob,...additions]);fs.writeFileSync(target,output);
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={scope:'Leaf internal shading only; no crown geometry or growth-history claim',sourceSha256:hash(raw),outputSha256:hash(output),outputBytes:output.length,
  changes,leafComponents:changes.reduce((n,v)=>n+v.leafComponents,0),changedVertices:changes.reduce((n,v)=>n+v.changedVertices,0),
  preserved:['POSITION accessors and bytes','triangle indices and bytes','node hierarchy and every transform','UV, pigments, material and texture values','root collars, woody sockets and leaf insertion positions'],
  limitations:['Leaf vein relief and species-specific tissue optics remain unresolved','Smoothing reduces hard-faceted shading; it does not repair incomplete or incorrect crown architecture']};
fs.writeFileSync(receipt,JSON.stringify(report,null,2));console.log(JSON.stringify({changes:changes.length,leafComponents:report.leafComponents,changedVertices:report.changedVertices,bytes:output.length,sha256:report.outputSha256}));
