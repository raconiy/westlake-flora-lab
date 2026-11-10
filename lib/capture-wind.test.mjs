import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCaptureWind} from './capture-wind.ts';

function scene() {
  const model = new THREE.Group(), tree = new THREE.Group(), lamp = new THREE.Object3D();
  model.add(tree,lamp); lamp.position.x=4;
  const limb = new THREE.Object3D(); limb.name='tree.foreground.limb01';limb.position.set(.1,3.5,-.1);
  tree.add(limb);
  Object.assign(limb.userData,{wind_joint:true,beam_length_m:2.2,beam_base_radius_m:.029,beam_tip_radius_m:.009,leaf_area_m2:.62,tip_offset_blender_m:[0,1.4,1.2]});
  return {model,tree,lamp,limb,wind:createCaptureWind(model)};
}
function run(w,n,v,m=0) { for(let i=0;i<n;i++)w.step(1/120,v,m); }

test('wind loads a branch at a fixed socket and decays after release',()=>{
  const {tree,lamp,limb,wind}=scene(), socket=limb.position.clone(), rest=limb.quaternion.clone();
  run(wind,120,0);assert.equal(wind.stats.maxTipCm,0);
  run(wind,480,6);const loaded=wind.stats.maxTipCm;assert.ok(loaded>.1);
  wind.step(0,0,0);assert.ok(Math.abs(wind.stats.maxTipCm-loaded)<1e-9);
  run(wind,1,0);assert.ok(wind.stats.maxTipCm>0);
  run(wind,2400,0);assert.ok(wind.stats.maxTipCm<.01);
  assert.ok(limb.quaternion.angleTo(rest)<.001);assert.deepEqual(limb.position,socket);
  assert.deepEqual(tree.position.toArray(),[0,0,0]);assert.deepEqual(lamp.position.toArray(),[4,0,0]);
});
test('added mass deflects down and opposite winds give opposite lateral travel',()=>{
  const {wind,limb}=scene(), tip=new THREE.Vector3(0,1.2,-1.4);
  run(wind,1200,0,1);assert.ok(tip.clone().applyQuaternion(limb.quaternion).y<tip.y);
  run(wind,1200,6);const right=tip.clone().applyQuaternion(limb.quaternion).x;
  run(wind,1200,-6);const left=tip.clone().applyQuaternion(limb.quaternion).x;
  assert.ok(right>0 && left<0);assert.ok(Math.abs(right+left)<1e-8);
});
test('constant-load solve agrees across UI frame rates',()=>{
  const a=scene().wind,b=scene().wind;
  run(a,300,4); for(let i=0;i<75;i++)b.step(1/30,4,0);
  assert.ok(Math.abs(a.stats.maxTipCm-b.stats.maxTipCm)<1e-8);
});
