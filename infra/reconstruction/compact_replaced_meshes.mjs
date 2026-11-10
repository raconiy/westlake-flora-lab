// Reclaim unreachable old tree vertex streams. Remaining accessors retain their
// original bytes, including octahedrally encoded (not filtered) normal data.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [input,receipt,output,verification,codec]=process.argv.slice(2);
const {MeshoptDecoder:decoder,MeshoptEncoder:encoder}=await import(codec?pathToFileURL(codec).href:'meshoptimizer');
await Promise.all([decoder.ready,encoder.ready]);
const source=fs.readFileSync(input), data=JSON.parse(source.subarray(20,20+source.readUInt32LE(12))), bin=source.subarray(28+source.readUInt32LE(12));
const dead=new Set(JSON.parse(fs.readFileSync(receipt)).oldAccessors);
const accessors=data.accessors, affected=[...new Set([...dead].map(id=>accessors[id].bufferView))];
const live=new Set();
function mapRefs(map){
  const attrs=o=>{for(const k in o)o[k]=map(o[k]);};
  for(const m of data.meshes)for(const p of m.primitives){attrs(p.attributes);if(p.indices!==undefined)p.indices=map(p.indices);for(const t of p.targets??[])attrs(t);}
  for(const n of data.nodes)attrs(n.extensions?.EXT_mesh_gpu_instancing?.attributes??{});
  for(const a of data.animations??[])for(const s of a.samplers){s.input=map(s.input);s.output=map(s.output);}
  for(const s of data.skins??[])if(s.inverseBindMatrices!==undefined)s.inverseBindMatrices=map(s.inverseBindMatrices);
}
mapRefs(i=>{live.add(i);return i;});
if([...dead].some(id=>live.has(id)))throw Error('Replaced resource remains referenced');
const records=[];
for(const i of affected){
  const view=data.bufferViews[i], ext=view.extensions.EXT_meshopt_compression;
  const original=new Uint8Array(ext.count*ext.byteStride);
  decoder.decodeGltfBuffer(original,ext.count,ext.byteStride,bin.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength),ext.mode);
  const keep=accessors.filter((a,id)=>a.bufferView===i && !dead.has(id)).sort((a,b)=>(a.byteOffset??0)-(b.byteOffset??0));
  if(!keep.length)throw Error('Unexpected wholly empty grouped view');
  const ranges=[];
  for(const a of keep){
    const start=a.byteOffset??0,end=start+a.count*ext.byteStride, prev=ranges.at(-1);
    if(start%ext.byteStride||end>original.length)throw Error('Unexpected interleaved accessor layout');
    if(prev&&start<=prev.end)prev.end=Math.max(prev.end,end);else ranges.push({start,end});
  }
  let at=0;
  const parts=[];
  for(const r of ranges){r.dest=at;parts.push(original.subarray(r.start,r.end));at+=r.end-r.start;}
  for(const a of keep){const start=a.byteOffset??0;const r=ranges.find(x=>x.start<=start&&start<x.end);a.byteOffset=r.dest+start-r.start;}
  const packed=Buffer.concat(parts);
  const encoded=Buffer.from(encoder.encodeGltfBuffer(packed,packed.length/ext.byteStride,ext.byteStride,ext.mode));
  const check=new Uint8Array(packed.length);decoder.decodeGltfBuffer(check,packed.length/ext.byteStride,ext.byteStride,encoded,ext.mode);
  if(!Buffer.from(check.buffer).equals(packed))throw Error('Lossless geometry verification failed for '+i);
  const old=ext.byteLength;const extra=(old-encoded.length)&3;
  records.push({view:i,start:ext.byteOffset,end:ext.byteOffset+old,encoded,extra});
  ext.byteLength=encoded.length;ext.count=packed.length/ext.byteStride;view.byteLength=packed.length;
}
records.sort((a,b)=>a.start-b.start);
const chunks=[];let pos=0;
for(const r of records){chunks.push(bin.subarray(pos,r.start),r.encoded,Buffer.alloc(r.extra));pos=r.end;}
chunks.push(bin.subarray(pos));const dest=Buffer.concat(chunks);
function shift(n){let p=n;for(const r of records){if(n>=r.end)p+=r.encoded.length+r.extra-(r.end-r.start);else if(n>r.start)throw Error('Unexpected overlapping compressed resources');}return p;}
for(const v of data.bufferViews){if(v.buffer===0)v.byteOffset=shift(v.byteOffset??0);const ext=v.extensions?.EXT_meshopt_compression;if(ext&&ext.buffer===0)ext.byteOffset=shift(ext.byteOffset??0);}
const map=new Map();data.accessors=accessors.filter((a,i)=>{if(dead.has(i))return false;map.set(i,map.size);return true;});mapRefs(i=>map.get(i));
data.buffers[0].byteLength=dest.length;
const text=Buffer.from(JSON.stringify(data)),json=Buffer.alloc((text.length+3)&~3,32);text.copy(json);
const header=Buffer.from(source.subarray(0,20));header.writeUInt32LE(28+json.length+dest.length,8);header.writeUInt32LE(json.length,12);
const bh=Buffer.alloc(8);bh.writeUInt32LE(dest.length);bh.write('BIN\0',4);
const bytes=Buffer.concat([header,json,bh,dest]);fs.writeFileSync(output,bytes);
const hash=q=>createHash('sha256').update(q).digest('hex');
fs.writeFileSync(verification,JSON.stringify({sourceSha256:hash(source),resultSha256:hash(bytes),inputBytes:source.length,outputBytes:bytes.length,keptAccessorBytesVerified:true,replacedInactiveAccessors:dead.size},null,2));
