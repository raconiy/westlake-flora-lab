import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBeamDynamics } from './beam-dynamics.ts';
import { buildPlant } from './plant-engine.ts';

function fixture(direction=new THREE.Vector3(0,1,0),radius=.008){
 const group=new THREE.Group(),pivot=new THREE.Group();pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);group.add(pivot);
 const joint={pivot,rest:pivot.quaternion.clone(),length:1,radius,order:0,phase:0,flexibility:1,sag:0};
 const model={group,branches:[joint],leafCount:0,height:1,update(){},dispose(){}};return{model,joint};
}
function advance(dynamics,from,to,wind,gravity,stiffness=1,h=1/120){for(let t=from;t<to-1e-10;t+=h)dynamics.update(t,wind,gravity,stiffness);dynamics.update(to,wind,gravity,stiffness);}
const up=new THREE.Vector3(0,1,0);

test('drag follows wind-speed squared in the fixed-area limit and changes sign with wind direction',()=>{
 const{model,joint}=fixture();const dynamics=createBeamDynamics(model,{windDirection:new THREE.Vector3(1,0,0),reconfigurationSpeedMS:Infinity});
 dynamics.update(0,2,0,1);const f2=dynamics.stats.windForceN;dynamics.update(0,4,0,1);assert.ok(Math.abs(dynamics.stats.windForceN/f2-4)<1e-12);
 advance(dynamics,0,2,4,0);assert.ok(up.clone().applyQuaternion(joint.pivot.quaternion).x>0);
 advance(dynamics,2,4,-4,0);assert.ok(up.clone().applyQuaternion(joint.pivot.quaternion).x<0);assert.equal(dynamics.stats.outOfRange,false);
});

test('gravity bends a horizontal cantilever down; a vertical branch and zero gravity have zero static bend',()=>{
 const vertical=fixture(),horizontal=fixture(new THREE.Vector3(1,0,0));const a=createBeamDynamics(vertical.model),b=createBeamDynamics(horizontal.model);
 advance(a,0,2,0,9.81);advance(b,0,2,0,9.81);
 assert.ok(vertical.joint.pivot.quaternion.angleTo(vertical.joint.rest)<1e-8);
 assert.ok(up.clone().applyQuaternion(horizontal.joint.pivot.quaternion).y<-.001);
 const E=8e9,r=.008,L=1,m=550*Math.PI*r*r*L*(1+.5+.25)/3;
 const expectedSlope=m*9.81*L*L/(6*E*Math.PI*r**4/4);
 assert.ok(Math.abs(b.stats.maxDeflectionRad/expectedSlope-1)<.005,'uniform self-weight matches cantilever end slope');
 advance(b,2,4,0,0);assert.ok(b.stats.maxDeflectionRad<1e-8,'unloading decays to rest');
});

test('unloading retains inertia then decays, rather than snapping to rest or following a sine prescription',()=>{
 const{model}=fixture(up,.004),d=createBeamDynamics(model,{windDirection:new THREE.Vector3(1,0,0),dampingRatio:.18});
 advance(d,0,1,4,0);const loaded=d.stats.maxDeflectionRad;assert.ok(loaded>1e-5);
 d.update(1,0,0,1);assert.equal(d.stats.maxDeflectionRad,loaded,'no elapsed time means no instantaneous pose change');
 advance(d,1,1.01,0,0);assert.ok(d.stats.maxDeflectionRad>0);advance(d,1.01,4,0,0);assert.ok(d.stats.maxDeflectionRad<loaded*.001);
});

test('extreme wind and tiny-radius stiff/soft modes remain finite with explicit range diagnostics',()=>{
 const{model,joint}=fixture(up,1e-5),d=createBeamDynamics(model,{maxDeflectionRad:.2});
 advance(d,0,1,1e8,30,.05);assert.equal(d.stats.outOfRange,true);assert.ok(d.stats.clampedBranches>0);assert.ok(d.stats.maxDeflectionRad<=.2+1e-12);assert.ok(joint.pivot.quaternion.toArray().every(Number.isFinite));
 d.update(1000,1e8,30,.05);assert.ok(d.stats.droppedTimeSeconds>900);assert.ok(Number.isFinite(d.stats.windForceN));
});

