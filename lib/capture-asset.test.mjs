import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as THREE from 'three';
import {createCaptureWind} from './capture-wind.ts';

// Use the actual delivery's hierarchy (mesh vertex buffers are not needed to
// exercise the exported sockets, frame transforms and engineering properties).
function loadGraph() {
  const data = fs.readFileSync(new URL('../public/capture17/yungu-lawn.glb',import.meta.url));
  assert.equal(data.readUInt32LE(0),0x46546c67);
  const doc = JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
  const nodes=doc.nodes.map(n=>{
    const o=new THREE.Object3D();o.name=n.name??'';o.userData=n.extras??{};
    if(n.matrix) {
      o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale);
    } else {
      if(n.translation)o.position.fromArray(n.translation);
      if(n.rotation)o.quaternion.fromArray(n.rotation);
      if(n.scale)o.scale.fromArray(n.scale);
    }
    return o;
  });
  doc.nodes.forEach((n,i)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));
  const world=new THREE.Group();
  for(const id of doc.scenes[doc.scene??0].nodes)world.add(nodes[id]);
  return {world,nodes,doc,data};
}

test('photographic bark preserves both image axes and is not reused as a tangent-space normal map',()=>{
  const {doc,data}=loadGraph();
  const material=doc.materials.find(m=>m.name==='Foreground bark from photograph 01');
  assert.ok(material,'the delivered stem must contain the corrected photographic bark material');
  const base=material.pbrMetallicRoughness?.baseColorTexture;
  assert.ok(base);
  const source=doc.textures[base.index].source;
  if(material.normalTexture)assert.notEqual(doc.textures[material.normalTexture.index].source,source,
    'a diffuse photograph is not a tangent-space normal map');
  const img=doc.images[source],view=doc.bufferViews[img.bufferView];
  assert.equal(img.mimeType,'image/png');
  const binStart=28+data.readUInt32LE(12);
  const image=data.subarray(binStart+(view.byteOffset??0),binStart+(view.byteOffset??0)+view.byteLength);
  assert.equal(image.toString('hex',0,8),'89504e470d0a1a0a');
  assert.ok(image.readUInt32BE(16)>=64 && image.readUInt32BE(20)>=64,
    'both projected image axes must remain; a two-column sampling error must fail');
});

test('shipped lawn responds to load and unloading at fixed roots, lamp bases and branch sockets',()=>{
  const {world,nodes}=loadGraph();
  const dynamics=createCaptureWind(world);
  const joints=nodes.filter(o=>o.userData.wind_joint===true);
  assert.ok(joints.length>=40 && joints.length===dynamics.stats.branchCount,'all visible wind joints have model data');
  const bases=nodes.filter(o=>o.userData.root_anchored||o.userData.asset_class==='fixed path luminaire');
  assert.ok(bases.length>=13);
  world.updateMatrixWorld(true);
  const initial=bases.map(o=>o.matrixWorld.clone());
  const sockets=joints.map(o=>o.position.clone());
  const calm=dynamics.step(0,0,0);assert.equal(calm.maxTipCm,0);
  let peak=0,peakLimited=0;
  for(let i=0;i<120*24;i++){
    const r=dynamics.step(1/120,i>=240 && i<720?6:0,0);
    peak=Math.max(peak,r.maxTipCm);
    peakLimited=Math.max(peakLimited,r.limited);
  }
  assert.ok(peak>.1,'6 m/s must measurably deflect the actual crown');
  assert.ok(dynamics.stats.maxTipCm<Math.max(.2,.005*peak),'zero-wind recovery after 18s');
  world.updateMatrixWorld(true);
  for(const [i,o] of bases.entries())assert.deepEqual(o.matrixWorld.elements,initial[i].elements,o.name);
  for(const [i,o] of joints.entries())assert.deepEqual(o.position.toArray(),sockets[i].toArray(),o.name);
  for(let i=0;i<720;i++)dynamics.step(1/120,0,1);
  assert.ok(dynamics.stats.testTipCm>.1);
  console.log(JSON.stringify({branches:joints.length,fixedBases:bases.length,windPeakCm:peak,limitCountAtPeak:peakLimited,massTestTipCm:dynamics.stats.testTipCm,loading:'6 m/s from t=2 to 6s; 1 kg after t=24s'}));
});

test('three photographed crowns contain attached leaf meshes and interconnecting wood, with an instanced lawn in the download',()=>{
  const {world, nodes}=loadGraph();
  const names=['tree.foreground.forked','tree.mid-fork','tree.left-spreading'];
  for (const name of names) {
    const tree=world.getObjectByName(name);
    assert.ok(tree);
    const leaves=[], wood=[];
    tree.traverse(node=>{
      assert.ok(!node.name.includes('visible-crown.'),'no captured image sheet remains in the live crown');
      if(node.userData.physical_blades)leaves.push(node);
      if(node.userData.connected_wood_segments)wood.push(node);
    });
    assert.ok(leaves.length>=3 && wood.length===leaves.length);
    assert.ok(leaves.reduce((sum,o)=>sum+o.userData.physical_blades,0)>10000);
    for(const tip of leaves)assert.equal(tip.parent.userData.wind_joint,true);
  }
  assert.ok(nodes.some(n=>n.name==='CaptureMeadowStatic'));
  assert.ok(nodes.some(n=>n.name==='CapturedGroundFixtures'));
});
