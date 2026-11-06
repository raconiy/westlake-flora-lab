import {acerShootHeightAt,acerAdultHeightAt} from './acer-juvenile-shoot.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {buildAdditionalPlant} from './additional-species.ts';
import {acerHypocotylState, acerCotyledonState, acerEstablishmentPriors as prior, woodyEstablishmentEvidence} from './woody-establishment.ts';
import {woodSections,sectionVolume,sectionProjectedArea} from './wood-loads.ts';
import {createBeamDynamics} from './beam-dynamics.ts';
import {rootCollarBridge} from './root-collar-bridge.ts';
import {buildRhizosphere} from './rhizosphere.ts';
import {geometryHeight} from './geometry-height.ts';

const ages=[0,.025,.04,.055,.07,.083,.12,.2,.5,1,18],base={day:180,seed:42,density:1};
const vec=(p,i)=>new THREE.Vector3().fromBufferAttribute(p,i),up=new THREE.Vector3(0,1,0);
const near=(a,b,tol=3e-8)=>assert.ok(a.distanceTo(b)<tol,`${a.toArray()} meets ${b.toArray()}`);
const primary=m=>m.group.getObjectByName('acer-primary-axis');
function ring(mesh,i){const p=mesh.geometry.attributes.position,n=mesh.geometry.userData.woodTube.sides;
 return Array.from({length:n},(_,j)=>vec(p,i*(n+1)+j));}
function centre(mesh,i){const points=ring(mesh,i);return points.reduce((a,b)=>a.add(b),new THREE.Vector3()).divideScalar(points.length);}
function lineDistance(point,line){let d=Infinity;for(let i=1;i<line.length;i++)d=Math.min(d,point.distanceTo(new THREE.Line3(line[i-1],line[i]).closestPointToPoint(point,true,new THREE.Vector3())));return d;}
function instances(m,leafClass){const records=[];m.group.updateMatrixWorld(true);
 m.group.traverse(o=>{if(!o.isInstancedMesh||!(o.userData.leafClass===leafClass||(leafClass==='true-leaf'&&o.userData.leafClass==='juvenile-true-leaf')))return;
  const petiole=o.parent.children.find(s=>s.isInstancedMesh&&s.userData.organ==='petiole');assert.ok(petiole);assert.equal(petiole.count,o.count);
  for(let i=0;i<o.count;i++){
   const bm=new THREE.Matrix4(),pm=new THREE.Matrix4();o.getMatrixAt(i,bm);petiole.getMatrixAt(i,pm);
   const bladeMatrix=o.matrixWorld.clone().multiply(bm),petioleMatrix=petiole.matrixWorld.clone().multiply(pm),
    start=new THREE.Vector3(0,-.5,0).applyMatrix4(petioleMatrix),tip=new THREE.Vector3(0,.5,0).applyMatrix4(petioleMatrix),
    bladeBase=new THREE.Vector3().applyMatrix4(bladeMatrix);
   near(tip,bladeBase,3e-8);
   // Actual cylinder cap and actual blade base vertices, not metadata labels.
   const pv=petiole.geometry.attributes.position,bv=o.geometry.attributes.position;
   assert.ok(Array.from({length:pv.count},(_,j)=>vec(pv,j).applyMatrix4(petioleMatrix).distanceTo(tip)).some(d=>d<3e-8));
   assert.ok(Array.from({length:bv.count},(_,j)=>vec(bv,j).applyMatrix4(bladeMatrix).distanceTo(bladeBase)).some(d=>d<3e-8));
   records.push({mesh:o,start,tip,bladeBase,bladeMatrix,node:o.userData.nodes[i]});
  }
 });return records;
}
function meshStats(m){let draws=0,vertices=0;m.group.traverse(o=>{if(o.isMesh){draws++;vertices+=o.geometry.attributes.position.count;}});return{draws,vertices};}

