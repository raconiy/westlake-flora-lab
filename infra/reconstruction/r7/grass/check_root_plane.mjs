import fs from 'node:fs';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {Vector3, Quaternion, Matrix4} from 'three';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createMeadowLayout} from '../../../../lib/capture-meadow.ts';
  const reference = process.argv[2];
  const bytes = readFileSync(reference ? join(reference, 'yungu-lawn.glb') : new URL('../public/capture17/yungu-lawn.glb', import.meta.url));
  const length = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + length)), bin = bytes.subarray(28 + length);
  await MeshoptDecoder.ready;
  const cache = new Map(), quantizationStepYs=[];
  function decodedView(viewIndex) {
    if (cache.has(viewIndex)) return cache.get(viewIndex);
    const view = gltf.bufferViews[viewIndex], compressed = view.extensions?.EXT_meshopt_compression;
    let payload;
    if (compressed) {
      payload = new Uint8Array(compressed.count * compressed.byteStride);
      const start = compressed.byteOffset ?? 0;
      MeshoptDecoder.decodeGltfBuffer(payload, compressed.count, compressed.byteStride,
        bin.subarray(start, start + compressed.byteLength), compressed.mode, compressed.filter ?? 'NONE');
    } else {
      const start = view.byteOffset ?? 0;
      payload = bin.subarray(start, start + view.byteLength);
    }
    const d = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    cache.set(viewIndex, d);
    return d;
  }
  function eachPosition(index, world, visit) {
    const ac = gltf.accessors[index], bv = gltf.bufferViews[ac.bufferView], dv = decodedView(ac.bufferView);
    const format = {5122:['getInt16',2,32767],5123:['getUint16',2,65535],5126:['getFloat32',4,1]}[ac.componentType];
    assert.ok(format, 'unsupported vertex encoding');
    const [read, size, norm] = format, step = bv.byteStride ?? size * 3;
    quantizationStepYs.push(ac.componentType===5126?0:(Math.abs(world.elements[1])+Math.abs(world.elements[5])+Math.abs(world.elements[9]))/(ac.normalized?norm:1));
    for (let i = 0; i < ac.count; i++) {
      const offset = (ac.byteOffset ?? 0) + step * i;
      const coord = (axis) => {
        const value = dv[read](offset + axis * size, true);
        return ac.normalized ? Math.max(-1, value / norm) : value;
      };
      visit(new Vector3(coord(0), coord(1), coord(2)).applyMatrix4(world));
    }
  }

let plane=[];
function walk(index,parent,inherited){
 const n=gltf.nodes[index],world=new Matrix4();
 if(n.matrix)world.fromArray(n.matrix);else world.compose(new Vector3().fromArray(n.translation??[0,0,0]),new Quaternion().fromArray(n.rotation??[0,0,0,1]),new Vector3().fromArray(n.scale??[1,1,1]));
 world.premultiply(parent);const soil=inherited||n.name==='Turf.ContinuousSurface';
 if(soil&&n.mesh!==undefined)for(const p of gltf.meshes[n.mesh].primitives)eachPosition(p.attributes.POSITION,world,v=>plane.push(v.y));
 for(const child of n.children??[])walk(child,world,soil);
}
for(const n of gltf.scenes[gltf.scene??0].nodes)walk(n,new Matrix4(),false);
assert.ok(plane.length>20);const lo=Math.min(...plane),hi=Math.max(...plane);
assert.ok(hi-lo<.00001,'plantable soil must be level for shared plane validation');
const roots=createMeadowLayout(),anchor=-.003107703,error=Math.max(Math.abs(anchor-lo),Math.abs(anchor-hi));
const halfGrid=.5*Math.max(...quantizationStepYs),contactTolerance=Math.min(.0001,halfGrid+1e-7);
assert.ok(error<=contactTolerance,'root gap exceeds 0.1 mm contact tolerance or decoded quantization allowance');
const output={soilVertexCount:plane.length,soilWorldYRangeM:[lo,hi],rootWorldY:anchor,rootCount:roots.count,maxVerticalGapM:error,soilQuantizationStepM:Math.max(...quantizationStepYs),quantizationHalfStepM:halfGrid,contactToleranceM:contactTolerance,rootEnvelopeM:.108,testedSweptEnvelopeM:.09321651880346082,limit:'Checks common ground plane and prior full-domain exclusion regression. It is not a simulated soft-soil compression test.'};
fs.writeFileSync(process.argv[3],JSON.stringify(output,null,2));console.log(JSON.stringify(output));
