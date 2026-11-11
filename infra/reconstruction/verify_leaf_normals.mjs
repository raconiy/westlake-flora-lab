/** Independent read-only validation. Does not import the production smoothing implementation. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
await MeshoptDecoder.ready;
export function readGLB(path){
 const file=fs.readFileSync(path),len=file.readUInt32LE(12),doc=JSON.parse(file.subarray(20,20+len)),blob=file.subarray(28+len),cache=new Map();
 function view(id){
  if(cache.has(id))return cache.get(id);
  const v=doc.bufferViews[id],e=v.extensions?.EXT_meshopt_compression;let raw;
  if(e){raw=new Uint8Array(e.count*e.byteStride);MeshoptDecoder.decodeGltfBuffer(raw,e.count,e.byteStride,blob.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter);}
  else raw=blob.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);
  cache.set(id,raw);return raw;
 }
 function accessor(id){
  const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],raw=view(a.bufferView),dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const channels={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],size={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType],stride=v.byteStride??size*channels;
  const getters={5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'};
  const max={5120:127,5121:255,5122:32767,5123:65535,5125:4294967295}[a.componentType];
  const out=new Float64Array(a.count*channels);
  for(let i=0;i<a.count;i++)for(let c=0;c<channels;c++){
   let value=dv[getters[a.componentType]]((a.byteOffset??0)+i*stride+c*size,true);
   if(a.normalized&&a.componentType!==5126)value=Math.max(-1,value/max);
   out[i*channels+c]=value;
  }
  return {array:out,count:a.count,itemSize:channels,definition:a};
 }
 return {doc,accessor};
}
export const livingLeafMaterial=name=>name==='Living broadleaf blades'||/^Broadleaf 0[0-7]$/.test(name)||/^Foliage\.[0-4]$/.test(name);

const [source,target,receipt]=process.argv.slice(2);
if(!source||!target||!receipt)throw Error('Expected original.glb candidate.glb report.json');
const original=readGLB(source),candidate=readGLB(target),a=original.doc,b=candidate.doc;
const ar=fs.readFileSync(source),br=fs.readFileSync(target);
const bin=(raw,doc)=>raw.subarray(28+raw.readUInt32LE(12),28+raw.readUInt32LE(12)+doc.buffers[0].byteLength);
assert.equal(br.readUInt32LE(8),br.length,'GLB length');
assert.equal(br.readUInt32LE(12)%4,0,'JSON alignment');
assert.deepEqual(bin(br,b).subarray(0,a.buffers[0].byteLength),bin(ar,a),'Existing binary prefix must be byte-for-byte unchanged');
for(const field of ['nodes','scenes','scene','materials','textures','images','samplers','cameras','animations','skins'])assert.deepEqual(b[field],a[field],field);
assert.deepEqual(b.accessors.slice(0,a.accessors.length),a.accessors,'existing accessor metadata');
assert.deepEqual(b.bufferViews.slice(0,a.bufferViews.length),a.bufferViews,'existing bufferView metadata');
assert.equal(b.meshes.length,a.meshes.length);
const report={sourceSha256:crypto.createHash('sha256').update(ar).digest('hex'),candidateSha256:crypto.createHash('sha256').update(br).digest('hex'),checks:{existingBinaryPrefixUnchanged:true,nodeTransformsAndHierarchyUnchanged:true,materialsTexturesUVColorMetadataUnchanged:true,positionsAndIndicesUnchanged:true,nonLeafNormalsUnchanged:true},changedLeafPrimitives:0,leafPrimitives:0,leafComponents:0,skippedComponentFaces:{},verticesChecked:0,maxNormalLengthError:0,maxExpectedComponentNormalError:0,componentFaceHistogram:{},materialNames:[],details:[]};
const matNames=new Set();
// BFS over shared complete edges, not vertex connectivity: a shared petiole point
// cannot merge two separate leaves. Each component is evaluated independently.
function expectedNormals(pos,index,old) {
 const tris=index.length/3,n=pos.length/3,keys=Array.from({length:n},(_,i)=>`${pos[i*3]},${pos[i*3+1]},${pos[i*3+2]}`);
 const adjacent=Array.from({length:tris},()=>[]),edgeMap=new Map(),faces=[];
 for(let f=0;f<tris;f++){
  const ids=[index[f*3],index[f*3+1],index[f*3+2]],ps=ids.map(i=>[pos[i*3],pos[i*3+1],pos[i*3+2]]);
  const ab=ps[1].map((x,k)=>x-ps[0][k]),ac=ps[2].map((x,k)=>x-ps[0][k]);
  faces.push([ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]);
  for(let j=0;j<3;j++){
   const p=keys[ids[j]],q=keys[ids[(j+1)%3]];if(p===q)continue;
   const edge=[p,q].sort().join('|');
   if(edgeMap.has(edge)){const g=edgeMap.get(edge);adjacent[f].push(g);adjacent[g].push(f);}else edgeMap.set(edge,f);
  }
 }
 const seen=new Uint8Array(tris),groups=[],owner=new Int32Array(n).fill(-1),shared=new Set();
 for(let start=0;start<tris;start++){
  if(seen[start])continue;seen[start]=1;const group=[start];
  for(let k=0;k<group.length;k++)for(const other of adjacent[group[k]])if(!seen[other]){seen[other]=1;group.push(other);}
  const gi=groups.length;groups.push(group);
  for(const f of group)for(let k=0;k<3;k++){const v=index[f*3+k];if(owner[v]>=0&&owner[v]!==gi)shared.add(v);owner[v]=gi;}
 }
 const expected=Float64Array.from(old),hist={},skipped={};
 for(const group of groups){
  hist[group.length]=(hist[group.length]??0)+1;
  if(group.length<2||group.length>16){skipped[group.length]=(skipped[group.length]??0)+1;continue;}
  const vertices=new Set(),sums=new Map();
  for(const f of group){
   const distinct=new Set();
   for(let k=0;k<3;k++){const v=index[f*3+k];vertices.add(v);distinct.add(keys[v]);}
   for(const key of distinct){if(!sums.has(key))sums.set(key,[0,0,0]);const sum=sums.get(key);for(let k=0;k<3;k++)sum[k]+=faces[f][k];}
  }
  for(const v of vertices){
   if(shared.has(v))continue;
   const sum=sums.get(keys[v]),length=Math.hypot(...sum);if(length<1e-20)continue;
   const unit=sum.map(x=>x/length);if(unit.reduce((s,x,k)=>s+x*old[v*3+k],0)<-.05)continue;
   expected.set(unit,v*3);
  }
 }
 return {expected,hist,skipped,components:groups.length};
}
for(let mi=0;mi<a.meshes.length;mi++){
 const am=a.meshes[mi],bm=b.meshes[mi];assert.equal(bm.primitives.length,am.primitives.length);
 for(let pi=0;pi<am.primitives.length;pi++){
  const ap=am.primitives[pi],bp=bm.primitives[pi],name=a.materials[ap.material]?.name??'';
  const clean=p=>({...p,attributes:{...p.attributes,NORMAL:0}});assert.deepEqual(clean(bp),clean(ap),`mesh${mi}/primitive${pi} non-normal primitive`);
  const changed=ap.attributes.NORMAL!==bp.attributes.NORMAL;
  if(!livingLeafMaterial(name)){assert.equal(bp.attributes.NORMAL,ap.attributes.NORMAL,'Non-leaf normal accessor');continue;}
  report.leafPrimitives++;matNames.add(name);
  if(!changed)continue;report.changedLeafPrimitives++;
  const pos=original.accessor(ap.attributes.POSITION).array,index=original.accessor(ap.indices).array,old=original.accessor(ap.attributes.NORMAL).array,norm=candidate.accessor(bp.attributes.NORMAL).array;
  assert.equal(norm.length,old.length);const exp=expectedNormals(pos,index,old);let maxError=0,lengthError=0;
  for(let i=0;i<norm.length;i+=3){
   const length=Math.hypot(norm[i],norm[i+1],norm[i+2]);assert.ok(Number.isFinite(length)&&length>.99&&length<1.01,`finite unit normal at ${mi}/${pi}/${i/3}`);lengthError=Math.max(lengthError,Math.abs(length-1));
   for(let k=0;k<3;k++){const e=Math.abs(norm[i+k]-exp.expected[i+k]);maxError=Math.max(maxError,e);assert.ok(e<=.5/127+1e-6,`expected edge-component area normal ${mi}/${pi}/${i/3} error=${e}`);}
  }
  report.verticesChecked+=norm.length/3;report.leafComponents+=exp.components;
  report.maxNormalLengthError=Math.max(report.maxNormalLengthError,lengthError);
  report.maxExpectedComponentNormalError=Math.max(report.maxExpectedComponentNormalError,maxError);
  for(const [k,v] of Object.entries(exp.hist))report.componentFaceHistogram[k]=(report.componentFaceHistogram[k]??0)+v;
  for(const [k,v] of Object.entries(exp.skipped))report.skippedComponentFaces[k]=(report.skippedComponentFaces[k]??0)+v;
  report.details.push({mesh:mi,primitive:pi,material:name,components:exp.components,vertices:norm.length/3,maxExpectedError:maxError,maxNormalLengthError:lengthError});
 }
}
assert.ok(report.changedLeafPrimitives>0);
report.materialNames=[...matNames];report.checks.finiteUnitLeafNormalsWithinByteQuantization=true;report.checks.independentSharedEdgeComponentNormals=true;report.status='passed';
fs.writeFileSync(receipt,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,details:undefined},null,2));