test('Acer actual primary geometry lifts the cotyledon node by immature strain, then retains its full added length',()=>{
 for(const seed of [42,73]){
  let previousHeight=0,previousLength=0,previousNode=0,matureCentres;
  for(const age of ages){const m=buildAdditionalPlant('acer',{...base,seed,age});try{
   assert.equal(m.height,geometryHeight(m.group));assert.ok(m.height+3e-8>=previousHeight);previousHeight=m.height;
   if(age<=.025){assert.equal(primary(m),undefined);assert.equal(m.leafCount,0);continue;}
   const mesh=primary(m),hypo=acerHypocotylState(age),segments=prior.hypocotylSegments,
    node=centre(mesh,segments),end=centre(mesh,segments+24),joint=m.branches[0];
   near(centre(mesh,0),new THREE.Vector3(),1e-10);near(node,hypo.node);
   assert.ok(ring(mesh,0).every(p=>p.y===0),'real basal bark ring lies at soil 0');
   assert.ok(node.y+3e-8>=previousNode);previousNode=node.y;
   if(age>=.07)assert.ok(end.y>node.y,'established epicotyl grows above the hypocotyl endpoint');
   else {const q=m.group.getObjectByName('acer-epicotyl-reference').quaternion.clone().invert();
    assert.ok(end.clone().sub(node).applyQuaternion(q).y>0,'immature epicotyl extends in its transported material frame');}
   const sections=woodSections(mesh.geometry),length=sections.reduce((n,s)=>n+new THREE.Vector3(...s.a).distanceTo(new THREE.Vector3(...s.b)),0);
   assert.ok(Math.abs(joint.length-length)<1e-12,'joint length accounts for both actual segments');
   assert.ok(length+3e-8>=previousLength,'no age-driven primary-axis retraction');previousLength=length;
   for(const p of ring(mesh,0))assert.ok(Math.abs(p.length()-joint.radius*1.4)<3e-8,'basal radius follows the existing explicit 1.4x nominal-radius convention');
   near(m.group.getObjectByName('acer-epicotyl-reference').position,node);
   if(age>=.07){near(node,new THREE.Vector3(0,.018,0));assert.equal(hypo.node.y,.018);
    const centres=Array.from({length:segments+1},(_,i)=>centre(mesh,i));
    if(!matureCentres)matureCentres=centres;else centres.forEach((c,i)=>near(c,matureCentres[i],3e-8));
    assert.deepEqual(m.group.getObjectByName('acer-epicotyl-reference').quaternion.toArray().map(n=>n+0),[0,0,0,1]);
   }
  }finally{m.dispose();}}
 }
 // Sample the primary-growth interval itself, rather than asserting that
 // immature tissues obey the old fixed-world-node rule for mature wood.
 let last=0;for(let i=0;i<=90;i++){const s=acerHypocotylState(.025+i*.0005);assert.ok(s.length+1e-10>=last);last=s.length;}
});

test('actual opposite unlobed cotyledons ride the common node and true leaves originate above it, including loaded poses',()=>{
 for(const [seed,age] of [[42,.04],[42,.055],[73,.06],[42,.07],[73,.083],[42,.12],[73,.2]]){
  const m=buildAdditionalPlant('acer',{...base,seed,age});const dynamics=createBeamDynamics(m);try{
   for(const loaded of [false,true]){
    if(loaded)for(let i=0;i<=24;i++)dynamics.update(i/60,12,19.62,.2);
    m.group.updateMatrixWorld(true);
    const mesh=primary(m),node=centre(mesh,prior.hypocotylSegments).applyMatrix4(mesh.matrixWorld),
     cots=instances(m,'cotyledon'),leaves=instances(m,'true-leaf'),
     epicLine=Array.from({length:25},(_,i)=>centre(mesh,i+prior.hypocotylSegments).applyMatrix4(mesh.matrixWorld));
    assert.equal(cots.length,age>.04?2:0);assert.equal(dynamics.stats.countedLeaves,m.leafCount);
    if(age<=.07)assert.equal(leaves.length,0);else assert.ok(leaves.length>=2);
    for(const c of cots){near(c.start,node);assert.equal(c.mesh.geometry.attributes.position.count,34);
     assert.equal(c.mesh.userData.outline,'unlobed-ovate');assert.equal(c.node.birth,.04);
     assert.ok(c.start.y>.008,'no legacy leaf-within-8mm-of-soil loophole');}
    if(cots.length){const q=cots[0].mesh.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),directions=cots.map(c=>c.tip.clone().sub(c.start).applyQuaternion(q));assert.ok(directions[0].x*directions[1].x<0,'opposite, diverging petioles');}
    for(const leaf of leaves){assert.ok(leaf.node.birth>=.07);assert.ok(leaf.start.y>node.y,'true-leaf material node above cotyledons');
     assert.ok(leaf.start.y>.008,'true leaves cannot pass via the legacy 8mm ground-contact loophole');
     assert.ok(lineDistance(leaf.start,epicLine)<2e-5,'actual true-leaf node on rendered epicotyl, including under wind');
     assert.ok(leaf.mesh.geometry.attributes.position.count>60,'true blade has lobes, distinct from ovate cotyledons');}
    if(leaves.length>=2)near(leaves[0].start,leaves[1].start);
   }
  }finally{dynamics.dispose();m.dispose();}
 }
});

