// node infra/reconstruction/export_meadow.mjs [base-scene.glb] [meadow.glb] [--full]
// --full retains every near-detail tuft, intended for offline render or close inspection.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {createCaptureMeadow} from '../../lib/capture-meadow.ts';
const args=process.argv.slice(2);
const full=args.includes('--full');
const [source='public/capture17/yungu-lawn.glb',target=full?'yungu-meadow-full.glb':'public/capture17/yungu-meadow.glb']=args.filter(a=>a!=='--full');
// The exporter uses only the asynchronous Blob-to-ArrayBuffer operation in binary mode.
if(!globalThis.FileReader)globalThis.FileReader=class{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(bytes=>{this.result=bytes;this.onloadend?.();});}
};
const base=await readFile(source);
const gltf=JSON.parse(base.subarray(20,20+base.readUInt32LE(12)));
const nodes=gltf.nodes.map(n=>{
  const o=new THREE.Object3D();
  if(n.matrix)o.applyMatrix4(new THREE.Matrix4().fromArray(n.matrix));
  else {o.position.fromArray(n.translation??[0,0,0]);o.quaternion.fromArray(n.rotation??[0,0,0,1]);o.scale.fromArray(n.scale??[1,1,1]);}
  return o;
});
gltf.nodes.forEach((n,i)=>{for(const j of n.children??[])nodes[i].add(nodes[j]);});
const index=gltf.nodes.findIndex(n=>n.name==='Photo 01 registered');
if(index<0)throw Error('Missing registered camera 01 in source GLB');
nodes[index].updateWorldMatrix(true,false);
const view=gltf.cameras[gltf.nodes[index].camera].perspective;
const camera=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(view.yfov),view.aspectRatio??4/3,.05,300);
nodes[index].matrixWorld.decompose(camera.position,camera.quaternion,camera.scale);
const meadow=createCaptureMeadow();const scene=meadow.exportSnapshot(camera,full?'full':'distance');
// A combined release records the original tree/ground input before this attachment.
const treeSource=gltf.asset.extras?.treeSourceSha256;
if(treeSource!=null && !/^[0-9a-f]{64}$/.test(treeSource))throw Error('Invalid treeSourceSha256');
scene.userData.sourceModelSha256=treeSource??createHash('sha256').update(base).digest('hex');
const output=new Uint8Array(await new GLTFExporter().parseAsync(scene,{binary:true}));
await writeFile(target,output);
console.log(JSON.stringify({file:target,bytes:output.byteLength,sha256:createHash('sha256').update(output).digest('hex'),stats:scene.userData.stats}));
meadow.dispose();
