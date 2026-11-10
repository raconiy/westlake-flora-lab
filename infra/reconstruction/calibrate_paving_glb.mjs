// Apply the photographed near-walk course and diffuse received skylight to a Capture17 GLB.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const [source, configPath, destination, receipt] = process.argv.slice(2);
if (!receipt || source === destination) throw Error('Expected source.glb field.json destination.glb receipt.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const original = fs.readFileSync(source), jsonLength = original.readUInt32LE(12);
const doc = JSON.parse(original.subarray(20, 20 + jsonLength));
if (doc.asset.extras?.nearPavingRevision) throw Error('Near walk already calibrated');
const originalBin = original.subarray(28 + jsonLength), parts = [originalBin];
let length = originalBin.length;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cache = new Map();
await MeshoptDecoder.ready;
function bufferView(i) {
  if (cache.has(i)) return cache.get(i);
  const view = doc.bufferViews[i], ext = view.extensions?.EXT_meshopt_compression;
  let data;
  if (ext) {
    if (ext.buffer !== 0) throw Error('Unexpected meshopt buffer');
    data = Buffer.alloc(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(data, ext.count, ext.byteStride,
      originalBin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength), ext.mode, ext.filter);
  } else {
    if (view.buffer !== 0) throw Error('Missing GLB backing data');
    data = originalBin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  }
  cache.set(i, data);
  return data;
}
function add(buffer,target=34962) {
  const offset = length;
  parts.push(buffer); length += buffer.length;
  const pad = (4 - length % 4) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); length += pad; }
  return doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length,...(target?{target}:{})}) - 1;
}
function smooth(lo,hi,t) { const x=Math.min(1,Math.max(0,(t-lo)/(hi-lo))); return x*x*(3-2*x); }
function at(t,d) {
  const warp=config.warp, clipped=Math.min(warp.tFitMax,Math.max(warp.tFitMin,t));
  const [a,b,c]=warp.jointPolynomial;
  const center=a+b*clipped+c*clipped*clipped, half=warp.jointHalfWidthM;
  const target=[warp.outerM,center-half,center+half,warp.backM];
  const old=warp.sourceD;
  let k=0;while(k<2 && d>old[k+1])k++;
  const rr=(d-old[k])/(old[k+1]-old[k]);
  const shift=rr<0||rr>1?0:target[k]+rr*(target[k+1]-target[k])-d;
  const wt=smooth(config.taperM[0],config.taperM[1],t)*(1-smooth(config.taperM[2],config.taperM[3],t));
  return {delta:wt*shift,wt,center,srcJoint:Math.abs(d-(old[1]+old[2])/2)<(old[2]-old[1])/2+.022};
}
const fields={}; const nodes={};
for(const n of doc.nodes)if(config.ownedNodes.includes(n.name))nodes[n.name]=n;
for (const name of config.ownedNodes) {
  if (!nodes[name]) throw Error('Missing object '+name);
  for(const child of nodes[name].children) {
    const obj=doc.nodes[child], mesh=doc.meshes[obj.mesh];
    const scale=obj.scale,translation=obj.translation;
    if(!scale || !translation || obj.rotation || obj.matrix)throw Error('Unexpected quantized mesh transform');
    for(const primitive of mesh.primitives) {
      const pos=doc.accessors[primitive.attributes.POSITION],v=doc.bufferViews[pos.bufferView],buf=bufferView(pos.bufferView);
      if (pos.componentType!==5123 || pos.type!=='VEC3' || pos.normalized || primitive.attributes.COLOR_0!==undefined)throw Error('Unsupported positions/color');
      const mat=doc.materials[primitive.material].name;
      const out=Buffer.alloc(pos.count*12),colors=Buffer.alloc(pos.count*4);
      const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];let verts=0,dmin=Infinity,dmax=-Infinity;
      const custom=config.materialGain[mat];if(!custom)throw Error('Unexpected foreground material '+mat);
      for(let n=0;n<pos.count;n++){
        const cur=(pos.byteOffset||0)+n*(v.byteStride||6);
        const local=[0,1,2].map(k=>buf.readUInt16LE(cur+2*k));
        const x=local[0]*scale[0]+translation[0],z=local[2]*scale[2]+translation[2];
        const [tx,tz]=config.tangentXZ,t=tx*x+tz*z,d=-tz*x+tx*z;
        if(Math.abs(t)<2) {dmin=Math.min(dmin,d);dmax=Math.max(dmax,d);}
        const field=at(t,d),{wt,srcJoint}=field;
        let delta=d<=config.warp.sourceD[0]+.06 ? 0 : field.delta;
        // Quantization of the old 280m slab mesh was ~21mm. Keep both surface
        // boundaries on their respective side of the observed expansion seam.
        if(Math.abs(d-config.jointSeal.oldJointCenter)<.062){
          if(mat==='Granite.VergeCourse')delta=Math.min(delta,(field.center-config.warp.jointHalfWidthM-d)*wt);
          if(mat==='Granite.PhotoAlbedo')delta=Math.max(delta,(field.center+config.warp.jointHalfWidthM-d)*wt);
        }
        local[0]-=tz*delta/scale[0];local[2]+=tx*delta/scale[2];
        local.forEach((value,k)=>{out.writeFloatLE(value,n*12+4*k);minimum[k]=Math.min(minimum[k],Math.fround(value));maximum[k]=Math.max(maximum[k],Math.fround(value));});
        const factor=srcJoint && mat==='Granite.RecessedJoint'?config.vergeJointGain:custom;
        [0,1,2].forEach(k=>{colors[n*4+k]=Math.round(255*((1-wt)+wt*factor[k]));});colors[n*4+3]=255;
        if(wt>0)verts++;
      }
      primitive.attributes.POSITION=doc.accessors.push({bufferView:add(out),componentType:5126,type:'VEC3',count:pos.count,min:minimum,max:maximum})-1;
      primitive.attributes.COLOR_0=doc.accessors.push({bufferView:add(colors),componentType:5121,normalized:true,type:'VEC4',count:pos.count})-1;
      if(mat==='Granite.PhotoAlbedo'){
        const donor=fs.readFileSync(path.join(path.dirname(configPath),config.texture));
        const im=doc.images.push({name:'Photographic stone grain',mimeType:'image/jpeg',bufferView:add(donor,null)})-1;
        const material=structuredClone(doc.materials[primitive.material]);
        const slot=material.pbrMetallicRoughness.baseColorTexture, tex=structuredClone(doc.textures[slot.index]);
        tex.source=im;slot.index=doc.textures.push(tex)-1;material.name='NearWalk.Granite.PhotoGrain';
        primitive.material=doc.materials.push(material)-1;
      }
      fields[mat]={node:name,vertices:pos.count,inTransitionOrObserved:verts,sourceDRangeWithin2m:[dmin,dmax]};
    }
  }
}
// A real, recessed expansion seal closes the gap between the verge and the pavers.
// Float32 world metres let the narrow strip survive the old geometry compression.
const seal=config.jointSeal,coords=[],faces=[],normal=[];
const t0=config.taperM[0],t1=config.taperM[3],steps=Math.ceil((t1-t0)*6);
for(let i=0;i<=steps;i++){
  const t=t0+(t1-t0)*i/steps,w=at(t,seal.oldJointCenter);
  const center=seal.oldJointCenter+(w.center-seal.oldJointCenter)*w.wt;
  const half=config.warp.jointHalfWidthM*w.wt, h=seal.topYM;
  for(const offset of [-half,half]){const d=center+offset;coords.push(config.tangentXZ[0]*t-config.tangentXZ[1]*d,h,config.tangentXZ[1]*t+config.tangentXZ[0]*d);normal.push(0,1,0);}
  if(i){const a=2*(i-1);faces.push(a,a+1,a+2,a+2,a+1,a+3);}
}
const vert=Array.from({length:coords.length/3},(_,i)=>coords.slice(i*3,i*3+3));
const sPos=doc.accessors.push({bufferView:add(Buffer.from(new Float32Array(coords).buffer)),componentType:5126,type:'VEC3',count:vert.length,min:[0,1,2].map(k=>Math.min(...vert.map(v=>v[k]))),max:[0,1,2].map(k=>Math.max(...vert.map(v=>v[k])))})-1;
const sN=doc.accessors.push({bufferView:add(Buffer.from(new Float32Array(normal).buffer)),componentType:5126,type:'VEC3',count:vert.length})-1;
const sI=doc.accessors.push({bufferView:add(Buffer.from(new Uint16Array(faces).buffer),34963),componentType:5123,type:'SCALAR',count:faces.length})-1;
const sMat=doc.materials.push({name:'NearWalk.ExpansionSeal.Recess',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[...seal.baseLinearRgb,1],metallicFactor:0,roughnessFactor:1}})-1;
const sMesh=doc.meshes.push({name:seal.meshName,primitives:[{mode:4,material:sMat,attributes:{POSITION:sPos,NORMAL:sN},indices:sI}]})-1;
const sn=doc.nodes.push({name:seal.meshName,mesh:sMesh,extras:{basis:'Observed dark expansion line; width/depth are projective estimates. No independent collider.'}})-1;
doc.scenes[doc.scene??0].nodes.push(sn);
doc.buffers[0].byteLength=length;
doc.asset.extras={...doc.asset.extras,nearPavingRevision:6};
const data=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc((data.length+3)&~3,32);data.copy(json);
const header=Buffer.from(original.subarray(0,20));header.writeUInt32LE(28+json.length+length,8);header.writeUInt32LE(json.length,12);
const bh=Buffer.alloc(8);bh.writeUInt32LE(length);bh.write('BIN\0',4);
const result=Buffer.concat([header,json,bh,...parts]);fs.writeFileSync(destination,result);
fs.writeFileSync(receipt,JSON.stringify({sourceSha256:sha(original),outputSha256:sha(result),configSha256:sha(fs.readFileSync(configPath)),owned:fields},null,2)+'\n');
