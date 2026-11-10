import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3} from 'three';
import {buildPlant} from './plant-engine.ts';
import {campusLamps, campusPaving, lampRadii, yunguCampusLayout} from './campus-layout.ts';

// This is clearance inside the model, in scene units. It is not a site measurement.
const minimumClearance = .3;
function pavingClearance({minX,maxX,minZ,maxZ}) {
  return Math.min(...campusPaving.map(slab => {
    const dx = Math.max(0,slab.x-slab.width/2-maxX,minX-slab.x-slab.width/2);
    const dz = Math.max(0,slab.z-slab.depth/2-maxZ,minZ-slab.z-slab.depth/2);
    return Math.hypot(dx,dz);
  }));
}
function footprintAt({x,z},radius) {
  return {minX:x-radius,maxX:x+radius,minZ:z-radius,maxZ:z+radius};
}

test('plant origins and the complete lamp footprints leave a clear verge along every paved slab',()=>{
  for (const plant of yunguCampusLayout) {
    assert.ok(pavingClearance(footprintAt(plant,0)) >= minimumClearance,plant.id);
  }
  assert.equal(campusLamps.length,3);
  for (const lamp of campusLamps) {
    for (const radius of Object.values(lampRadii)) {
      assert.ok(pavingClearance(footprintAt(lamp,radius)) >= minimumClearance,lamp.id);
    }
  }
});

test('scaled osmanthus and iris meshes clear the paving at the sampled seasons and winds',()=>{
  const moved=yunguCampusLayout.filter(plant=>['osmanthus','iris'].includes(plant.species));
  assert.equal(moved.length,4);
  for (const plant of moved) {
    for (const day of [15,105,196,305]) {
      const model=buildPlant(plant.species,{age:plant.age,density:plant.density,seed:plant.seed,day});
      try {
        model.group.scale.setScalar(plant.scale);
        model.group.position.set(plant.x,0,plant.z);
        for (const [time,wind] of [[0,0],[0,1],[2.5,6],[5,12]]) {
          model.update(time,wind,1,1);
          const {min,max}=new Box3().setFromObject(model.group,true);
          const clearance=pavingClearance({minX:min.x,maxX:max.x,minZ:min.z,maxZ:max.z});
          assert.ok(Number.isFinite(clearance) && clearance >= minimumClearance,
            `${plant.id}, day ${day}, wind ${wind}: clearance ${clearance}`);
        }
      } finally { model.dispose(); }
    }
  }
});
