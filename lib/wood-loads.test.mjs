import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBeamDynamics } from './beam-dynamics.ts';
import { woodSections, sectionVolume, mergeWoodSections, sectionArmFactors, sectionProjectedArea, tagWoodTube } from './wood-loads.ts';
import { buildAdditionalPlant } from './additional-species.ts';

function fixture(extra=true){
 const group=new THREE.Group(),pivot=new THREE.Group();group.add(pivot);
 const branch={pivot,rest:pivot.quaternion.clone(),length:1,radius:.01,order:0,phase:0,flexibility:1,sag:0};
 const geometries=[new THREE.CylinderGeometry(.005,.01,1)];
 geometries[0].translate(0,.5,0);
 // Bake transforms into real vertex rings, as the plant generators do.
 if(extra){const fine=new THREE.CylinderGeometry(.001,.002,.4);fine.rotateZ(-Math.PI/2);fine.translate(.2,.7,0);geometries.push(fine);}
 const merged=new THREE.BufferGeometry();mergeWoodSections(geometries,merged);
 pivot.add(new THREE.Mesh(merged,new THREE.MeshBasicMaterial()));
 const model={group,branches:[branch],leafCount:0,height:1,update(){},dispose(){}};
 return {model,geometries};
}
test('merged fine wood contributes its actual frustum mass once, without adding a second primary proxy',()=>{
 const a=fixture(false),b=fixture(true),da=createBeamDynamics(a.model),db=createBeamDynamics(b.model);
 const primary=550*Math.PI*(.01**2+.005**2+.01*.005)/3;
 const extra=550*Math.PI*.4*(.002**2+.001**2+.002*.001)/3;
 assert.ok(Math.abs(da.stats.estimatedMassKg-primary)<1e-8);
 assert.ok(Math.abs(db.stats.estimatedMassKg-primary-extra)<1e-8);
 assert.equal(da.stats.resolvedWoodSegments,12);assert.equal(db.stats.resolvedWoodSegments,24);
 da.update(0,2,0,1);db.update(0,2,0,1);assert.ok(db.stats.windForceN>da.stats.windForceN);
 const f=db.stats.windForceN;db.update(0,4,0,1);assert.ok(Math.abs(db.stats.windForceN/f-4)<1e-12);
});

test('baked and mesh transforms preserve SI volume and elliptical transverse width after merge',()=>{
 const cylinder=new THREE.CylinderGeometry(.01,.01,2,12,3);
 cylinder.scale(3,1,2);cylinder.rotateZ(Math.PI/2);cylinder.translate(.7,.4,-.2);
 const merged=new THREE.BufferGeometry();mergeWoodSections([cylinder],merged);
 const transform=new THREE.Matrix4().makeScale(2,2,2),sections=woodSections(merged);
 const volume=sections.reduce((n,s)=>n+sectionVolume(s),0)*8;
 assert.ok(Math.abs(volume/(Math.PI*.01**2*2*6*8)-1)<2e-6);
 // Axis is X; ellipse semiaxes are .06 along Y and .04 along Z.
 const areaY=sections.reduce((n,s)=>n+sectionProjectedArea(s,transform,new THREE.Vector3(0,1,0)),0);
 const areaZ=sections.reduce((n,s)=>n+sectionProjectedArea(s,transform,new THREE.Vector3(0,0,1)),0);
 assert.ok(Math.abs(areaY-.32)<2e-6);assert.ok(Math.abs(areaZ-.48)<2e-6);
 assert.equal(sections.reduce((n,s)=>n+sectionProjectedArea(s,transform,new THREE.Vector3(1,0,0)),0),0);
 cylinder.dispose();merged.dispose();
});

test('tagged polygon tube keeps its actual projected ring width rather than circularizing its area',()=>{
 const cylinder=tagWoodTube(new THREE.CylinderGeometry(.01,.01,2,4,1,true),1,4);
 const sections=woodSections(cylinder),identity=new THREE.Matrix4(),wind=new THREE.Vector3(1,0,0);
 assert.ok(Math.abs(sections.reduce((n,s)=>n+sectionVolume(s),0)-.0004)<1e-10);
 assert.ok(Math.abs(sections.reduce((n,s)=>n+sectionProjectedArea(s,identity,wind),0)-.04)<1e-8);
 cylinder.dispose();
});

test('frustum load factors integrate distributed drag and mass analytically, including arm clipping',()=>{
 const section={a:[0,0,0],b:[0,1,0],areaA:Math.PI,areaB:Math.PI/4},f=sectionArmFactors(section,0,1,1);
 // Integral of (1-t/2)^p t² / 2, divided by integral of radius^p.
 assert.ok(Math.abs(f.drag-5/36)<1e-14);
 assert.ok(Math.abs(f.mass-4/35)<1e-14);
 const uniform={...section,areaB:Math.PI};
 assert.ok(Math.abs(sectionArmFactors(uniform,0,1,1).mass-1/6)<1e-14);
 assert.ok(Math.abs(sectionArmFactors(uniform,-1,2,1).mass-2/9)<1e-14);
});

test('nearest dynamic ownership counts each resolved primary and merged fine axis exactly once',()=>{
 const {model}=fixture(false),root=model.branches[0],pivot=new THREE.Group();pivot.position.y=.6;root.pivot.add(pivot);
 const geometry=new THREE.CylinderGeometry(.002,.004,.3);geometry.translate(0,.15,0);pivot.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
 model.branches.unshift({pivot,rest:pivot.quaternion.clone(),length:.3,radius:.004,order:1,phase:0,flexibility:1,sag:0});
 const d=createBeamDynamics(model,{leafArealMassKgM2:0});
 const expected=550*Math.PI*(.01**2+.01*.005+.005**2)/3+550*Math.PI*.3*(.004**2+.004*.002+.002**2)/3;
 assert.ok(Math.abs(d.stats.estimatedMassKg-expected)<1e-8);assert.equal(d.stats.resolvedWoodSegments,24);
 d.dispose();
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
