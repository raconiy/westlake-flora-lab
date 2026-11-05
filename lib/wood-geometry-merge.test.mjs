import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import * as THREE from 'three';
import { mergeWoodGeometries } from './wood-geometry-merge.ts';
import { tagWoodTube, woodSections } from './wood-loads.ts';
import { buildPlant } from './plant-engine.ts';
import { createBeamDynamics } from './beam-dynamics.ts';

const bytes = array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

// Deliberately independent of toNonIndexed and the merge helper: follow each
// submitted vertex ID and copy its raw components, including UV/normal seams.
function expanded(geometry, name) {
  const a = geometry.attributes[name], count = geometry.index?.count ?? a.count;
  const out = new a.array.constructor(count * a.itemSize);
  for (let i = 0; i < count; i++) {
    const id = geometry.index ? geometry.index.array[i] : i;
    for (let j = 0; j < a.itemSize; j++) out[i*a.itemSize+j] = a.array[id*a.itemSize+j];
  }
  return out;
}
function streamSHA(geometry) {
  const hash = createHash('sha256');
  for (const name of Object.keys(geometry.attributes).sort()) {
    const a = geometry.attributes[name];
    hash.update(JSON.stringify([name,a.itemSize,a.array.constructor.name,a.normalized,a.gpuType,a instanceof THREE.Float16BufferAttribute]));
    hash.update(bytes(expanded(geometry,name)));
  }
  return hash.digest('hex');
}
function fixture(indexed=true, offset=0) {
  const g = new THREE.BufferGeometry();
  // Equal positions with intentionally different seam normals and UVs.
  g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,0,0,0],3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1,0,1,0],3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));
  g.setAttribute('color',new THREE.Uint8BufferAttribute([1,2,3,4,5,6,7,8,9,10,11,12],3,true));
  const ids = new THREE.Uint32BufferAttribute([9,8,7,6],1); ids.gpuType=THREE.IntType; g.setAttribute('woodID',ids);
  if (indexed) g.setIndex([0,1,2,3,2,1]);
  else {
    for (const name of Object.keys(g.attributes)) {
      const a=g.attributes[name],array=a.array.slice(0,3*a.itemSize),copy=new THREE.BufferAttribute(array,a.itemSize,a.normalized);
      copy.gpuType=a.gpuType;g.setAttribute(name,copy);
    }
  }
  g.translate(offset,.3,-.2); return g;
}

test('indexed/nonindexed merge preserves every raw attribute, seam and winding in source index order',()=>{
  const parts=[fixture(true),fixture(false,2),fixture(true,4)],before={};
  for (const name of Object.keys(parts[0].attributes)) {
    const chunks=parts.map(p=>expanded(p,name));
    before[name]=Buffer.concat(chunks.map(a=>Buffer.from(bytes(a))));
  }
  const out=mergeWoodGeometries(parts);
  assert.ok(out.index.array instanceof Uint16Array);
  assert.deepEqual([...out.index.array],[0,1,2,3,2,1,4,5,6,7,8,9,10,9,8]);
  for (const [name,raw] of Object.entries(before)) assert.deepEqual(Buffer.from(bytes(expanded(out,name))),raw,name);
  assert.equal(out.attributes.color.normalized,true);assert.equal(out.attributes.woodID.gpuType,THREE.IntType);
  assert.equal(out.attributes.position.count,11);out.dispose();
});

test('half-float storage and accessors survive without converting bit patterns',()=>{
  const parts=[fixture(false),fixture(false)];
  for(const p of parts)p.setAttribute('half',new THREE.Float16BufferAttribute(new Uint16Array([0x3c00,0x3800,0xbc00]),1));
  const out=mergeWoodGeometries(parts);
  assert.ok(out.attributes.half instanceof THREE.Float16BufferAttribute);
  assert.deepEqual([...out.attributes.half.array],[0x3c00,0x3800,0xbc00,0x3c00,0x3800,0xbc00]);
  assert.equal(out.attributes.half.getX(0),1);assert.equal(out.attributes.half.getX(2),-1);out.dispose();
});

test('Uint32 offsets cross 16-bit capacity and reserve WebGL2 primitive restart IDs',()=>{
  const a=new THREE.BufferGeometry(),b=new THREE.BufferGeometry();
  a.setAttribute('position',new THREE.BufferAttribute(new Float32Array(65535*3),3));a.setIndex([0,1,65534]);
  b.setAttribute('position',new THREE.BufferAttribute(new Float32Array(3*3),3));b.setIndex([2,1,0]);
  const out=mergeWoodGeometries([a,b]);
  assert.ok(out.index.array instanceof Uint32Array);
  assert.deepEqual([...out.index.array],[0,1,65534,65537,65536,65535]);out.dispose();
});

