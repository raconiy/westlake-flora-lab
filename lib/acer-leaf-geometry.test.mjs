import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import * as T from 'three';
import {acerLeafBlade} from './acer-leaf-geometry.ts';
import {buildAdditionalPlant} from './additional-species.ts';
import {createBeamDynamics} from './beam-dynamics.ts';
import {createLeafDynamics} from './leaf-dynamics.ts';
const artifact=name=>new URL(`../artifacts/acer-blade/${name}`,import.meta.url);
const old=JSON.parse(readFileSync(artifact('old-geometry-metrics.json')));
const baseline=JSON.parse(readFileSync(artifact('root-baseline.json')));
const hash=a=>createHash('sha256').update(JSON.stringify(a)).digest('hex');
// The archived catalogue contains JS doubles from trigonometric calculations.
// Hashing those against a macOS-generated JSON digest is not a portable oracle:
// CI's Linux libm may differ in the last bit. Execute the SHA-pinned pre-blade
// source on this platform instead; compare the complete catalogues EXACTLY.
// Keep the original baseline JSON and historical coordinate gates untouched.
const controlSource=readFileSync(artifact('additional-species-source-snapshot.txt'),'utf8');
const controlManifest=JSON.parse(readFileSync(artifact('root-import-sha256.json')));
assert.equal(createHash('sha256').update(controlSource).digest('hex'),controlManifest.files['lib/additional-species.ts'].sha256);
const controlJS=stripTypeScriptTypes(controlSource).replace(/from\s+(['"])([^'"]+)\1/g,
 (_,quote,specifier)=>`from ${quote}${import.meta.resolve(specifier)}${quote}`);
const buildControl=(await import(`data:text/javascript;base64,${Buffer.from(controlJS).toString('base64')}`)).buildAdditionalPlant;
function organCatalogues(model){const out=[];model.group.traverse(o=>{if(o.isInstancedMesh&&o.userData.nodes)out.push(o.userData.nodes);});return out;}
const sameCatalogues=(actual,expected)=>assert.deepEqual(actual,expected,'all material-node fields retain the SHA-pinned pre-blade source values on this platform');
const point=(p,i)=>new T.Vector3().fromBufferAttribute(p,i);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function shape(g){const p=g.attributes.position,ix=g.index;let area=0,projected=0,minNormalZ=1,minTriangleArea=Infinity;
 for(let i=0;i<ix.count;i+=3){const[a,b,c]=[0,1,2].map(j=>point(p,ix.getX(i+j))),n=b.sub(a).cross(c.sub(a));area+=n.length()/2;projected+=n.z/2;minNormalZ=Math.min(minNormalZ,n.clone().normalize().z);minTriangleArea=Math.min(minTriangleArea,n.length()/2);}
 g.computeBoundingBox();return{vertices:p.count,triangles:ix.count/3,boundary:g.userData.acerBlade.boundaryCount,areaM2:area,projectedAreaM2:projected,minNormalZ,minTriangleArea,bounds:{min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()}};
}

test('new blade keeps exact historical Float32 XYZ envelope, insertion and metric UV mapping',()=>{
 const g=acerLeafBlade();try{
  assert.deepEqual(shape(g).bounds,old.bounds);const p=g.attributes.position,uv=g.attributes.uv;
  assert.deepEqual(point(p,0).toArray(),[0,0,0]);assert.ok(p.count<=400);
  for(const name of ['position','normal','uv'])assert.ok(Array.from(g.attributes[name].array).every(Number.isFinite));
  for(let i=0;i<p.count;i++){
   assert.ok(Math.abs(uv.getX(i)-(.5+p.getX(i)/.0924))<6e-8);assert.ok(Math.abs(uv.getY(i)-(p.getY(i)+.01725)/.06)<6e-8);
   assert.ok(uv.getX(i)>=0&&uv.getX(i)<=1&&uv.getY(i)>=0&&uv.getY(i)<=1);
  }
 }finally{g.dispose();}
});

test('actual outline has seven acute palmate apices, six deep sinuses, serration and a basal notch',()=>{
 const g=acerLeafBlade();try{
  const p=g.attributes.position,n=g.userData.acerBlade.boundaryCount,v=Array.from({length:n},(_,i)=>point(p,i));
  const apices=[];let reflex=0,maxEdge=0;
  for(let i=0;i<n;i++){
   const a=v[(i+n-1)%n].clone().sub(v[i]),b=v[(i+1)%n].clone().sub(v[i]);a.z=b.z=0;
   if(a.angleTo(b)<Math.PI/2&&Math.hypot(v[i].x,v[i].y)>.02)apices.push(i);
   if(cross(v[(i+n-1)%n],v[i],v[(i+1)%n])>1e-10)reflex++;
   maxEdge=Math.max(maxEdge,v[i].distanceTo(v[(i+1)%n]));
  }
  assert.equal(apices.length,7,'primary apex count measured from actual acute corners, not metadata');
  assert.ok(reflex>=60,'many alternating concave tooth roots, beyond six lobe sinuses');
  assert.ok(maxEdge<.004,'curved margins are sampled densely instead of coarse lobe edges');
  for(let i=1;i<apices.length;i++){
   const between=v.slice(apices[i-1]+1,apices[i]);assert.ok(between.length>=20);
   const radius=q=>Math.hypot(q.x,q.y);
   assert.ok(Math.min(...between.map(radius))<.65*Math.min(radius(v[apices[i-1]]),radius(v[apices[i]])),'actual deep concavity separates primary lobes');
  }
  assert.ok(v[1].y<0&&v[n-1].y<0&&v[1].x<0&&v[n-1].x>0);
  assert.ok(cross(v[n-1],v[0],v[1])>0,'petiole insertion is an actual concave basal notch');
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
   if(i===0&&j===n-1)continue;const a=v[i],b=v[(i+1)%n],c=v[j],d=v[(j+1)%n];
   assert.ok(!(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0),'boundary has no self intersections');
  }
 }finally{g.dispose();}
});

test('triangulation is a single orientable disk with the exact outline boundary, no holes or degenerate panels',()=>{
 const g=acerLeafBlade();try{
  const p=g.attributes.position,ix=g.index,n=g.userData.acerBlade.boundaryCount,edges=new Map(),adj=Array.from({length:p.count},()=>new Set());
  const key=(a,b)=>[Math.min(a,b),Math.max(a,b)].join(':');
  for(let t=0;t<ix.count;t+=3){const ids=[0,1,2].map(j=>ix.getX(t+j));assert.equal(new Set(ids).size,3);
   for(const id of ids)assert.ok(Number.isInteger(id)&&id>=0&&id<p.count);
   for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],k=key(a,b),e=edges.get(k)||{count:0,balance:0};e.count++;e.balance+=a<b?1:-1;edges.set(k,e);adj[a].add(b);adj[b].add(a);}
  }
  const boundary=new Set(Array.from({length:n},(_,i)=>key(i,(i+1)%n)));
  for(const[k,e]of edges){assert.equal(e.count,boundary.has(k)?1:2);if(e.count===2)assert.equal(e.balance,0);}
  assert.ok([...boundary].every(k=>edges.has(k)));assert.equal(p.count-edges.size+ix.count/3,1);
  const seen=new Set([0]),queue=[0];for(const a of queue)for(const b of adj[a])if(!seen.has(b)){seen.add(b);queue.push(b);}assert.equal(seen.size,p.count);
  let polygonArea=0;for(let i=0;i<n;i++){const a=point(p,i),b=point(p,(i+1)%n);polygonArea+=a.x*b.y-b.x*a.y;}
  const s=shape(g);assert.ok(Math.abs(s.projectedAreaM2-Math.abs(polygonArea)/2)<1e-14,'triangles cover the simple polygon exactly once');
  assert.ok(s.minTriangleArea>1e-10);assert.ok(s.minNormalZ>.98,'all panel normals face +Z with gentle relief');
  for(let i=0;i<p.count;i++){const normal=point(g.attributes.normal,i);assert.ok(Math.abs(normal.length()-1)<1e-6);assert.ok(normal.z>.98);}
  assert.ok(s.areaM2>s.projectedAreaM2*1.001&&s.areaM2<s.projectedAreaM2*1.02,'actual small nonplanar fold');
  assert.ok(s.areaM2>old.areaM2*1.05&&s.areaM2<old.areaM2*1.5,'new area intentionally differs within the same fixed envelope');
  writeFileSync(artifact('new-geometry-metrics.json'),JSON.stringify({...s,oldAreaM2:old.areaM2,areaChangePercent:(s.areaM2/old.areaM2-1)*100},null,2)+'\n');
 }finally{g.dispose();}
});

