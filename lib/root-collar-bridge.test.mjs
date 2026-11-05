import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import{buildPlant}from'./plant-engine.ts';import{buildAdditionalPlant}from'./additional-species.ts';import{buildRhizosphere}from'./rhizosphere.ts';import{createBeamDynamics}from'./beam-dynamics.ts';import{rootCollarBridge}from'./root-collar-bridge.ts';
test('every actual basal bark corner stays on the visible collar during wind and gravity; soil attachment stays fixed',()=>{
 for(const species of ['ginkgo','osmanthus','camphor','acer']){
  const params={age:12,day:180,seed:42,density:1},plant=['camphor','acer'].includes(species)?buildAdditionalPlant(species,params):buildPlant(species,params),joint=plant.branches.find(b=>b.order===0);
  const soil=buildRhizosphere(species,{...params,moisture:.62,compaction:.26,soilDepth:2.5,cutaway:true,shootCollar:{position:joint.pivot.position.toArray(),radius:joint.radius*(species==='ginkgo'?1.35:species==='osmanthus'?1:1.4)}});
  const bridge=rootCollarBridge(plant,soil),dynamics=createBeamDynamics(plant);assert.ok(bridge);
  const collar=soil.group.getObjectByName('root-shoot-junction'),bark=joint.pivot.children.find(o=>o.isMesh&&!o.isInstancedMesh&&(o.geometry.userData.woodTube||o.geometry.type==='CylinderGeometry'));
  const n=bark.geometry.type==='CylinderGeometry'?bark.geometry.parameters.radialSegments:bark.geometry.userData.woodTube.sides,start=bark.geometry.type==='CylinderGeometry'?bark.geometry.parameters.heightSegments*(n+1):0;
  const original=collar.geometry.attributes.position.array.slice(),p=collar.geometry.attributes.position,targetN=collar.geometry.parameters.radialSegments;
  for(const [wind,gravity]of [[0,0],[3.2,9.81],[12,19.62],[0,0]]){
   for(let i=0;i<=60;i++){dynamics.update(i/60,wind,gravity,1);bridge.update();}
   plant.group.updateMatrixWorld(true);soil.group.updateMatrixWorld(true);
   const top=Array.from({length:targetN},(_,i)=>new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(collar.matrixWorld));
   for(let j=0;j<n;j++){const actual=new THREE.Vector3().fromBufferAttribute(bark.geometry.attributes.position,start+j).applyMatrix4(bark.matrixWorld);assert.ok(top.some(v=>v.distanceTo(actual)<3e-7),`${species}: basal corner detached`);}
   for(let i=0;i<p.count;i++)if(Math.abs(original[i*3+1]-collar.userData.bottomY)<1e-7){assert.equal(p.getX(i),original[i*3]);assert.equal(p.getY(i),original[i*3+1]);assert.equal(p.getZ(i),original[i*3+2]);}
   assert.ok(p.array.every(Number.isFinite));
  }
  assert.match(collar.userData.continuity,/not a root-soil solver/);dynamics.dispose();plant.dispose();soil.dispose();
 }
});