test('instance geometry determines leaf area and petioles are excluded from mass/count',()=>{
 const{model,joint}=fixture();const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(.1,.2),new THREE.MeshBasicMaterial(),2);mesh.userData.organ='leaf';mesh.userData.connectedBy='petiole';
 const transform=new THREE.Matrix4().makeTranslation(0,.8,0);mesh.setMatrixAt(0,transform);mesh.setMatrixAt(1,transform);joint.pivot.add(mesh);
 const petioles=new THREE.InstancedMesh(new THREE.CylinderGeometry(.001,.001,.02),new THREE.MeshBasicMaterial(),2);petioles.userData.organ='leaf';joint.pivot.add(petioles);model.leafCount=2;
 const d=createBeamDynamics(model);assert.equal(d.stats.countedLeaves,2);assert.ok(Math.abs(d.stats.leafAreaM2-.04)<1e-8);const woodMass=550*Math.PI*.008**2*(1+.5+.25)/3;assert.ok(Math.abs(d.stats.estimatedMassKg-(woodMass+.04*.12))<1e-8);
 mesh.geometry.dispose();petioles.geometry.dispose();mesh.material.dispose();petioles.material.dispose();
});

test('actual ginkgo has one blade count per leaf and finite hierarchical motion',()=>{
 const model=buildPlant('ginkgo',{age:18,day:180,seed:42,density:1});const d=createBeamDynamics(model);assert.equal(d.stats.countedLeaves,model.leafCount);assert.ok(d.stats.estimatedMassKg>0);assert.ok(d.stats.leafAreaM2>0);
 advance(d,0,.5,5,9.81);assert.ok(model.branches.every(b=>b.pivot.quaternion.toArray().every(Number.isFinite)));assert.ok(d.stats.maxDeflectionRad>0);d.dispose();model.dispose();
});

test('fixed physical substeps produce the same result at 30 and 120 display FPS',()=>{
 const a=fixture(up,.004),b=fixture(up,.004);const da=createBeamDynamics(a.model),db=createBeamDynamics(b.model);
 advance(da,0,1,3,0,1,1/30);advance(db,0,1,3,0,1,1/120);
 assert.ok(a.joint.pivot.quaternion.angleTo(b.joint.pivot.quaternion)<1e-7);
});

test('folded blade triangles retain projected area and mass under anisotropic instance scaling',()=>{
 const {model,joint}=fixture(),bare=fixture(),windDirection=new THREE.Vector3(0,0,1);
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([
  0,0,0, 1,0,0, 0,1,0, // +Z
  2,0,0, 2,1,0, 3,0,0, // -Z: must not cancel the first patch
  0,0,0, 0,1,0, 0,0,1, // +X
 ],3));
 const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),1);mesh.userData.organ='leaf';
 mesh.setMatrixAt(0,new THREE.Matrix4().makeScale(-2,3,4));joint.pivot.add(mesh);
 const options={windDirection,reconfigurationSpeedMS:Infinity},d=createBeamDynamics(model,options),baseline=createBeamDynamics(bare.model,options);
 d.update(0,2,0,1);baseline.update(0,2,0,1);
 assert.ok(Math.abs(d.stats.leafAreaM2-12)<1e-12);
 assert.ok(Math.abs(d.stats.estimatedMassKg-baseline.stats.estimatedMassKg-12*.12)<1e-12);
 assert.ok(Math.abs(d.stats.windForceN-baseline.stats.windForceN-.5*1.225*.8*2**2*6)<1e-12);
 assert.equal(d.stats.countedLeaves,1);d.dispose();baseline.dispose();geometry.dispose();mesh.material.dispose();
});

