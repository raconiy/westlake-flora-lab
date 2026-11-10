// Remap only the registered light on the existing terrain vertices.
// Foliage and static grass instances already carry their own incident colour.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const [input,config,output,receipt]=process.argv.slice(2);
if (!receipt || input===output) throw Error('Expected input.glb calibration.json output.glb receipt.json');
const {sunLinearRgb:sun,oldShadeLinearRgb:shade,shadeGain:gain}=JSON.parse(fs.readFileSync(config,'utf8'));
if (!(gain>0 && gain<=1.25)) throw Error('Invalid relative illuminance');
const src=fs.readFileSync(input);
const jsonSize=src.readUInt32LE(12);
const doc=JSON.parse(src.subarray(20,20+jsonSize));
if(doc.asset.extras?.groundShadowGain!==undefined)throw Error('Ground shade already calibrated');
const bin=src.subarray(28+jsonSize);
const chunks=[bin];
let size=bin.length;
const hash=b=>createHash('sha256').update(b).digest('hex');
const turf=new Set(['Turf.RegisteredDiffuse','Turf.PhotoAlbedo']);
await MeshoptDecoder.ready;
const cache=new Map();
function bytesAt(i){
  if(cache.has(i))return cache.get(i);
  const v=doc.bufferViews[i],e=v.extensions?.EXT_meshopt_compression;
  let a;
  if(e){
    a=Buffer.alloc(e.count*e.byteStride);
    if(e.buffer!==0)throw Error('Unexpected compressed backing buffer');
    MeshoptDecoder.decodeGltfBuffer(a,e.count,e.byteStride,bin.subarray(e.byteOffset||0,(e.byteOffset||0)+e.byteLength),e.mode,e.filter);
  }else{
    if(v.buffer!==0)throw Error('Unavailable backing buffer');
    a=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);
  }
  cache.set(i,a);return a;
}
let vertices=0,adjusted=0,primitives=0;
for(const mesh of doc.meshes) for(const p of mesh.primitives){
  if(!turf.has(doc.materials[p.material]?.name))continue;
  const attr=p.attributes, a=doc.accessors[attr.COLOR_0], v=doc.bufferViews[a.bufferView];
  if(a.componentType!==5121 || !a.normalized || a.type!=='VEC4')throw Error('Unexpected R4 incident-light layout');
  const raw=bytesAt(a.bufferView), values=Buffer.alloc(a.count*4);
  for(let i=0;i<a.count;i++){
    const offset=(a.byteOffset||0)+i*(v.byteStride||4);
    const w=Math.max(0,Math.min(1,(sun[1]-raw[offset+1]/255)/(sun[1]-shade[1])));
    for(let k=0;k<3;k++)values[4*i+k]=Math.round(255*Math.max(0,Math.min(1,raw[offset+k]/255+w*shade[k]*(gain-1))));
    values[4*i+3]=raw[offset+3];
    if(!raw.subarray(offset,offset+4).equals(values.subarray(4*i,4*i+4)))adjusted++;
  }
  const idx=doc.bufferViews.push({buffer:0,byteOffset:size,byteLength:values.length,target:34962})-1;
  size+=values.length;chunks.push(values);
  attr.COLOR_0=doc.accessors.push({componentType:5121,type:'VEC4',normalized:true,bufferView:idx,count:a.count})-1;
  vertices+=a.count;primitives++;
}
if(primitives!==10||adjusted===0)throw Error('Ground selection did not match the surveyed scene');
doc.asset.extras={...doc.asset.extras,captureRevision:5,groundShadowGain:gain};
doc.buffers[0].byteLength=size;
const jd=Buffer.from(JSON.stringify(doc)), json=Buffer.alloc((jd.length+3)&~3,32);jd.copy(json);
const h=Buffer.from(src.subarray(0,20));h.writeUInt32LE(28+json.length+size,8);h.writeUInt32LE(json.length,12);
const bh=Buffer.alloc(8);bh.writeUInt32LE(size);bh.write('BIN\0',4);
const dest=Buffer.concat([h,json,bh,...chunks]);fs.writeFileSync(output,dest);
fs.writeFileSync(receipt,JSON.stringify({inputSha256:hash(src),outputSha256:hash(dest),gain,vertices,adjusted,primitives},null,2)+'\n');