test('root import remains byte-identical outside mapleBlade and its helper import; historical reference JSON is untouched',()=>{
 const before=readFileSync(artifact('additional-species-source-snapshot.txt'),'utf8');
 const after=readFileSync(new URL('./additional-species.ts',import.meta.url),'utf8').replace("import {acerLeafBlade} from './acer-leaf-geometry.ts';\n",'');
 const remove=s=>s.replace(/function mapleBlade\(\)[\s\S]*?(?=\n\nexport function)/,'<geometry>');
 assert.equal(remove(after),remove(before));
 const manifest=JSON.parse(readFileSync(artifact('root-import-sha256.json')));
 const file='lib/acer-establishment-reference.json';
 assert.equal(createHash('sha256').update(readFileSync(new URL(`../${file}`,import.meta.url))).digest('hex'),manifest.files[file].sha256,'historical reference JSON is never refreshed for a new outline');
});

test('few juvenile cases and 18y preserve all non-blade geometry, organ catalogues, instance matrices, draw counts and disposal',()=>{
 for(const expected of baseline){
  const m=buildAdditionalPlant('acer',{age:expected.age,day:180,seed:42,density:1}),resources=new Map();
  try{
   m.group.updateMatrixWorld(true);const meshes=[],matrices=[],catalogues=[],templates=new Set();let draws=0,vertices=0;
   m.group.traverse(o=>{if(!o.isMesh)return;draws++;vertices+=o.geometry.attributes.position.count;
    const leaf=o.userData.organ==='leaf'&&o.userData.leafClass!=='cotyledon';
    if(leaf)templates.add(o.geometry);
    else meshes.push({name:o.name,type:o.type,attributes:Object.fromEntries(Object.entries(o.geometry.attributes).map(([k,v])=>[k,Array.from(v.array)])),index:o.geometry.index?Array.from(o.geometry.index.array):null,matrix:o.matrixWorld.toArray(),instances:o.isInstancedMesh?Array.from(o.instanceMatrix.array):null});
    if(o.isInstancedMesh){matrices.push({name:o.name,organ:o.userData.organ,matrices:Array.from(o.instanceMatrix.array),world:o.matrixWorld.toArray(),count:o.count});if(o.userData.nodes)catalogues.push(o.userData.nodes);}
    for(const r of [o.geometry,...(Array.isArray(o.material)?o.material:[o.material])])if(!resources.has(r)){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}
   });
   assert.equal(hash(meshes),expected.nonBladeHash,'wood, buds, petioles, cotyledons and root-level transforms retain exact baseline');
   assert.equal(hash(matrices),expected.instanceHash);
   const control=buildControl('acer',{age:expected.age,day:180,seed:42,density:1});
   try{sameCatalogues(catalogues,organCatalogues(control));}finally{control.dispose();}
   assert.equal(m.leafCount,expected.leafCount);assert.equal(draws,expected.draws);assert.equal(templates.size,1);
   assert.ok(vertices<180000);assert.ok([...templates].every(g=>g.attributes.position.count<=400));
  }finally{m.dispose();}
  assert.equal(m.group.children.length,0);for(const count of resources.values())assert.equal(count,1);
 }
});