test('actual cotyledon unfolding, colour and surface shrink gradually while persistent wood remains',()=>{
 const records=[];
 for(const age of [.055,.083,.105,.14,.2,.3,.359999]){
  const m=buildAdditionalPlant('acer',{...base,age});try{
   const cots=instances(m,'cotyledon'),mesh=cots[0].mesh,g=mesh.geometry,p=g.attributes.position,ix=g.index;
   let area=0;for(const c of cots)for(let i=0;i<ix.count;i+=3){const [a,b,d]=[0,1,2].map(j=>vec(p,ix.getX(i+j)).applyMatrix4(c.bladeMatrix));area+=b.sub(a).cross(d.sub(a)).length()/2;}
   const direction=cots[0].tip.clone().sub(cots[0].start).normalize();
   records.push({age,area,spread:Math.abs(direction.x),red:mesh.material.color.r,green:mesh.material.color.g});
   assert.equal(cots.length,2);assert.ok(area>0);assert.ok(primary(m));
  }finally{m.dispose();}
 }
 assert.ok(records[0].spread<records[1].spread&&records[1].spread<records[2].spread);
 assert.ok(Math.abs(records[2].area-records[3].area)<1e-12,'fully unfolded area persists through the two-leaved stage');
 assert.ok(records[2].green>records[2].red);assert.ok(records[5].red>records[5].green);
 assert.ok(records[4].area<records[3].area&&records[5].area<records[4].area);
 assert.ok(records[6].area<1e-20,'actual blade area tends to zero before explicit removal');
});

test('hook, lifting, unfolding, supported apical bud and organ births are continuous, with no wood or coat removal',()=>{
 for(const age of [.012,.025,.04,.045,.055,.07,.083,.105,.115,.12,.14,.2,.3,.36,.5]){
  const a=buildAdditionalPlant('acer',{...base,age:age-1e-7}),b=buildAdditionalPlant('acer',{...base,age:age+1e-7});try{
   const ba=new THREE.Box3().setFromObject(a.group),bb=new THREE.Box3().setFromObject(b.group);
   assert.ok(ba.min.distanceTo(bb.min)<1e-5&&ba.max.distanceTo(bb.max)<1e-5,`actual bounds at ${age}`);
   assert.ok(Math.abs(a.height-b.height)<1e-5);
   const ca=a.group.getObjectByName('woody-seed-establishment'),cb=b.group.getObjectByName('woody-seed-establishment'),
    ra=ca.userData.organs.find(o=>o.organ==='seed-coat'),rb=cb.userData.organs.find(o=>o.organ==='seed-coat');
   assert.deepEqual(Array.from(ca.geometry.attributes.position.array.slice(ra.start*3,(ra.start+ra.count)*3)),Array.from(cb.geometry.attributes.position.array.slice(rb.start*3,(rb.start+rb.count)*3)));
  }finally{a.dispose();b.dispose();}
 }
 for(const age of [.04,.055,.07,.083,.12]){const m=buildAdditionalPlant('acer',{...base,age});try{
  const mesh=primary(m),bud=m.group.getObjectByName('acer-apical-bud');assert.ok(bud);
  near(bud.getWorldPosition(new THREE.Vector3()),centre(mesh,prior.hypocotylSegments+24).applyMatrix4(mesh.matrixWorld));
  if(age===.04){const s=acerHypocotylState(age);assert.ok(s.curve.getTangent(1).y<0,'real distal hook bends downward');}
 }finally{m.dispose();}}
 assert.equal(acerCotyledonState(.12).senescence,0,'green through first two-leaved stage');
 assert.ok(acerCotyledonState(.359999).scale<1e-9,'no finite organ disappears at abscission');
 for(const age of [.36,.5,1,18]){const m=buildAdditionalPlant('acer',{...base,age});try{assert.equal(instances(m,'cotyledon').length,0);assert.ok(primary(m));}finally{m.dispose();}}
});