test('resolved uniform cylinder matches analytic distributed-load slope without midpoint bias',()=>{
 const {model,joint}=fixture(new THREE.Vector3(1,0,0));
 const r=.008,L=1,geometry=new THREE.CylinderGeometry(r,r,L,12,1);geometry.translate(0,L/2,0);
 joint.pivot.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
 const d=createBeamDynamics(model,{windDirection:new THREE.Vector3(0,0,1),reconfigurationSpeedMS:Infinity});
 const EI=8e9*Math.PI*r**4/4,m=550*Math.PI*r*r*L,wind=.5*1.225*.8*2**2*(2*r*L);
 d.update(0,2,9.81,1);
 assert.ok(Math.abs(d.stats.maxGravityTargetRad/(m*9.81*L**2/(6*EI))-1)<2e-6);
 assert.ok(Math.abs(d.stats.maxWindTargetRad/(wind*L**2/(6*EI))-1)<2e-6);
 assert.ok(Math.abs(d.stats.maxUnclampedTargetRad/Math.hypot(d.stats.maxGravityTargetRad,d.stats.maxWindTargetRad)-1)<1e-12);
 advance(d,0,2,2,9.81);assert.ok(Math.abs(d.stats.maxDeflectionRad/d.stats.maxUnclampedTargetRad-1)<.005);
 d.dispose();geometry.dispose();
});

test('pre-clamp diagnostics expose force-squared demand without changing E or hiding saturation',()=>{
 const {model}=fixture(up,.0002),d=createBeamDynamics(model,{windDirection:new THREE.Vector3(1,0,0),reconfigurationSpeedMS:Infinity});
 d.update(0,2,0,1);const demand=d.stats.maxUnclampedTargetRad;
 d.update(0,4,0,1);assert.ok(Math.abs(d.stats.maxUnclampedTargetRad/demand-4)<1e-12);
 assert.ok(d.stats.maxUnclampedTargetRad>.28);assert.equal(d.stats.clampedBranches,1);assert.equal(d.stats.maxTargetBranchIndex,0);
 assert.equal(d.stats.maxGravityTargetRad,0);assert.equal(d.stats.youngModulusPa,8e9);assert.equal(d.stats.outOfRange,true);
 d.update(0,0,0,1);assert.equal(d.stats.maxUnclampedTargetRad,0);assert.equal(d.stats.maxTargetBranchIndex,-1);
 d.dispose();
});

test('a descendant point load reaches each ancestor once, even with unsorted joints',()=>{
 function tree(withLeaf){
  const {model,joint}=fixture(up,.002),make=(parent,y)=>{const pivot=new THREE.Group();pivot.position.y=y;parent.add(pivot);return {pivot,rest:pivot.quaternion.clone(),length:.1,radius:.02,order:1,phase:0,flexibility:1,sag:0};};
  const child=make(joint.pivot,.7),grandchild=make(child.pivot,.1);model.branches=[grandchild,joint,child];
  if(withLeaf){const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.1,.2),new THREE.MeshBasicMaterial());leaf.userData.organ='leaf';leaf.rotation.y=Math.PI/2;leaf.position.y=.08;grandchild.pivot.add(leaf);}
  return model;
 }
 const options={windDirection:new THREE.Vector3(1,0,0),reconfigurationSpeedMS:Infinity},loaded=createBeamDynamics(tree(true),options),bare=createBeamDynamics(tree(false),options);
 loaded.update(0,1,0,1);bare.update(0,1,0,1);
 const force=.5*1.225*.8*.02,EI=8e9*Math.PI*.002**4/4,expected=force*.7**2/(2*EI);
 assert.equal(loaded.stats.maxTargetBranchIndex,1);
 assert.ok(Math.abs((loaded.stats.maxUnclampedTargetRad-bare.stats.maxUnclampedTargetRad)/expected-1)<1e-7);
 assert.ok(Math.abs((loaded.stats.windForceN-bare.stats.windForceN)/force-1)<1e-7);
 assert.ok(Math.abs(loaded.stats.estimatedMassKg-bare.stats.estimatedMassKg-.02*.12)<1e-9);
 loaded.dispose();bare.dispose();
});
