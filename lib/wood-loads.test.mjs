import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBeamDynamics } from './beam-dynamics.ts';
import { woodSections, sectionVolume, mergeWoodSections } from './wood-loads.ts';
import { buildAdditionalPlant } from './additional-species.ts';

function fixture(extra=true){
 const group=new THREE.Group(),pivot=new THREE.Group();group.add(pivot);
 const branch={pivot,rest:pivot.quaternion.clone(),length:1,radius:.01,order:0,phase:0,flexibility:1,sag:0};
 const geometries=[new THREE.CylinderGeometry(.005,.01,1)];
 geometries[0].translate(0,.5,0);
 // Capture the local cylinder before a transform: merged transformed tubes use
 // actual vertex rings; the cylinder record is explicitly transformed here.
 geometries[0].userData.woodSections=woodSections(new THREE.CylinderGeometry(.005,.01,1)).map(s=>({...s,a:[s.a[0],s.a[1]+.5,s.a[2]],b:[s.b[0],s.b[1]+.5,s.b[2]]}));
 if(extra){const fine=new THREE.CylinderGeometry(.001,.002,.4);fine.userData.woodSections=woodSections(fine).map(s=>({...s,a:[s.a[1]+.2,.7,0],b:[s.b[1]+.2,.7,0]}));geometries.push(fine);}
 const merged=new THREE.BufferGeometry();mergeWoodSections(geometries,merged);
 pivot.add(new THREE.Mesh(merged,new THREE.MeshBasicMaterial()));
 const model={group,branches:[branch],leafCount:0,height:1,update(){},dispose(){}};
 return {model,geometries};
}
test('merged fine wood contributes its actual frustum mass once, without adding a second primary proxy',()=>{
 const a=fixture(false),b=fixture(true),da=createBeamDynamics(a.model),db=createBeamDynamics(b.model);
 const primary=550*Math.PI*(.01**2+.005**2+.01*.005)/3;
 const extra=550*Math.PI*.4*(.002**2+.001**2+.002*.001)/3;
 assert.ok(Math.abs(da.stats.estimatedMassKg-primary)<1e-9);
 assert.ok(Math.abs(db.stats.estimatedMassKg-primary-extra)<1e-9);
 assert.equal(da.stats.resolvedWoodSegments,12);assert.equal(db.stats.resolvedWoodSegments,24);
 da.update(0,2,0,1);db.update(0,2,0,1);assert.ok(db.stats.windForceN>da.stats.windForceN);
 const f=db.stats.windForceN;db.update(0,4,0,1);assert.ok(Math.abs(db.stats.windForceN/f-4)<1e-12);
});
test('actual camphor and maple merged axes have resolved wood loads and finite bounded dynamics',()=>{
 for(const species of ['camphor','acer']){
  const model=buildAdditionalPlant(species,{age:12,day:180,seed:42,density:1});
  const dynamics=createBeamDynamics(model);
  assert.ok(dynamics.stats.resolvedWoodSegments>model.branches.length*12);
  let actual=0;model.group.updateMatrixWorld(true);
  model.group.traverse(o=>{if(o.isMesh&&Array.isArray(o.geometry.userData.woodSections))actual+=o.geometry.userData.woodSections.reduce((n,s)=>n+sectionVolume(s),0)*Math.abs(o.matrixWorld.determinant())*550;});
  assert.ok(actual>0&&dynamics.stats.estimatedMassKg>=actual);
  for(let i=0;i<30;i++)dynamics.update(i/60,3.2,9.81,1);
  assert.ok(Number.isFinite(dynamics.stats.windForceN));assert.ok(dynamics.stats.maxDeflectionRad<=.28+1e-12);
  dynamics.dispose();model.dispose();
 }
});