test('portable oracle rejects actual node birth/identity/deletion changes and a 10 micrometre instance slide',()=>{
 const model=buildAdditionalPlant('acer',{age:.2,day:180,seed:42,density:1});
 try{
  const expected=structuredClone(organCatalogues(model));assert.ok(expected[0].length>0);
  sameCatalogues(organCatalogues(model),expected);
  for(const mutate of [a=>a[0][0].birth+=Number.EPSILON,a=>a[0][0].id+='-changed',a=>a[0].pop(),a=>a.pop()]){
   const changed=structuredClone(expected);mutate(changed);assert.throws(()=>sameCatalogues(changed,expected));
  }
  let leaves;model.group.traverse(o=>{if(!leaves&&o.isInstancedMesh&&o.userData.nodes?.length)leaves=o;});
  const before=hash(Array.from(leaves.instanceMatrix.array));leaves.instanceMatrix.array[12]+=.00001;
  // Catalogues alone do not encode spatial placement; matrices are a separate gate.
  sameCatalogues(organCatalogues(model),expected);
  assert.throws(()=>assert.equal(hash(Array.from(leaves.instanceMatrix.array)),before),'the retained matrix oracle rejects an actual rendered-instance translation');
 }finally{model.dispose();}
});

test('independent historical wood coordinates, joint rest frames and later leaf matrices retain their original exact assertions',()=>{
 const reference=JSON.parse(readFileSync(new URL('./acer-establishment-reference.json',import.meta.url)));
 const near=(a,b,tol=1e-12)=>assert.ok(a.distanceTo(b)<tol);
 for(const r of reference.records){
  const m=buildAdditionalPlant('acer',{age:r.age,seed:r.seed,day:180,density:1});
  try{
   m.group.updateMatrixWorld(true);assert.equal(m.branches.length-1,r.joints.length);
   r.joints.forEach((j,i)=>{const actual=m.branches[i+1];near(actual.pivot.position,new T.Vector3(...j.position));assert.deepEqual(actual.rest.toArray().map(n=>n+0),j.rest);assert.equal(actual.length,j.length);assert.equal(actual.radius,j.radius);near(actual.pivot.getWorldPosition(new T.Vector3()).sub(new T.Vector3(0,.018,0)),new T.Vector3(...j.position),3e-7);});
   for(const sample of r.woodSamples){let actual;m.group.traverse(o=>{if(o.userData.axes?.[0].id===sample.ids[0])actual=o;});assert.ok(actual);for(const[i,...xyz]of sample.vertices)near(point(actual.geometry.attributes.position,i),new T.Vector3(...xyz));}
   if(r.age>=1){
    const primary=m.group.getObjectByName('acer-primary-axis'),p=primary.geometry.attributes.position,sides=primary.geometry.userData.woodTube.sides,segments=primary.geometry.userData.primarySegments.hypocotyl;
    for(const sample of r.trunkVertices)for(let j=0;j<sample.points.length;j++)near(point(p,(segments+sample.ring)*(sides+1)+j).sub(new T.Vector3(0,.018,0)),new T.Vector3(...sample.points[j]),3e-7);
    for(const sample of r.leafSamples){
     if(sample.node.id.startsWith(`leader:leaf:${r.seed*8191}:`)||sample.cohort==='main-axis')continue;
     let leaves,index;m.group.traverse(o=>{if(!o.isInstancedMesh||o.userData.leafClass!=='true-leaf'||o.userData.cohort!==sample.cohort)return;const found=o.userData.nodes.findIndex(n=>n.id===sample.node.id);if(found>=0){leaves=o;index=found;}});assert.ok(leaves);
     const matrix=new T.Matrix4();leaves.getMatrixAt(index,matrix);assert.deepEqual(matrix.toArray().map(n=>n+0),sample.matrix);assert.equal(leaves.userData.nodes[index].birth,sample.node.birth);
    }
   }
  }finally{m.dispose();}
 }
});