test('final baked sections are captured once before disposal; source metadata has separate vertex/index/section ranges',()=>{
  const tube=tagWoodTube(new THREE.CylinderGeometry(.02,.04,1,4,2,true),2,4);tube.clearGroups();
  tube.scale(2,1,3).rotateZ(.4).translate(.3,.8,-.2);
  const expected=woodSections(tube),support={schema:'test-support',stations:[0,.5,1]};tube.userData.support=support;
  // Exercise pre-resolved nonindexed parts with metadata and a shared input.
  const flat=fixture(false,2);flat.deleteAttribute('color');flat.deleteAttribute('woodID');
  flat.userData.woodSections=[expected[0]];flat.userData.support={id:'nonindexed'};
  let reads=0,disposed=0;
  Object.defineProperty(tube.userData,'woodSections',{enumerable:true,get(){reads++;assert.equal(disposed,0);return expected;}});
  for(const p of [tube,flat])p.addEventListener('dispose',()=>{disposed++;});
  const out=mergeWoodGeometries([tube,flat,tube]);
  assert.equal(reads,2,'woodSections checks then returns cached metadata once for the unique source');
  assert.equal(disposed,2,'shared input is disposed once');
  assert.deepEqual(out.userData.woodSections,[...expected,expected[0],...expected]);
  const ranges=out.userData.woodGeometrySources;
  assert.deepEqual(ranges.map(({firstVertex,vertexCount,firstIndex,indexCount,firstWoodSection,woodSectionCount})=>
    [firstVertex,vertexCount,firstIndex,indexCount,firstWoodSection,woodSectionCount]),
    [[0,15,0,48,0,2],[15,3,48,3,2,1],[18,15,51,48,3,2]]);
  assert.equal(ranges[0].userData.support,support);assert.equal(ranges[2].userData,ranges[0].userData);
  assert.equal(ranges[1].userData.support.id,'nonindexed');
  assert.equal(out.userData.woodSections[0],expected[0]);out.dispose();
});

test('incompatible attributes and unsupported rendering contracts fail without releasing inputs',()=>{
  const cases=[
    ['names',p=>p.deleteAttribute('uv'),/attribute names/],
    ['type',p=>p.setAttribute('uv',new THREE.Uint16BufferAttribute([0,0,1,0,0,1,1,1],2)),/attribute uv/],
    ['size',p=>p.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(12),3)),/attribute uv/],
    ['count',p=>p.setAttribute('uv',new THREE.Float32BufferAttribute([0,0],2)),/attribute uv/],
    ['normalized',p=>p.attributes.color.normalized=false,/attribute color/],
    ['gpuType',p=>p.attributes.woodID.gpuType=THREE.FloatType,/attribute woodID/],
    ['usage',p=>p.attributes.uv.setUsage(THREE.DynamicDrawUsage),/attribute uv/],
    ['interleaved',p=>p.setAttribute('uv',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Float32Array(8),2),2,0)),/unsupported attribute/],
    ['instanced',p=>p.setAttribute('uv',new THREE.InstancedBufferAttribute(new Float32Array(8),2)),/unsupported attribute/],
    ['morph',p=>p.morphAttributes.position=[p.attributes.position.clone()],/morph/],
    ['drawRange',p=>p.setDrawRange(3,3),/drawRange/],
    ['groups',p=>p.addGroup(0,6,1),/groups/],
    ['bounds',p=>p.index.array[0]=4,/outside/],
    ['index format',p=>p.setIndex(new THREE.Float32BufferAttribute([0,1,2],1)),/unsigned/],
    ['half index',p=>p.setIndex(new THREE.Float16BufferAttribute(new Uint16Array([0,1,2]),1)),/unsigned/],
    ['triangles',p=>p.setIndex([0,1]),/complete triangles/],
  ];
  for(const [name,change,error]of cases){
    const a=fixture(),b=fixture();let disposed=0;
    for(const p of [a,b])p.addEventListener('dispose',()=>disposed++);
    change(b);assert.throws(()=>mergeWoodGeometries([a,b]),error,name);assert.equal(disposed,0,name);
    a.dispose();b.dispose();
  }
  assert.throws(()=>mergeWoodGeometries([]),/at least one/);
  const restart=new THREE.BufferGeometry();restart.setAttribute('position',new THREE.BufferAttribute(new Float32Array(256*3),3));
  restart.setIndex(new THREE.Uint8BufferAttribute([0,1,255],1));
  assert.throws(()=>mergeWoodGeometries([restart]),/primitive restart/);restart.dispose();
});

