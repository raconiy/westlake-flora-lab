import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const [basePath,newPath,changedPath,out,codec]=process.argv.slice(2);const {MeshoptDecoder:D}=await import(pathToFileURL(codec));await D.ready;
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=p=>{const b=fs.readFileSync(p);assert.equal(b.toString('utf8',0,4),'glTF');assert.equal(b.readUInt32LE(8),b.length);const n=b.readUInt32LE(12);return {doc:JSON.parse(b.subarray(20,20+n)),blob:b.subarray(28+n),file:b,cache:new Map()};};
const base=read(basePath),current=read(newPath),changed=new Set(JSON.parse(fs.readFileSync(changedPath)).changedObjects);
const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},channels={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
function view(a,id){if(a.cache.has(id))return a.cache.get(id);const v=a.doc.bufferViews[id];assert.ok(v&&v.byteLength>0);const e=v.extensions?.EXT_meshopt_compression;let bytes;
 if(e){assert.equal(e.buffer,0);assert.ok(e.byteOffset+e.byteLength<=a.blob.length);bytes=new Uint8Array(e.count*e.byteStride);D.decodeGltfBuffer(bytes,e.count,e.byteStride,a.blob.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter);}else{assert.equal(v.buffer,0);bytes=a.blob.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);}a.cache.set(id,bytes);return bytes;}
function accessor(a,id){const x=a.doc.accessors[id],v=a.doc.bufferViews[x.bufferView];assert.ok(x&&v);const size=sizes[x.componentType]*channels[x.type],stride=v.byteStride??size;assert.ok(size>0);const raw=view(a,x.bufferView),packed=Buffer.alloc(x.count*size);assert.ok((x.byteOffset??0)+Math.max(0,x.count-1)*stride+size<=raw.byteLength);
 for(let i=0;i<x.count;i++)packed.set(raw.subarray((x.byteOffset??0)+i*stride,(x.byteOffset??0)+i*stride+size),i*size);return {bytes:packed,x};}
const parents=d=>new Map(d.nodes.flatMap((n,i)=>(n.children??[]).map(c=>[c,i])));const pb=parents(base.doc),pn=parents(current.doc);
const nearest=(d,map,id)=>{while(id!==undefined){if(d.nodes[id].name)return d.nodes[id].name;id=map.get(id);}return '';};
let exactMeshes=0,newMeshes=0;const changedGeometries=[];
for(let i=0;i<base.doc.nodes.length;i++){
 const old=base.doc.nodes[i],now=current.doc.nodes[i];assert.equal(old.name,now.name);assert.deepEqual(old.children,now.children);const name=nearest(base.doc,pb,i);
 if(old.name&&!changed.has(old.name)){for(const k of ['matrix','rotation','translation','scale'])assert.deepEqual(old[k],now[k]);}
 if(old.mesh===undefined)continue;
 if(changed.has(name)){newMeshes++;changedGeometries.push(name);continue;}
 const o=base.doc.meshes[old.mesh],n=current.doc.meshes[now.mesh];assert.equal(o.primitives.length,n.primitives.length);
 for(let j=0;j<o.primitives.length;j++){const op=o.primitives[j],np=n.primitives[j];assert.equal(op.material,np.material);assert.deepEqual(Object.keys(op.attributes),Object.keys(np.attributes));
  for(const k of Object.keys(op.attributes)){assert.ok(accessor(base,op.attributes[k]).bytes.equals(accessor(current,np.attributes[k]).bytes),name+':'+k);}
  assert.ok(accessor(base,op.indices).bytes.equals(accessor(current,np.indices).bytes),name+':indices');}
 exactMeshes++;
}
let checked=0;
for(const m of current.doc.meshes)for(const p of m.primitives){const pos=accessor(current,p.attributes.POSITION);for(const id of Object.values(p.attributes))accessor(current,id);const idx=accessor(current,p.indices);const bytes=idx.bytes,step=sizes[idx.x.componentType];for(let i=0;i<bytes.length;i+=step){const n=step===4?bytes.readUInt32LE(i):step===2?bytes.readUInt16LE(i):bytes[i];assert.ok(n<pos.x.count);}checked++;}
assert.deepEqual(base.doc.materials,current.doc.materials);assert.deepEqual(base.doc.textures,current.doc.textures);
fs.writeFileSync(out,JSON.stringify({baseSha256:hash(base.file),candidateSha256:hash(current.file),changedMeshCount:newMeshes,exactUnchangedMeshes:exactMeshes,validIndexedPrimitives:checked,allNamedSocketTransformsPreserved:true,materialsUnchanged:true,changedGeometries},null,2));
