import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {leafTipDisplacement,leafBendShape,createLeafDynamics,LEAF_PRIORS} from './leaf-dynamics.ts';
test('leaf base and tangent stay attached while transverse loads bend with correct sign and stiffness',()=>{
 assert.deepEqual(leafBendShape(0),{displacement:0,slope:0});
 assert.equal(leafBendShape(1).displacement,1);
 assert.equal(leafTipDisplacement(.07,0,0),0);
 const positive=leafTipDisplacement(.07,2,0),negative=leafTipDisplacement(.07,-2,0);
 assert.ok(positive>0);assert.equal(negative,-positive);
 assert.ok(leafTipDisplacement(.07,0,-9.81)<0);
 assert.ok(Math.abs(leafTipDisplacement(.07,2,0,{youngModulusPa:4e8}))<positive);
 assert.ok(Math.abs(leafTipDisplacement(.07,2,0,{thicknessM:.0006}))<positive);
});
test('small-load uniform pressure obeys wind squared and L fourth scaling, with bounded large loads',()=>{
 const tiny=leafTipDisplacement(.01,.01,0);
 assert.ok(Math.abs(leafTipDisplacement(.01,.02,0)/tiny-4)<1e-6);
 assert.ok(Math.abs(leafTipDisplacement(.02,.01,0)/tiny-16)<1e-5);
 for(const L of [.001,.07,.4])for(const u of [-1e9,-25,0,25,1e9,NaN]){
  const value=leafTipDisplacement(L,u,-9.81);
  assert.ok(Number.isFinite(value)&&Math.abs(value)<=L*LEAF_PRIORS.maxTipRatio);
 }
});
test('visible and shadow materials receive the same deformation; disposal restores shared originals',()=>{
 const geometry=new THREE.PlaneGeometry(.05,.07);geometry.translate(0,.035,0);
 const original=new THREE.MeshStandardMaterial(),group=new THREE.Group();
 const blade=new THREE.InstancedMesh(geometry,original,2);blade.userData={organ:'leaf',connectedBy:'petiole'};
 const stalk=new THREE.Mesh(new THREE.CylinderGeometry(.001,.001,.01),original);stalk.userData={organ:'leaf',role:'petiole'};
 group.add(blade,stalk);const flex=createLeafDynamics(group);assert.equal(flex.bladeMeshes,1);assert.equal(stalk.material,original);
 const inject=mat=>{const shader={uniforms:{},vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>'};mat.onBeforeCompile(shader,{});return shader;};
 const visible=inject(blade.material),shadow=inject(blade.customDepthMaterial);
 assert.ok(visible.vertexShader.includes('transformed.z += leafBend(position).x'));
 assert.ok(shadow.vertexShader.includes('transformed.z += leafBend(position).x'));
 assert.equal(visible.uniforms.leafPressure,shadow.uniforms.leafPressure);
 flex.update(4,9.81,2);assert.ok(visible.uniforms.leafPressure.value>0);
 assert.equal(visible.uniforms.leafGravity.value,9.81);assert.equal(visible.uniforms.leafStiffness.value,2);
 flex.update(0,0);assert.equal(visible.uniforms.leafPressure.value,0);assert.equal(visible.uniforms.leafGravity.value,0);
 let disposed=0;blade.material.addEventListener('dispose',()=>disposed++);
 flex.dispose();flex.dispose();assert.equal(disposed,1);assert.equal(blade.material,original);
 assert.equal(blade.customDepthMaterial,undefined);assert.equal(blade.frustumCulled,true);
 geometry.dispose();original.dispose();stalk.geometry.dispose();
});