// Exact pre-change Ginkgo merge body from baseline aa867f0. Only this function
// is replaced in a temporary module; morphology and all other production code
// remain identical. No test-only injection hook is added to production.
const legacyBody=`
    let count=0; const flat=parts.map(g=>{const f=g.index?g.toNonIndexed():g;count+=f.attributes.position.count;return f;});
    const positions=new Float32Array(count*3),normals=new Float32Array(count*3),uv=new Float32Array(count*2);let n=0;
    for(const g of flat){positions.set(g.attributes.position.array as ArrayLike<number>,n*3);normals.set(g.attributes.normal.array as ArrayLike<number>,n*3);if(g.attributes.uv)uv.set(g.attributes.uv.array as ArrayLike<number>,n*2);n+=g.attributes.position.count;}
    const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(positions,3));out.setAttribute("normal",new THREE.BufferAttribute(normals,3));out.setAttribute("uv",new THREE.BufferAttribute(uv,2));
    mergeWoodSections(parts,out);for(const g of new Set([...parts,...flat]))g.dispose(); return ownGeometry(out);
`;
async function withLegacy(run){
  const source=await readFile(new URL('./plant-engine.ts',import.meta.url),'utf8');
  const target='    return ownGeometry(mergeWoodGeometries(parts));';
  assert.equal(source.split(target).length,2,'replace only the owned Ginkgo merge body');
  const legacy=source.replace(target,legacyBody).replace('import {tagWoodTube}', 'import {tagWoodTube,mergeWoodSections}');
  const file=new URL(`./.wood-merge-legacy-${randomUUID()}.ts`,import.meta.url);
  await writeFile(file,legacy);
  try {return await run((await import(file.href)).buildPlant);}finally{await unlink(file);}
}

// Independent generated-geometry audit. Area is integrated from actual world
// triangles. Volumes/drag are recomputed from captured polygon rings, not from
// sectionVolume/sectionProjectedArea or the engine's load totals.
function actualWood(model){
  let surfaceAreaM2=0,volumeM3=0,projectedAreaM2=0,segments=0;
  const wind=new THREE.Vector3(1,0,.25).normalize(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  model.group.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||!o.geometry.userData.woodSections&&!o.geometry.userData.woodTube)return;
    const g=o.geometry,p=g.attributes.position;
    for(let i=0;i<(g.index?.count??p.count);i+=3){
      a.fromBufferAttribute(p,g.index?g.index.array[i]:i).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(p,g.index?g.index.array[i+1]:i+1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(p,g.index?g.index.array[i+2]:i+2).applyMatrix4(o.matrixWorld);
      surfaceAreaM2+=b.sub(a).cross(c.sub(a)).length()/2;
    }
    for(const s of woodSections(g)){
      assert.ok(s.ringA&&s.ringB&&!s.ellipse,'Ginkgo polygon-ring contract');segments++;
      const rings=[s.ringA,s.ringB].map(r=>r.map(v=>new THREE.Vector3(...v)));
      const area=r=>{const cross=new THREE.Vector3();for(let i=0;i<r.length;i++)cross.add(r[i].clone().cross(r[(i+1)%r.length]));return cross.length()/2;};
      const areas=rings.map(area),localLength=new THREE.Vector3(...s.a).distanceTo(new THREE.Vector3(...s.b));
      volumeM3+=localLength*(areas[0]+Math.sqrt(areas[0]*areas[1])+areas[1])/3*Math.abs(o.matrixWorld.determinant());
      const start=new THREE.Vector3(...s.a).applyMatrix4(o.matrixWorld),end=new THREE.Vector3(...s.b).applyMatrix4(o.matrixWorld);
      const axis=end.sub(start),length=axis.length();if(!length)continue;
      const across=new THREE.Vector3().crossVectors(axis.divideScalar(length),wind),sine=across.length();if(sine<1e-15)continue;across.divideScalar(sine);
      const linear=new THREE.Matrix3().setFromMatrix4(o.matrixWorld);
      const widths=rings.map(r=>{let min=Infinity,max=-Infinity;for(const q of r){const d=q.applyMatrix3(linear).dot(across);min=Math.min(min,d);max=Math.max(max,d);}return max-min;});
      projectedAreaM2+=length*sine*(widths[0]+widths[1])/2;
    }
  });
  return {surfaceAreaM2,volumeM3,woodMassKg:volumeM3*550,projectedAreaM2,unshieldedWoodDragN:projectedAreaM2*.5*1.225*1.1*3.2**2,segments};
}

