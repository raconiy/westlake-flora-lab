import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import{geometryHeight}from'./geometry-height.ts';
test('plant height uses real transformed vertices instead of empty AABB corners',()=>{
 const group=new THREE.Group(),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,1,0,1,0,0],3));
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());mesh.rotation.z=-Math.PI/4;group.add(mesh);
 assert.ok(new THREE.Box3().setFromObject(group).max.y>.7);assert.ok(geometryHeight(group)<1e-12);
 mesh.position.y=.2;assert.ok(Math.abs(geometryHeight(group)-.2)<1e-12);
});
test('instance transforms and translated parents contribute exactly once; empty and buried models have zero aerial height',()=>{
 const group=new THREE.Group(),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,.03,0],3));
 const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),2);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,.1,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(0,.2,0));group.position.y=.3;group.add(mesh);
 assert.ok(Math.abs(geometryHeight(group)-.53)<1e-7);group.position.y=-1;assert.equal(geometryHeight(group),0);assert.equal(geometryHeight(new THREE.Group()),0);
});