test('actual few juvenile blade dimensions retain their millimetre targets with unchanged scales',()=>{
 const sizes=[];
 let previous;
 for(const age of [.12,.2,.5]){
  const birth=.07;
  const m=buildAdditionalPlant('acer',{age,day:180,seed:42,density:1});try{
   let found=0;m.group.traverse(o=>{if(!o.isInstancedMesh||o.userData.leafClass!=='juvenile-true-leaf')return;
    o.geometry.computeBoundingBox();const span=o.geometry.boundingBox.getSize(new T.Vector3());
    for(let i=0;i<o.count;i++)if(o.userData.nodes[i].birth===birth){const matrix=new T.Matrix4();o.getMatrixAt(i,matrix);const scale=new T.Vector3().setFromMatrixScale(matrix),actualLength=span.y*scale.y,actualWidth=span.x*scale.x;
     assert.ok(actualLength>=.005&&actualLength<=.007);assert.ok(actualWidth>=.004&&actualWidth<=.005);sizes.push({age,id:o.userData.nodes[i].id,lengthM:actualLength,widthM:actualWidth});found++;}
   });assert.equal(found,2);
   const current=sizes.slice(-2).map(({id,lengthM,widthM})=>({id,lengthM,widthM}));if(previous)assert.deepEqual(current,previous,'formed pair keeps its original bounded per-instance size variation');previous=current;
  }finally{m.dispose();}
 }
 writeFileSync(artifact('juvenile-sizes.json'),JSON.stringify(sizes,null,2)+'\n');
});