function audit(model){
  model.group.updateMatrixWorld(true);
  const local=createHash('sha256'),world=createHash('sha256'),identity=createHash('sha256'),metadata=createHash('sha256');
  const geometries=new Set(),buffers=new Set(),materials=new Set(),textures=new Set();
  let nodes=0,meshes=0,instances=0,draws=0,woodBytes=0;
  const addArray=a=>buffers.add(a.buffer);
  model.group.traverse(o=>{
    const index=nodes++;identity.update(JSON.stringify([index,o.name,o.type,o.userData,o.matrix.toArray(),o.matrixWorld.toArray(),o.visible,o.castShadow,o.receiveShadow]));
    if(!o.isMesh)return;meshes++;draws+=Math.max(1,o.geometry.groups.length);
    const g=o.geometry;local.update(streamSHA(g));
    // Hash world coordinates AND transformed normals in triangle submission
    // order. A matrix-only comparison would miss an incorrect index offset.
    const p=expanded(g,'position'),n=g.attributes.normal&&expanded(g,'normal');
    const wp=new Float64Array(p.length),wn=n&&new Float64Array(n.length),normal=new THREE.Matrix3().getNormalMatrix(o.matrixWorld),v=new THREE.Vector3();
    for(let i=0;i<p.length;i+=3){v.fromArray(p,i).applyMatrix4(o.matrixWorld).toArray(wp,i);if(n)v.fromArray(n,i).applyNormalMatrix(normal).toArray(wn,i);}
    world.update(bytes(wp));if(wn)world.update(bytes(wn));
    metadata.update(JSON.stringify(woodSections(g)));
    if(!geometries.has(g)){
      geometries.add(g);const wood=!!g.userData.woodSections;
      for(const a of [...Object.values(g.attributes),g.index].filter(Boolean)){addArray(a.array);if(wood)woodBytes+=a.array.byteLength;}
    }
    if(o.isInstancedMesh){instances+=o.count;addArray(o.instanceMatrix.array);if(o.instanceColor)addArray(o.instanceColor.array);identity.update(bytes(o.instanceMatrix.array));if(o.instanceColor)identity.update(bytes(o.instanceColor.array));}
    for(const m of Array.isArray(o.material)?o.material:[o.material]){
      materials.add(m);
      for(const t of Object.values(m))if(t instanceof THREE.Texture)textures.add(t);
    }
  });
  const joints=model.branches.map(b=>[b.pivot.userData,b.pivot.position.toArray(),b.rest.toArray(),b.length,b.radius,b.order,b.phase,b.flexibility,b.sag]);
  identity.update(JSON.stringify([joints,model.height,model.leafCount]));
  const actual=actualWood(model);
  const driver=createBeamDynamics(model);driver.update(0,3.2,9.81,1);const beam={...driver.stats};driver.dispose();
  return {
    proof:{expandedAttributeSHA256:local.digest('hex'),worldTriangleAndNormalSHA256:world.digest('hex'),nodeMatrixLeafJointSHA256:identity.digest('hex'),woodSectionSHA256:metadata.digest('hex'),
      counts:{nodes,meshes,instances,drawCallsEstimate:draws,geometries:geometries.size,materials:materials.size,textures:textures.size,joints:joints.length},actual,beam,leafCount:model.leafCount,heightM:model.height},
    memory:{woodBufferBytes:woodBytes,uniqueGeometryAndInstanceBufferBytes:[...buffers].reduce((n,b)=>n+b.byteLength,0)},
  };
}

function checkCleanup(model){
  const resources=new Set();model.group.traverse(o=>{
    if(!o.isMesh)return;resources.add(o.geometry);if(o.isInstancedMesh)resources.add(o);
    for(const m of Array.isArray(o.material)?o.material:[o.material]){resources.add(m);for(const v of Object.values(m))if(v instanceof THREE.Texture)resources.add(v);}
  });
  const counts=new Map([...resources].map(r=>[r,0]));for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));
  model.dispose();assert.equal(model.group.children.length,0);for(const n of counts.values())assert.equal(n,1,'each live shared resource disposed once');
  return resources.size;
}

test('Ginkgo actual loads, triangles, transforms, leaf IDs, draw budget and cleanup match the legacy merge',async()=>{
  await withLegacy(async legacyBuild=>{
    const params={age:3,day:180,seed:42,density:1};
    const old=legacyBuild('ginkgo',params),current=buildPlant('ginkgo',params);
    try {
      const before=audit(old),after=audit(current);assert.deepEqual(after.proof,before.proof);
      assert.ok(after.memory.woodBufferBytes<before.memory.woodBufferBytes);
      checkCleanup(old);checkCleanup(current);
    }catch(e){old.dispose();current.dispose();throw e;}
  });
});

