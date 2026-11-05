import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {buildAdditionalPlant} from './additional-species.ts';
import {acerShootHeightAt as height,acerShootArrival as arrival,acerAdultHeightAt as adult,acerJuvenileNodeHeight as nodeHeight,acerJuvenileShootPrior as prior} from './acer-juvenile-shoot.ts';
import {acerApicalCohorts} from './acer-apical-cohorts.ts';
import {createBeamDynamics} from './beam-dynamics.ts';
import {woodSections,sectionVolume} from './wood-loads.ts';
const base={day:180,seed:42,density:1};
const build=(age,day=180)=>buildAdditionalPlant('acer',{...base,age,day});
const vertex=(p,i)=>new T.Vector3().fromBufferAttribute(p,i);
function tip(model){const g=model.group.getObjectByName('acer-primary-axis').geometry,{segments,sides}=g.userData.woodTube;
 return Array.from({length:sides},(_,j)=>vertex(g.attributes.position,segments*(sides+1)+j)).reduce((a,b)=>a.add(b),new T.Vector3()).divideScalar(sides);}
function blades(model){const result=[];model.group.updateMatrixWorld(true);
 model.group.traverse(o=>{if(!o.isInstancedMesh||o.userData.organ!=='leaf')return;
  const stalk=o.parent.children.find(p=>p.isInstancedMesh&&p.userData.organ==='petiole');
  o.geometry.computeBoundingBox();const span=o.geometry.boundingBox.getSize(new T.Vector3());
  for(let i=0;i<o.count;i++){const b=new T.Matrix4(),p=new T.Matrix4();o.getMatrixAt(i,b);stalk.getMatrixAt(i,p);
   result.push({node:o.userData.nodes[i],kind:o.userData.leafClass,
    length:span.y*new T.Vector3().setFromMatrixScale(b).y,
    start:new T.Vector3(0,-.5,0).applyMatrix4(p).applyMatrix4(stalk.matrixWorld),
    end:new T.Vector3(0,.5,0).applyMatrix4(p).applyMatrix4(stalk.matrixWorld),
    blade:new T.Vector3().applyMatrix4(b).applyMatrix4(o.matrixWorld)});
  }
 });return result;
}
test('bounded juvenile target sum is monotone, C1 at each clock/join and has an actual arrival inverse',()=>{
 let previous=0;
 for(let i=0;i<=2000;i++){const age=i/2000,h=height(age);assert.ok(h>=previous-1e-14);previous=h;
  if(h>0)assert.ok(Math.abs(height(arrival(h))-h)<1e-13,'inverse reaches actual height including early establishment');
 }
 for(const age of [.025,.07,.115,.16,.205,.25,.295,.6]){
  const e=1e-6,left=(height(age)-height(age-e))/e,right=(height(age+e)-height(age))/e;
  assert.ok(Math.abs(left-right)<.001,`matching height velocity at ${age}`);
  assert.ok(Math.abs(height(age-e)-height(age+e))<3e-6);
 }
 for(const age of [.6,1,18,80])assert.equal(height(age),adult(age),'exact old adult law after bounded juvenile end');
 prior.leafBirthsYears.forEach((birth,i)=>{
  assert.ok(Math.abs(height(birth)-nodeHeight(i))<1e-14);
  assert.ok(height(birth-1e-4)<nodeHeight(i));
  assert.ok(Math.abs(arrival(nodeHeight(i))-birth)<1e-8);
 });
 // Old inverse omitted organGrowth: this target actually needs ~.07y.
 assert.ok(arrival(.006)>.0699);
});

test('few-stage actual upper gaps follow declared centimetre targets and blade expansion stays independent',()=>{
 for(const [age,expectedHeight,expectedGap,pairs] of [[.12,.03341152263374485,.00041152263374485,2],[.2,.05948559670781893,.01448559670781893,3],[.3,.09912501559418989,.00012501559418989,6]]){
  const m=build(age);try{
   const leaves=blades(m).filter(l=>l.kind==='juvenile-true-leaf'),end=tip(m),top=Math.max(...leaves.map(l=>l.start.y));
   assert.equal(leaves.length,2*pairs);assert.ok(Math.abs(end.y-expectedHeight)<3e-7,`actual wood tip at ${age}`);
   assert.ok(Math.abs(end.y-top-expectedGap)<3e-7,`actual upper internode gap at ${age}`);
   for(const l of leaves){assert.ok(l.start.y<=end.y+3e-8);assert.ok(l.end.distanceTo(l.blade)<3e-8);}
   const lengths=leaves.filter(l=>l.start.y>=top-1e-7).map(l=>l.length);
   if(age===.2)assert.ok(end.y-top<Math.max(...lengths)*1.25,'gap stays within the chosen 15mm segment while upper 14mm target blades unfold; engineering proportion gate, not a photo calibration');
   const first=leaves.filter(l=>l.node.birth===.07);assert.ok(first.every(l=>l.length>=.005&&l.length<=.007),'retain NBU stage phenotype, not a final species size maximum');
  }finally{m.dispose();}
 }
});