test('soil-zero basal ring, buried radicle and root-collar bridge stay connected through primary strain and wind',()=>{
 for(const [seed,age] of [[42,.04],[73,.055],[42,.07],[73,.083],[42,.2],[73,1],[42,18]]){
  const m=buildAdditionalPlant('acer',{...base,seed,age}),joint=m.branches[0],roots=buildRhizosphere('acer',{
   age,seed,moisture:.62,compaction:.25,soilDepth:.1,cutaway:true,shootCollar:{position:joint.pivot.position.toArray(),radius:joint.radius*1.4}}),
   dynamics=createBeamDynamics(m),bridge=rootCollarBridge(m,roots);
  try{assert.ok(bridge);const collar=roots.group.getObjectByName('root-shoot-junction'),p=collar.geometry.attributes.position,
    original=p.array.slice(),n=collar.geometry.parameters.radialSegments,
    root=roots.group.children.find(o=>o.userData.axisId==='acer:root:primary'),rp=root.geometry.attributes.position,
    radicle=Array.from({length:root.userData.ringSides},(_,i)=>vec(rp,i)).reduce((a,b)=>a.add(b),new THREE.Vector3()).divideScalar(root.userData.ringSides);
   near(radicle,new THREE.Vector3(0,-.009,0));
   for(const [wind,gravity] of [[0,0],[12,19.62],[0,0]]){
    for(let i=0;i<=24;i++){dynamics.update(i/60,wind,gravity,.2);bridge.update();}
    m.group.updateMatrixWorld(true);roots.group.updateMatrixWorld(true);
    near(joint.pivot.getWorldPosition(new THREE.Vector3()),new THREE.Vector3(),1e-10);
    const top=Array.from({length:n},(_,i)=>vec(p,i).applyMatrix4(collar.matrixWorld));
    for(const v of ring(primary(m),0)){v.applyMatrix4(primary(m).matrixWorld);assert.ok(top.some(t=>t.distanceTo(v)<3e-7),'every real basal bark corner welded');}
    for(let i=0;i<p.count;i++)if(Math.abs(original[i*3+1]-collar.userData.bottomY)<1e-7)assert.deepEqual([p.getX(i),p.getY(i),p.getZ(i)],Array.from(original.slice(i*3,i*3+3)));
   }
  }finally{dynamics.dispose();m.dispose();roots.dispose();}
 }
});

test('all actual aboveground wood, including persistent hypocotyl, feeds mass and drag exactly once; cotyledons count separately',()=>{
 const wind=new THREE.Vector3(1,0,.2).normalize(),air=1.225,cd=.8,speed=2;
 for(const age of [.055,.083,.2,.5,18]){const m=buildAdditionalPlant('acer',{...base,age});
  const options={leafArealMassKgM2:0,reconfigurationSpeedMS:Infinity},d=createBeamDynamics(m,options);try{
   let volume=0,area=0,segments=0;m.group.updateMatrixWorld(true);
   m.group.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||o.userData.organ==='seed')return;
    for(const s of woodSections(o.geometry)){volume+=sectionVolume(s)*Math.abs(o.matrixWorld.determinant());area+=sectionProjectedArea(s,o.matrixWorld,wind);segments++;}
   });
   assert.equal(d.stats.resolvedWoodSegments,segments);assert.ok(Math.abs(d.stats.estimatedMassKg-volume*550)<1e-9);
   assert.equal(d.stats.countedLeaves,m.leafCount);
   d.update(0,speed,0,1);
   // Re-evaluate a leafless view of the SAME wood to isolate exact drag. No
   // rendered geometry, owner or wood section may be removed for this audit.
   const leaves=[];m.group.traverse(o=>{if(o.isMesh&&o.userData.organ==='leaf'){leaves.push(o);o.userData.organ='audit-excluded-leaf';}});
   const woodOnly=createBeamDynamics(m,options);try{woodOnly.update(0,speed,0,1);
    assert.ok(Math.abs(woodOnly.stats.windForceN-.5*air*cd*speed**2*area)<1e-10);
    assert.ok(Math.abs(woodOnly.stats.estimatedMassKg-volume*550)<1e-9);
   }finally{woodOnly.dispose();leaves.forEach(o=>o.userData.organ='leaf');}
   assert.equal(woodSections(primary(m).geometry).length,prior.hypocotylSegments+24,'resolved hypocotyl + original24 epicotyl sections, no duplicate proxy');
  }finally{d.dispose();m.dispose();}
 }
});

