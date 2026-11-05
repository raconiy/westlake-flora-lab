import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPlant} from './plant-engine.ts';
import {buildAdditionalPlant} from './additional-species.ts';
import {createLeafObservation} from './leaf-observation.ts';
const dispose=group=>group?.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
test('leaf observations retain seven distinct organ constructions and real source scale',()=>{
 for(const species of ['ginkgo','osmanthus','iris','oxalis','camphor','acer','ophiopogon']){
  const p={age:2,day:120,seed:42,density:1};
  const plant=['camphor','acer','ophiopogon'].includes(species)?buildAdditionalPlant(species,p):buildPlant(species,p);
  const detail=createLeafObservation(plant.group,species);assert.ok(detail,species);
  const size=new THREE.Box3().setFromObject(detail).getSize(new THREE.Vector3());
  assert.ok(size.length()>.001&&size.length()<.7,`${species} actual leaf dimensions in metres`);
  if(['ginkgo','osmanthus','camphor','acer'].includes(species)){
   assert.equal(detail.userData.petioleFromSource,true,species);
   assert.ok(detail.userData.petioleLengthM>0&&detail.userData.petioleLengthM<.1);
  }
  if(species==='iris'||species==='ophiopogon')assert.equal(detail.userData.petioleFromSource,false,'no invented petiole on a basal blade');
  if(species==='oxalis'){
   let count=0;detail.traverse(o=>{if(o.isMesh&&o.userData.role==='heart-shaped-leaflet')count++;});assert.equal(count,3);
  }
  if(species==='ophiopogon'){
   const mesh=detail.children.find(o=>o.isMesh&&o.userData.organ==='leaf');
   assert.equal(mesh.geometry.attributes.position.count,mesh.userData.leafVertexCount,'observe one declared blade, not an entire merged clump');
  }
  dispose(detail);plant.dispose();
 }
});
test('disposing an observed organ never disposes the source plant resources',()=>{
 const plant=buildPlant('osmanthus',{age:2,day:180,seed:42,density:1});let sourceDisposed=0;
 plant.group.traverse(o=>{if(o.isMesh){o.geometry.addEventListener('dispose',()=>sourceDisposed++);for(const m of Array.isArray(o.material)?o.material:[o.material])m.addEventListener('dispose',()=>sourceDisposed++);}});
 const detail=createLeafObservation(plant.group,'osmanthus');dispose(detail);assert.equal(sourceDisposed,0);plant.dispose();
});
test('a non-unit source petiole keeps its full geometry and connection transform',()=>{
 const root=new THREE.Group(),material=new THREE.MeshStandardMaterial();
 const leafGeometry=new THREE.PlaneGeometry(.04,.07);leafGeometry.translate(0,.035,0);
 const leaf=new THREE.InstancedMesh(leafGeometry,material,1);leaf.userData={organ:'leaf',connectedBy:'petiole'};
 const stalk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.3,.2,2),material,1);stalk.userData.organ='petiole';
 const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.6);
 leaf.setMatrixAt(0,new THREE.Matrix4().compose(new THREE.Vector3(.2,.5,0),q,new THREE.Vector3(.8,.8,.8)));
 stalk.setMatrixAt(0,new THREE.Matrix4().compose(new THREE.Vector3(.2,.49,0),q,new THREE.Vector3(.001,.01,.001)));
 root.add(leaf,stalk);const detail=createLeafObservation(root,'camphor');
 assert.ok(Math.abs(detail.userData.petioleLengthM-.02)<1e-7);
 detail.updateMatrixWorld(true);const observed=detail.children.find(o=>o.userData.organ==='petiole');
 const tip=new THREE.Vector3(0,1,0).applyMatrix4(observed.matrixWorld);
 assert.ok(tip.length()<1e-7,'source stalk end remains exactly on the leaf base');
 dispose(detail);leafGeometry.dispose();stalk.geometry.dispose();material.dispose();
});
