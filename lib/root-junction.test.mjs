import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from'three';
import{buildPlant}from'./plant-engine.ts';import{buildAdditionalPlant}from'./additional-species.ts';import{buildRhizosphere}from'./rhizosphere.ts';import{createGroundSurface}from'./ground-surface.ts';import{createBeamDynamics}from'./beam-dynamics.ts';
test('actual woody shoot collars meet a fixed root junction above and below ground under wind and gravity',()=>{
 for(const species of ['ginkgo','osmanthus','camphor','acer'])for(const age of [.2,8]){const p={age,day:180,seed:42,density:1};const plant=['camphor','acer'].includes(species)?buildAdditionalPlant(species,p):buildPlant(species,p),joint=plant.branches.find(b=>b.order===0);
 const collar={position:joint.pivot.position.toArray(),radius:joint.radius*(species==='ginkgo'?1.35:species==='osmanthus'?1:1.4)};
 const roots=buildRhizosphere(species,{age,seed:42,moisture:.62,compaction:.25,soilDepth:2.5,cutaway:true,shootCollar:collar});const junction=roots.group.getObjectByName('root-shoot-junction');assert.ok(junction);junction.geometry.computeBoundingBox();
 assert.ok(Math.abs(junction.geometry.boundingBox.max.y-collar.position[1])<1e-7);assert.ok(junction.geometry.boundingBox.min.y<-.003);
 const dynamics=createBeamDynamics(plant);dynamics.update(0,12,19.62,.2);for(let i=1;i<=24;i++)dynamics.update(i/60,12,19.62,.2);plant.group.updateMatrixWorld(true);
 assert.ok(joint.pivot.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...junction.userData.top))<1e-8,'loads do not lift the root collar');
 assert.equal(junction.userData.anchored,true);dynamics.dispose();plant.dispose();roots.dispose();}
});
test('ground centre remains at the same zero datum for small herbs and adult trees',()=>{const ground=createGroundSurface();for(const radius of [.08,.4,8]){ground.resize(radius);ground.group.updateMatrixWorld(true);const p=ground.group.children[0].geometry.attributes.position;const centre=new THREE.Vector3().fromBufferAttribute(p,0).applyMatrix4(ground.group.children[0].matrixWorld);assert.ok(centre.length()<1e-10);}ground.dispose();});
