// Node 22.13+: node infra/reconstruction/export_campus_turf.mjs /tmp/preview.glb [--plants]
// Static full-detail QA attachment. No browser, image substitution or wind baking.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createCampusTurf,campusTuftGeometry,isCampusTurfPoint} from '../../lib/campus-turf.ts';
import {campusPaving,campusLamps,lampRadii,yunguCampusLayout} from '../../lib/campus-layout.ts';
import {buildPlant} from '../../lib/plant-engine.ts';
import {buildAdditionalPlant} from '../../lib/additional-species.ts';
import {initialScenario} from '../../lib/species.ts';

if(!globalThis.FileReader)globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}
};
const args=process.argv.slice(2),withPlants=args.includes('--plants');
const target=resolve(args.find(a=>!a.startsWith('--'))??'/tmp/yungu-refine-20261111/campus-turf-preview.glb');
const scene=new THREE.Group();scene.name='Campus layout turf QA';
const cameras=[
  {name:'Campus overview',position:[18,7.5,20],target:[0,2.5,4],verticalFov:42},
  {name:'Campus grass close',position:[1.65,.20,3.05],target:[.7,.025,4.05],verticalFov:52},
];
for(const view of cameras){
  const c=new THREE.PerspectiveCamera(view.verticalFov,4/3,.01,160);
  c.name=view.name;c.position.fromArray(view.position);c.lookAt(...view.target);scene.add(c);
}
const light=new THREE.DirectionalLight('#fff4da',3.2);
light.name='Campus sun';light.position.set(-14,26,12);light.lookAt(0,0,0);
light.target.position.set(0,0,-1);light.add(light.target);scene.add(light);
const shadowCamera=new THREE.OrthographicCamera(-25,25,24,-24,.1,80);
shadowCamera.position.copy(light.position);shadowCamera.lookAt(0,0,0);shadowCamera.updateMatrixWorld();
for(const p of yunguCampusLayout){
  const projected=new THREE.Vector3(p.x,0,p.z).project(shadowCamera);
  assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&Math.abs(projected.z)<1,'Plant collar outside configured shadow frustum: '+p.id);
}
const field=createCampusTurf();field.update(scene.children[0]);
const matrices=Array.from({length:4},()=>[]),colors=Array.from({length:4},()=>[]);
for(const mesh of field.group.children){
  if(!mesh.visible||!mesh.count)continue;
  const v=mesh.geometry.userData.variant;
  for(let i=0;i<mesh.count;i++){
    matrices[v].push(Array.from(mesh.instanceMatrix.array.slice(i*16,i*16+16)));
    colors[v].push(Array.from(mesh.instanceColor.array.slice(i*3,i*3+3)));
  }
}
const meadow=new THREE.Group();meadow.name='Campus turf full-detail static';
const material=field.group.children.find(m=>m.visible).material;
let bladeCount=0;
for(let v=0;v<4;v++){
  const geometry=campusTuftGeometry(0,v),mesh=new THREE.InstancedMesh(geometry,material,matrices[v].length);
  mesh.name=geometry.name;
  mesh.instanceMatrix.array.set(matrices[v].flat());
  mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(colors[v].flat()),3);
  mesh.userData={persistentTufts:mesh.count,windSpeed:0,fullDetail:true};
  meadow.add(mesh);bladeCount+=mesh.count*geometry.userData.bladeCount;
}
meadow.userData={...field.group.userData,stats:{tufts:field.layout.roots.length,fieldTufts:field.layout.roots.length,blades:bladeCount,drawCalls:4},windSpeed:0};
scene.add(meadow);
const soil=new THREE.Mesh(new THREE.PlaneGeometry(42,36),new THREE.MeshStandardMaterial({name:'Soil and thatch beneath grass',color:'#535c3f',roughness:1}));
soil.name='Campus ground at root plane';soil.rotation.x=-Math.PI/2;scene.add(soil);
for(const slab of campusPaving){
  const m=new THREE.Mesh(new THREE.BoxGeometry(slab.width,slab.height,slab.depth),new THREE.MeshStandardMaterial({name:slab.id,color:slab.color,roughness:slab.roughness}));
  m.name=slab.id;m.position.set(slab.x,slab.y,slab.z);scene.add(m);
}
for(const item of campusLamps){
  const group=new THREE.Group();group.name=item.id;group.position.set(item.x,0,item.z);
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.055,lampRadii.postBase,2.8,12),new THREE.MeshStandardMaterial({color:'#56615d',roughness:.62}));
  post.position.y=1.4;
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(lampRadii.shade,.12,.13,24),new THREE.MeshStandardMaterial({color:'#d6d8c9',roughness:.52,metalness:.08}));
  cap.position.y=2.84;group.add(post,cap);scene.add(group);
}
const plantModels=[],exportMaterials=new Map();
if(withPlants)for(const item of yunguCampusLayout){
  const params={age:item.age,day:initialScenario.day,seed:item.seed,density:item.density};
  const model=['camphor','acer','ophiopogon'].includes(item.species)?buildAdditionalPlant(item.species,params):buildPlant(item.species,params);
  model.update(0,0,1,1);model.group.position.set(item.x,0,item.z);
  model.group.rotation.y=(((item.seed*37)%360)-180)*Math.PI/180;model.group.scale.setScalar(item.scale);
  model.group.name=item.id;
  model.group.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    const copy=source=>{
      if(exportMaterials.has(source))return exportMaterials.get(source);
      const m=source.clone();
      for(const key of Object.keys(m))if(m[key] instanceof THREE.Texture)m[key]=null;
      m.userData={...m.userData,qaTextureOmitted:true};exportMaterials.set(source,m);return m;
    };
    o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);
  });
  plantModels.push(model);scene.add(model.group);
}
scene.userData={purpose:'Static layout turf and shadow QA, not a captured-site reconstruction',coordinateFrame:'Three.js Y-up metres; Blender imports x,-z,y',windSpeed:0,grassFullDetail:true,plantGeometry:withPlants,plantTexturesOmitted:withPlants,day:initialScenario.day,cameras};
scene.updateMatrixWorld(true);
const output=new Uint8Array(await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true,trs:true}));
await mkdir(dirname(target),{recursive:true});await writeFile(target,output);
const bytes=Buffer.from(output),jsonLength=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jsonLength)),binary=bytes.subarray(28+jsonLength);
let roots=0;const occupied=new Set();
for(const node of doc.nodes){
  if(!node.name?.startsWith('Campus turf near'))continue;
  const ext=node.extensions?.EXT_mesh_gpu_instancing;assert.ok(ext);
  const ac=doc.accessors[ext.attributes.TRANSLATION],v=doc.bufferViews[ac.bufferView];
  const start=(v.byteOffset??0)+(ac.byteOffset??0),stride=v.byteStride??12;
  for(let i=0;i<ac.count;i++){
    const x=binary.readFloatLE(start+i*stride),y=binary.readFloatLE(start+i*stride+4),z=binary.readFloatLE(start+i*stride+8);
    assert.equal(y,0);assert.ok(isCampusTurfPoint(x,z,.14-1e-5));
    const key=x+','+z;assert.equal(occupied.has(key),false);occupied.add(key);roots++;
  }
}
assert.equal(roots,field.layout.roots.length);
const sources={};
for(const file of ['lib/campus-turf.ts','lib/campus-layout.ts','app/CampusScene.tsx','infra/reconstruction/export_campus_turf.mjs'])sources[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const receipt={file:target,bytes:output.byteLength,sha256:createHash('sha256').update(output).digest('hex'),roots,blades:bladeCount,grassDrawGroups:4,windSpeed:0,cameras,plantsIncluded:withPlants,plantTexturesOmitted:withPlants,sourceHashes:sources,checks:{allRootsOnY0:true,pavingAndCollarExclusion:true,uniqueRoots:true,shaderWindNotBaked:true,shadowFrustumCoversPlantCollars:true},lighting:{sunPosition:[-14,26,12],sunTarget:[0,0,0],sunColor:'#fff4da',webIntensity:3.2,groundColor:'#535c3f'},limitations:['Plant material textures and browser shaders are omitted from the optional shadow-occluder geometry.','GLB is for grass and contact QA; light intensities and tone mapping need explicit setup in Blender.','Geometry, mowing height, density and scale remain engineering priors.']};
await writeFile(target.replace(/\.glb$/i,'')+'-receipt.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
field.dispose();plantModels.forEach(m=>m.dispose());exportMaterials.forEach(m=>m.dispose());