test('established crown preserves independent aligned material references and adds actual permanent height, not the rejected absolute hash',()=>{
 // Independently captured CLEAN CURRENT MAIN (90ed981), before the port.
 // Compare crown material sites after subtracting the explicit permanent
 // segment; the soil-zero base and the added geometry are checked separately.
 const reference=JSON.parse(readFileSync(new URL('./acer-establishment-reference.json',import.meta.url)));
 assert.match(reference.source,/90ed981 clean main/);
 for(const r of reference.records){const m=buildAdditionalPlant('acer',{...base,age:r.age,seed:r.seed});try{
  const mesh=primary(m),offset=new THREE.Vector3(0,.018,0),crown=m.group.getObjectByName('acer-epicotyl-reference');
  const oldLaterCount=2*Array.from({length:72},(_,c)=>.45+c*.28+c*c*.018).filter(b=>r.age>b).length,
   newLaterCount=m.group.getObjectByName('leaf-cohort:main-axis')?.children.find(o=>o.userData.leafClass==='true-leaf')?.count??0;
  assert.equal(m.leafCount,r.trueLeaves-oldLaterCount+newLaterCount,'only declared establishment retirement and revised leader leaf catalogue change counts; all lateral foliage remains');assert.equal(m.group.getObjectByName('acer-cotyledons'),undefined);
  // Historical wood/leaf extents remain unchanged; the persistent bud adds
  // a separate organ extent and must not overwrite the reference snapshot.
  const withoutBud=m.group.clone(true);withoutBud.getObjectByName('acer-apical-bud')?.removeFromParent();withoutBud.getObjectByName('leaf-cohort:main-axis')?.removeFromParent();
  const originalExtent=geometryHeight(withoutBud),bud=m.group.getObjectByName('acer-apical-bud');
  // Total leaf-dependent extent intentionally changes with the new curved
  // blade silhouette. Historical wood/material references below remain exact.
  if(r.age>=1)assert.ok(Math.abs(centre(mesh,prior.hypocotylSegments+24).y-(acerAdultHeightAt(r.age)+.018))<3e-7,'adult wood-tip law and persistent 18mm segment are unchanged');
  else {
   assert.equal(r.age,.5,'only the historical juvenile snapshot changes');
   assert.ok(centre(mesh,prior.hypocotylSegments+24).y<r.height+.018-.02,'intended juvenile wood trajectory changes at .5y; leaf shape does not redefine this historical reference');
   assert.ok(Math.abs(centre(mesh,prior.hypocotylSegments+24).y-(.018+acerShootHeightAt(.5)))<3e-8);
   const line=Array.from({length:25},(_,i)=>centre(mesh,prior.hypocotylSegments+i).sub(offset));
   for(const sample of r.trunkVertices){
    const c=sample.points.reduce((v,p)=>v.add(new THREE.Vector3(...p)),new THREE.Vector3()).divideScalar(sample.points.length);
    if(c.y>acerShootHeightAt(.5))continue;
    assert.ok(lineDistance(c,line)<3e-6,'common old wood material centreline stays fixed despite different tessellation of the longer prefix');
   }
  }
  let budExtent=0;for(let i=0;i<bud.geometry.attributes.position.count;i++)budExtent=Math.max(budExtent,vec(bud.geometry.attributes.position,i).applyMatrix4(bud.matrixWorld).y);
  assert.ok(m.height>=Math.max(originalExtent,budExtent)-1e-12,'reported height includes old crown, terminal bud and the deliberately revised main-axis foliage');assert.equal(m.height,geometryHeight(m.group));near(centre(mesh,0),new THREE.Vector3(),1e-10);
  if(r.age>=1)for(const sample of r.trunkVertices){for(let j=0;j<sample.points.length;j++)near(ring(mesh,prior.hypocotylSegments+sample.ring)[j].sub(offset),new THREE.Vector3(...sample.points[j]),3e-7);}
  assert.equal(m.branches.length-1,r.joints.length);
  r.joints.forEach((j,i)=>{const actual=m.branches[i+1];near(actual.pivot.position,new THREE.Vector3(...j.position),1e-12);assert.deepEqual(actual.rest.toArray().map(n=>n+0),j.rest);assert.equal(actual.length,j.length);assert.equal(actual.radius,j.radius);
   near(actual.pivot.getWorldPosition(new THREE.Vector3()).sub(offset),new THREE.Vector3(...j.position),3e-7);});
  for(const sample of r.leafSamples){
   const initialSite=sample.node.id.startsWith(`leader:leaf:${r.seed*8191}:`);
   if(initialSite){
    const catalogue=m.group.userData.juvenileTrueLeaves;
    assert.ok(catalogue.sites.some(s=>sample.node.id.startsWith(s.id+':')),'retired or resized blade retains its woody site identity');
    // This deliberately revised lineage now has independent apex/size/event
    // assertions in acer-juvenile-leaves.test.mjs; do not refresh old references.
    continue;
   }
   if(sample.cohort==='main-axis')continue; // Explicitly revised material-node catalogue has separate arrival, persistence and load tests; historical reference JSON remains untouched.
   if(r.age<1)continue;
   let leaves,index;m.group.traverse(o=>{if(!o.isInstancedMesh||o.userData.leafClass!=='true-leaf'||o.userData.cohort!==sample.cohort)return;const found=o.userData.nodes.findIndex(n=>n.id===sample.node.id);if(found>=0){leaves=o;index=found;}});assert.ok(leaves);
   const matrix=new THREE.Matrix4();leaves.getMatrixAt(index,matrix);assert.deepEqual(matrix.toArray().map(n=>n+0),sample.matrix);assert.equal(leaves.userData.nodes[index].id,sample.node.id);assert.equal(leaves.userData.nodes[index].birth,sample.node.birth);
   assert.ok(leaves.parent===crown||leaves.parent.parent===crown);
  }
  for(const sample of r.woodSamples){let actual;m.group.traverse(o=>{if(o.userData.axes?.[0].id===sample.ids[0])actual=o;});assert.ok(actual);for(const [i,...xyz] of sample.vertices)near(vec(actual.geometry.attributes.position,i),new THREE.Vector3(...xyz),1e-12);}
  const budget=meshStats(m);assert.ok(budget.draws<=43);assert.ok(budget.vertices<180000);
 }finally{m.dispose();}}
 assert.equal(prior.calibrated,false);assert.match(woodyEstablishmentEvidence.acer.verification,/Plate 6.1.m/);
 assert.match(woodyEstablishmentEvidence.acer.unsupported,/coat/);
});