function worldLeafArea(m){let total=0,count=0;const instance=new T.Matrix4();m.group.updateMatrixWorld(true);
 m.group.traverse(o=>{if(!o.isMesh||o.userData.organ!=='leaf'||o.userData.organPart==='petiole'||o.geometry.type==='CylinderGeometry')return;
  const p=o.geometry.attributes.position,ix=o.geometry.index;
  for(let i=0;i<(o.isInstancedMesh?o.count:1);i++){
   if(o.isInstancedMesh)o.getMatrixAt(i,instance);else instance.identity();const transform=o.matrixWorld.clone().multiply(instance);
   for(let j=0;j<(ix?ix.count:p.count);j+=3){const[a,b,c]=[0,1,2].map(k=>point(p,ix?ix.getX(j+k):j+k).applyMatrix4(transform));total+=b.sub(a).cross(c.sub(a)).length()/2;}count++;
  }
 });return{total,count};
}
test('mass and counts use actual transformed new triangles, with bounded compatible leaf/beam dynamics',()=>{
 const records=[];
 for(const expected of baseline){
  const m=buildAdditionalPlant('acer',{age:expected.age,day:180,seed:42,density:1});
  const d=createBeamDynamics(m),wood=createBeamDynamics(m,{leafArealMassKgM2:0}),flex=createLeafDynamics(m.group);
  try{
   const actual=worldLeafArea(m);assert.equal(actual.count,m.leafCount);assert.equal(d.stats.countedLeaves,actual.count);
   assert.ok(Math.abs(d.stats.leafAreaM2-actual.total)<Math.max(1e-12,actual.total*1e-10));
   assert.ok(Math.abs(d.stats.estimatedMassKg-wood.stats.estimatedMassKg-actual.total*.12)<1e-10);
   assert.ok(Math.abs(actual.total-expected.leafAreaM2)>expected.leafAreaM2*.02,'old blade area has not been reused');
   for(let i=0;i<=24;i++){d.update(i/60,12,19.62,.2);flex.update(12,19.62,.2);}
   m.group.updateMatrixWorld(true);m.group.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
   assert.ok(Number.isFinite(d.stats.maxDeflectionRad)&&d.stats.maxDeflectionRad<=.6);
   assert.ok(flex.bladeMeshes>0);assert.equal(flex.unsupportedBlades.length,0);
   records.push({age:expected.age,count:actual.count,oldLeafAreaM2:expected.leafAreaM2,newLeafAreaM2:actual.total,oldMassKg:expected.massKg,newMassKg:d.stats.estimatedMassKg,woodMassKg:wood.stats.estimatedMassKg,maxDeflectionRad:d.stats.maxDeflectionRad});
  }finally{flex.dispose();wood.dispose();d.dispose();m.dispose();}
 }
 writeFileSync(artifact('model-area-mass-comparison.json'),JSON.stringify(records,null,2)+'\n');
});