// Opt-in bounded measurement: exactly ONE old/new construction at each of
// 18y/45y, not a stress sweep. Timed construction excludes the expensive audit.
// WOOD_MERGE_HANDOFF=wood-geometry-merge-handoff.json node --test lib/wood-geometry-merge.test.mjs
test('bounded 18/45-year Ginkgo before/after measurements',{skip:!process.env.WOOD_MERGE_HANDOFF},async()=>{
  const results=[];
  await withLegacy(async legacyBuild=>{
    for(const age of [18,45]){
      const params={age,day:180,seed:42,density:1};
      const start=performance.now(),old=legacyBuild('ginkgo',params),beforeMs=performance.now()-start;
      const before=audit(old);const oldResources=checkCleanup(old);
      const next=performance.now(),current=buildPlant('ginkgo',params),afterMs=performance.now()-next;
      const after=audit(current);assert.deepEqual(after.proof,before.proof);
      let merged=0,uint32=0,sources=0;current.group.traverse(o=>{if(o.isMesh&&o.geometry.userData.woodGeometrySources){merged++;if(o.geometry.index.array instanceof Uint32Array)uint32++;sources+=o.geometry.userData.woodGeometrySources.length;}});
      const resources=checkCleanup(current);assert.equal(resources,oldResources);
      const savedBytes=before.memory.woodBufferBytes-after.memory.woodBufferBytes;
      results.push({params,sampleCount:1,buildMs:{legacy:beforeMs,indexed:afterMs},memory:{legacy:before.memory,indexed:after.memory,savedBytes,savedWoodBufferPercent:100*savedBytes/before.memory.woodBufferBytes},mergedMeshes:merged,uint32Meshes:uint32,sourceRanges:sources,disposedLiveResources:resources,equivalent:true,proof:after.proof});
    }
  });
  await writeFile(process.env.WOOD_MERGE_HANDOFF,JSON.stringify({
    schema:'wood-geometry-merge-handoff/v1',taskId:'bdcac109-8529-4950-a55f-a04863a88087',baseline:'aa867f0',createdAt:new Date().toISOString(),productionWorkerEnabled:false,
    environment:{node:process.version,three:THREE.REVISION,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model},
    method:{repeats:1,warmup:'none; sequential legacy then indexed per age; shared process/JIT and uncontrolled host load',timing:'performance.now build only; excludes proof auditing, beam setup and GPU',memory:'exact unique backing bytes for live geometry/index/instance arrays; woodBufferBytes is merged wood attribute+index bytes; excludes metadata/objects/textures, transient allocations and RSS',proof:'independently expanded raw attributes and transformed triangle/normal SHA; node/matrix/instance/leaf/joint SHA; section SHA; independent triangle area and polygon-ring volume/drag; full beam stats equality',scope:'baseline morphology only; lead pending support/material changes require combined revalidation'},
    supportMetadataContract:{path:'geometry.userData.woodGeometrySources[]',ranges:'firstVertex/vertexCount in retained original vertex table; firstIndex/indexCount in rendered triangle index stream; firstWoodSection/woodSectionCount in final woodSections',metadata:'source userData retained by reference, including support metadata; never add firstVertex to an index-stream offset',ownership:'helper consumes unique source geometries once on success; all validation failures leave them live; materials/textures remain caller-owned'},
    sources:['lib/plant-engine.ts: Ginkgo tube and mergeGeometries (baseline aa867f0)','lib/wood-loads.ts: final-vertex ring metadata contract','lib/beam-dynamics.ts: engineering loads','codec prototype receipt ad68693e-7cd9-4ef8-96dc-e71c481efbd6 and plant-asset-handoff.json: 178185901-byte payload, 569.692ms encode / 609.49ms decode (prior sample only)'],
    limitations:['CPU single samples are not latency percentiles or browser frame measurements','indexed buffers and per-source woodSections/support metadata remain large; metadata heap size is not measured','volume/mass/drag are generated-geometry engineering estimates, not biological measurements or aerodynamic sheltering models','no decimation or topology change; total triangle count, leaf instances and draw budget unchanged','no worker/codec production enable; main-thread generation, beam traversal, receiver decode, GPU upload/draw and age-animation scheduling remain','generic helper rejects material groups, partial drawRange, morph targets, interleaved/instanced/GPU-only/custom attributes rather than silently dropping them','full merged frontend/infra suite, CI, browser WebGL2/normal/UV QA and colleague integration belong to lead','model routing not independently inspected or changed; no routing switch interface was exposed, no credential/auth access; runner receipt must confirm requested GPT-Load gpt-6.1-sol/high'],
    results,
  },null,2)+'\n');
});