test('cotyledon state ignores density and keeps the original draw/resource budgets with at most three temporary meshes',()=>{
 for(const [seed,age] of [[42,.055],[73,.083],[42,.12],[73,.2]]){
  const original=buildAdditionalPlant('acer',{...base,age,seed}),other=buildAdditionalPlant('acer',{...base,age,seed,density:2});try{
   const a=original.group.getObjectByName('acer-cotyledons'),b=other.group.getObjectByName('acer-cotyledons');
   assert.deepEqual(Array.from(a.instanceMatrix.array),Array.from(b.instanceMatrix.array));assert.deepEqual(Array.from(a.geometry.attributes.position.array),Array.from(b.geometry.attributes.position.array));
   assert.equal(instances(other,'cotyledon').length,2,'cotyledon pair does not multiply with crown density');
   let temporaryMeshes=0,temporaryVertices=0;original.group.traverse(o=>{if(o.isMesh&&(o.name.startsWith('acer-cotyledon')||o.name==='acer-apical-bud')){temporaryMeshes++;temporaryVertices+=o.geometry.attributes.position.count;}});
   assert.ok(temporaryMeshes<=prior.extraMeshBudget);assert.ok(temporaryVertices<=prior.extraVertexBudget);
   const stats=meshStats(original);assert.ok(stats.draws<=41);assert.ok(stats.vertices<180000);
   assert.ok(primary(original).material.bumpScale<=original.branches[0].radius*.08);
  }finally{original.dispose();other.dispose();}
 }
});

