/** Rebind only turf primitives to one metre-mapped field. Preserve every source geometry buffer. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const [input, textureFile, output, receiptFile] = process.argv.slice(2);
if (!receiptFile) throw Error('Usage: node patch_turf_glb.mjs input.glb turf.jpg output.glb receipt.json');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const data = fs.readFileSync(input);
const oldLength = data.readUInt32LE(12);
const doc = JSON.parse(data.subarray(20,20+oldLength));
const binary = data.subarray(28+oldLength);
const additions = [];
let cursor = binary.length;
function append(data, fields={}) {
  const pad = (-cursor)&3;
  if (pad) additions.push(Buffer.alloc(pad));
  cursor += pad;
  const view = {buffer:0,byteOffset:cursor,byteLength:data.length,...fields};
  additions.push(data);cursor += data.length;
  return doc.bufferViews.push(view)-1;
}
await MeshoptDecoder.ready;
const cache = new Map();
function bufferView(i) {
  if (cache.has(i)) return cache.get(i);
  const v=doc.bufferViews[i], ext=v.extensions?.EXT_meshopt_compression;
  let decoded;
  if (ext) {
    if (ext.buffer!==0) throw Error('Unsupported compressed buffer index');
    decoded=Buffer.alloc(ext.count*ext.byteStride);
    const src=binary.subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength);
    MeshoptDecoder.decodeGltfBuffer(decoded,ext.count,ext.byteStride,src,ext.mode,ext.filter);
  } else {
    if(v.buffer!==0) throw Error('Unsupported fallback buffer');
    decoded=binary.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);
  }
  cache.set(i,decoded);return decoded;
}
function reader(index) {
  const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],b=bufferView(a.bufferView);
  const widths={5121:1,5123:2,5126:4},width=widths[a.componentType],n={VEC2:2,VEC3:3,VEC4:4}[a.type];
  if(!width||!n||a.sparse)throw Error('Unsupported turf accessor');
  return (i,k)=>{
    const offset=(a.byteOffset||0)+i*(v.byteStride||n*width)+k*width;
    if(a.componentType===5126)return b.readFloatLE(offset);
    const value=width===1?b.readUInt8(offset):b.readUInt16LE(offset);
    return a.normalized?value/(width===1?255:65535):value;
  };
}

const world=new Map();
function visit(index,parent) {
  const node=doc.nodes[index];
  const local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(
    new Vector3().fromArray(node.translation||[0,0,0]),new Quaternion().fromArray(node.rotation||[0,0,0,1]),new Vector3().fromArray(node.scale||[1,1,1])
  );
  const m=parent.clone().multiply(local);
  if(world.has(index))throw Error('Multiply parented node');
  world.set(index,m);
  for(const child of node.children||[])visit(child,m);
}
for(const root of doc.scenes[doc.scene||0].nodes)visit(root,new Matrix4());
const ids=doc.materials.map((m,i)=>['Turf.PhotoAlbedo','Turf.RegisteredDiffuse'].includes(m.name)?i:-1).filter(i=>i>=0);
if(ids.length!==2)throw Error('Original turf materials required');
const originalMaterials=ids.map(i=>JSON.parse(JSON.stringify(doc.materials[i])));
const image=fs.readFileSync(textureFile);
const imageIndex=doc.images.push({mimeType:'image/jpeg',name:'Yungu turf continuous orthophoto field',bufferView:append(image)})-1;
const sampler=doc.samplers.findIndex(s=>(s.wrapS??10497)===10497&&(s.wrapT??10497)===10497 && (s.magFilter??9729)===9729 && [9987,undefined].includes(s.minFilter));
const samplerIndex=sampler>=0?sampler:doc.samplers.push({magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497})-1;
const textureIndex=doc.textures.push({source:imageIndex,sampler:samplerIndex})-1;
let incidentMin=1,incidentMax=0,vertexCount=0,primitives=0,maxUVDiff=0,minLabel,maxLabel;
const seen=new Set(), changed=[];
for(const [ni,mat] of world) {
  const node=doc.nodes[ni];
  if(node.mesh===undefined)continue;
  const mesh=doc.meshes[node.mesh];
  const turf=mesh.primitives.filter(pr=>ids.includes(pr.material));
  if(!turf.length)continue;
  if(seen.has(node.mesh))throw Error('Unexpected shared turf mesh in distinct world frames');
  seen.add(node.mesh);
  for(const pr of turf){
    const at=pr.attributes;
    if(at.COLOR_1===undefined||at.COLOR_0!==undefined)throw Error('Expected captured incident values in unconsumed COLOR_1');
    const pos=reader(at.POSITION),colors=reader(at.COLOR_1);
    const old=reader(at.TEXCOORD_0),xf=doc.materials[pr.material].pbrMetallicRoughness.baseColorTexture.extensions?.KHR_texture_transform||{};
    const count=doc.accessors[at.POSITION].count;
    if(doc.accessors[at.COLOR_1].count!==count)throw Error('Incident color vertex count mismatch');
    const pixels=Buffer.alloc(count*8);
    for(let i=0;i<count;i++){
      const pt=new Vector3(pos(i,0),pos(i,1),pos(i,2)).applyMatrix4(mat);
      if(Math.abs(pt.y)>.04)throw Error('Non-ground geometry selected');
      // glTF v is top-to-bottom; Blender world Y is -Three.z.
      const u=(pt.x+20)/44, v=1-(-pt.z+10)/44;
      pixels.writeFloatLE(u,8*i);pixels.writeFloatLE(v,8*i+4);
      if(doc.materials[pr.material].name==='Turf.RegisteredDiffuse'){
        const origU=old(i,0)*(xf.scale?.[0]??1)+(xf.offset?.[0]??0),origV=old(i,1)*(xf.scale?.[1]??1)+(xf.offset?.[1]??0);
        maxUVDiff=Math.max(maxUVDiff,Math.abs(origU-u),Math.abs(origV-v));
      }
      const shade=colors(i,1);
      if(shade<incidentMin){incidentMin=shade;minLabel=ni}
      if(shade>incidentMax){incidentMax=shade;maxLabel=ni}
    }
    const uvIndex=doc.accessors.push({bufferView:append(pixels,{target:34962}),componentType:5126,count,type:'VEC2'})-1;
    changed.push({node:ni,mesh:node.mesh,position:at.POSITION,indices:pr.indices,oldUV:at.TEXCOORD_0,newUV:uvIndex,incident:at.COLOR_1,count});
    at.TEXCOORD_0=uvIndex;
    at.COLOR_0=at.COLOR_1;delete at.COLOR_1;
    vertexCount+=count;primitives++;
  }
}
if(primitives!==10||!(incidentMin<.55&&incidentMax>.9)||maxUVDiff>.002)throw Error('Source turf or photo orientation disagrees: '+JSON.stringify({primitives,incidentMin,incidentMax,maxUVDiff}));
for(const idx of ids){
  const p=doc.materials[idx].pbrMetallicRoughness;p.baseColorTexture={index:textureIndex};p.roughnessFactor=.945;
}
doc.asset.extras={...doc.asset.extras,captureRevision:4,groundMaterial:'World XY 44 m periodic measured-grain reflectance, standard COLOR_0 for captured foreground light. Original terrain topology, hardscape and real-time tree shadows retained.'};
const pad=(-cursor)&3;if(pad)additions.push(Buffer.alloc(pad));cursor+=pad;
doc.buffers[0].byteLength=cursor;
const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc((raw.length+3)&~3,0x20);raw.copy(json);
const head=Buffer.alloc(20);head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+cursor,8);head.writeUInt32LE(json.length,12);head.write('JSON',16);
const binHead=Buffer.alloc(8);binHead.writeUInt32LE(cursor);binHead.write('BIN\0',4);
const result=Buffer.concat([head,json,binHead,binary,...additions]);fs.writeFileSync(output,result);
fs.writeFileSync(receiptFile,JSON.stringify({sourceSha256:hash(data),resultSha256:hash(result),textureSha256:hash(image),unchangedSourceBinaryPrefix:hash(binary),
  primitives,meshes:seen.size,vertices:vertexCount,previousMaterials:originalMaterials,incidentMin,incidentMax,minLabel,maxLabel,
  maximumRegisteredUVErrorAgainstHistoricalGrid:maxUVDiff,changed,TEXCOORD:'R4 float32 UV computed from decoded final world-space positions, preserving continuity across all material and mesh boundaries.'},null,2)+'\n');