test('formed sites stay fixed across every new clock, retirement and dormancy; leaf births wait for untruncated support',()=>{
 let catalogue,formed=new Map();
 for(const age of [.070001,.115001,.160001,.205001,.250001,.295001,.45,.5,.599999,.600001,.7,.800001,1,3]){
  const m=build(age);try{
   const sites=m.group.userData.juvenileTrueLeaves.sites;
   if(catalogue)assert.deepEqual(sites,catalogue);else catalogue=sites;
   const end=tip(m),all=blades(m);
   for(const l of all){const old=formed.get(l.node.id);if(old)assert.ok(l.start.distanceTo(old)<3e-7,'already formed node cannot move');formed.set(l.node.id,l.start);
    assert.ok(l.node.birth<=age);assert.ok(l.start.y<=end.y+3e-8,'visible leaf has real parent support');
   }
   if(age>=.81){const frame=m.group.getObjectByName('acer-epicotyl-reference');
    for(const s of sites)for(const side of [0,1])assert.ok(new T.Vector3(...s.attachment).applyMatrix4(frame.matrixWorld).distanceTo(formed.get(`${s.id}:${side}`))<3e-7);
   }
  }finally{m.dispose();}
 }
 const winter=build(1,15);try{assert.equal(winter.leafCount,0);assert.deepEqual(winter.group.userData.juvenileTrueLeaves.sites,catalogue);}finally{winter.dispose();}
 // Later leaf retains its original material site and waits until the new
 // parent reaches it; we do not clamp the anchor to an unsupported leader tip.
 const m=build(.51);try{const later=blades(m).filter(l=>l.kind==='true-leaf');assert.ok(later.length>2);
  for(const l of later){const catalogue=acerApicalCohorts(),site=catalogue.find(s=>Math.abs(s.birth-l.node.birth)<1e-12);assert.ok(site);assert.ok(Math.abs(height(l.node.birth)-site.heightM)<1e-13);}
 }finally{m.dispose();}
});

test('actual triangle area, rendered counts, leaf mass, dormant catalogue and resource budgets agree',()=>{
 for(const [age,day] of [[.12,180],[.2,180],[.5,180],[.81,180],[1,15]]){
  const m=build(age,day),d=createBeamDynamics(m);try{
   let area=0,count=0,woodVolume=0,draws=0,vertices=0;
   m.group.traverse(o=>{if(!o.isMesh)return;draws++;vertices+=o.geometry.attributes.position.count;
    if(!o.isInstancedMesh&&o.userData.organ!=='seed')for(const s of woodSections(o.geometry))woodVolume+=sectionVolume(s)*Math.abs(o.matrixWorld.determinant());
    if(!o.isInstancedMesh||o.userData.organ!=='leaf')return;count+=o.count;
    const p=o.geometry.attributes.position,ix=o.geometry.index;
    for(let i=0;i<o.count;i++){const local=new T.Matrix4();o.getMatrixAt(i,local);const frame=o.matrixWorld.clone().multiply(local);
     for(let j=0;j<(ix?.count??p.count);j+=3){const [a,b,c]=[0,1,2].map(k=>vertex(p,ix?ix.getX(j+k):j+k).applyMatrix4(frame));area+=b.sub(a).cross(c.sub(a)).length()/2;}
    }
   });
   assert.equal(count,m.leafCount);assert.equal(count,d.stats.countedLeaves);
   assert.ok(Math.abs(area-d.stats.leafAreaM2)<1e-12);
   assert.ok(Math.abs(woodVolume*550+area*.12-d.stats.estimatedMassKg)<1e-10);
   assert.ok(draws<=41&&vertices<180000,'existing budget including the already approved single bud');
   assert.equal(m.group.userData.juvenileTrueLeaves.sites.length,6);
  }finally{d.dispose();m.dispose();}
 }
});