test('one finite cotyledon cohort respects a separate seasonal feasibility prior without changing scaffold or hiding rendered leaf counts',()=>{
 const days=[1,15,65,80,95,180,255,280,300,344,365];
 for(const age of [.055,.1,.2,.36,.5,3,18,80]){
  let scaffold;
  for(const day of days){
   const m=buildAdditionalPlant('acer',{...base,age,day}),d=createBeamDynamics(m);try{
    const wood=[];m.group.updateMatrixWorld(true);let renderedLeaves=0;
    m.group.traverse(o=>{
     if(!o.isMesh)return;
     if(o.isInstancedMesh&&o.userData.organ==='leaf')renderedLeaves+=o.count;
     if(!o.isInstancedMesh&&woodSections(o.geometry).length)wood.push([Array.from(o.geometry.attributes.position.array),o.matrixWorld.toArray()]);
    });
    if(!scaffold)scaffold=wood;else assert.deepEqual(wood,scaffold,'actual wood vertices and world transforms persist across days');
    const cots=instances(m,'cotyledon'),state=acerCotyledonState(age,day),expected=state.scale>0?2:0;
    assert.equal(cots.length,expected);assert.equal(m.leafCount,renderedLeaves);assert.equal(d.stats.countedLeaves,renderedLeaves);
    if(day<=65||day>=300||age>=.36){assert.equal(cots.length,0);assert.equal(m.group.getObjectByName('acer-cotyledon-petioles'),undefined);}
    if(day===15){assert.equal(m.leafCount,0);assert.equal(renderedLeaves,0);}
    if(age===.1&&day===180){assert.equal(cots.length,2);assert.ok(instances(m,'true-leaf').length>0);}
    assert.equal(state.ageSenescence,acerCotyledonState(age).ageSenescence,'annual day never resets age-driven lifespan');
   }finally{d.dispose();m.dispose();}
  }
 }
 assert.ok(acerCotyledonState(.1,280).senescence>acerCotyledonState(.1,180).senescence);
 for(const day of [65,95,255,300]){
  const a=buildAdditionalPlant('acer',{...base,age:.1,day:day-1e-5}),b=buildAdditionalPlant('acer',{...base,age:.1,day:day+1e-5});try{
   const ba=new THREE.Box3().setFromObject(a.group),bb=new THREE.Box3().setFromObject(b.group);
   assert.ok(ba.min.distanceTo(bb.min)<1e-5&&ba.max.distanceTo(bb.max)<1e-5,'seasonal cotyledon geometry tends continuously to zero');
  }finally{a.dispose();b.dispose();}
 }
});

test('actual primary triangles do not intersect and transported junction normals, rings and UV units are coherent',async()=>{
 const {inspectPrimary,trianglesIntersect}=await import('./acer-junction-test-utils.mjs');
 const v=(x,y,z)=>new THREE.Vector3(x,y,z);
 assert.ok(trianglesIntersect([v(-1,0,0),v(1,0,0),v(0,1,0)],[v(0,.2,-1),v(0,.2,1),v(0,-1,0)]),'probe detects crossing triangles');
 assert.ok(trianglesIntersect([v(0,0,0),v(2,0,0),v(1,2,0)],[v(.4,.1,0),v(1.8,.1,0),v(1,1,0)]),'probe detects coplanar interiors');
 for(const [age,seed] of [[.025,42],[.04,42],[.055,42],[.07,42],[.083,73],[.12,42],[1,73],[18,42]]){
  const m=buildAdditionalPlant('acer',{...base,age,seed});try{
   if(age===.025){assert.equal(primary(m),undefined);continue;}
   const a=inspectPrimary(primary(m));
   assert.equal(a.nonsharedIntersectionPairs,0,JSON.stringify({age,seed,...a}));assert.equal(a.crossTissueIntersectionPairs,0);
   assert.equal(a.junctionSharedVertexCount,11);
   assert.equal(a.finite,true);assert.ok(a.minNormalLength>.999999&&a.maxNormalLength<1.000001);
   assert.ok(a.minFaceRadialDot>0,'all triangle winding points outward');assert.ok(a.minTriangleArea>0);
   assert.ok(a.junctionChordAngleDeg<9,'finite mesh chord tangent agrees across joint');
   assert.ok(a.junctionRingToEpicotylChordDeg<.2,'actual common ring is perpendicular to departing epicotyl');
   assert.ok(a.maxAdjacentNormalAngleDeg<40,'no flipped normals around hooked joint');assert.ok(a.maxAngularSeamNormalAngleDeg<1e-5);
   assert.equal(a.rootCollarMaxAbsY,0);assert.ok(a.seamURanges.every(x=>Math.abs(x-a.seamURanges[0])<1e-9));
  }finally{m.dispose();}
 }
});
