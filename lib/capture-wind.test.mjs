import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureGustMultiplier,createCaptureWind} from './capture-wind.ts';

function scene(options) {
  const model = new THREE.Group(), tree = new THREE.Group(), lamp = new THREE.Object3D();
  model.add(tree,lamp); lamp.position.x=4;
  const limb = new THREE.Object3D(); limb.name='tree.foreground.limb01';limb.position.set(.1,3.5,-.1);
  tree.add(limb);
  Object.assign(limb.userData,{wind_joint:true,beam_length_m:2.2,beam_base_radius_m:.029,beam_tip_radius_m:.009,leaf_area_m2:.62,tip_offset_blender_m:[0,1.4,1.2]});
  return {model,tree,lamp,limb,wind:createCaptureWind(model,options)};
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
  // Compare the same time interval and starting state. Separate intervals of
  // a time-varying breeze are not expected to have equal deflection magnitude.
  const positive=scene(),negative=scene();
  run(positive.wind,1200,6);const right=tip.clone().applyQuaternion(positive.limb.quaternion).x;
  run(negative.wind,1200,-6);const left=tip.clone().applyQuaternion(negative.limb.quaternion).x;
  assert.ok(right>0 && left<0);assert.ok(Math.abs(right+left)<1e-8);
});
test('constant-load solve agrees across UI frame rates',()=>{
  const a=scene({gusts:false}).wind,b=scene({gusts:false}).wind;
  run(a,300,4); for(let i=0;i<75;i++)b.step(1/30,4,0);
  assert.ok(Math.abs(a.stats.maxTipCm-b.stats.maxTipCm)<1e-8);
});

test('spatial gust field is continuous, bounded and differs across crown positions',()=>{
  const a=new THREE.Vector3(0,4,0),near=a.clone().addScalar(.0001),b=new THREE.Vector3(8,4,-5);
  let separation=0;
  for(let i=0;i<600;i++){
    const t=i/30, ga=captureGustMultiplier(a,t),gn=captureGustMultiplier(near,t),gb=captureGustMultiplier(b,t);
    assert.ok(ga>=.72-1e-12&&ga<=1+1e-12);
    assert.ok(Math.abs(ga-gn)<.00002);
    separation+=Math.abs(ga-gb);
  }
  assert.ok(separation>10);
});

test('separated identical limbs receive different gust loads without moving their sockets',()=>{
  const {model,tree,limb}=scene();
  const other=limb.clone();other.position.x+=8;tree.add(other);
  const sockets=[limb.position.clone(),other.position.clone()];
  const wind=createCaptureWind(model);
  let difference=0;
  for(let i=0;i<1200;i++){
    wind.step(1/120,5,0);
    difference=Math.max(difference,limb.quaternion.angleTo(other.quaternion));
  }
  assert.ok(difference>.0001,'spatially separated limbs must not move identically');
  assert.deepEqual(limb.position,sockets[0]);assert.deepEqual(other.position,sockets[1]);
  assert.equal(wind.stats.moving,true);
  run(wind,3000,0);
  assert.ok(wind.stats.maxTipCm<.01,'breeze must release back to the photographed rest geometry');
});

test('gust solve agrees at 30, 60 and 120 Hz and at split substeps',()=>{
  const scenes=[scene(),scene(),scene(),scene()];
  [30,60,120,240].forEach((fps,i)=>{
    for(let tick=0;tick<fps*5;tick++)scenes[i].wind.step(1/fps,6,0);
  });
  for(const s of scenes.slice(1)){
    assert.ok(Math.abs(s.wind.stats.maxTipCm-scenes[0].wind.stats.maxTipCm)<1e-9);
    assert.ok(s.limb.quaternion.angleTo(scenes[0].limb.quaternion)<1e-7);
  }
});

test('sustained wind keeps moving after the initial elastic transient',()=>{
  const {wind,limb}=scene();
  run(wind,3600,6);
  const first=limb.quaternion.clone();run(wind,180,6);
  assert.ok(limb.quaternion.angleTo(first)>.0001);
  assert.equal(wind.stats.moving,true);
});
