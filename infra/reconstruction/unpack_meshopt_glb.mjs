// Read source GLB, expand all Meshopt buffer views, preserve accessor definitions.
import fs from 'node:fs';import assert from 'node:assert/strict';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
const [source,target]=process.argv.slice(2);if(!source||!target||source===target)throw Error('Provide distinct input and output');
await MeshoptDecoder.ready;const input=fs.readFileSync(source),n=input.readUInt32LE(12),doc=JSON.parse(input.subarray(20,20+n)),bin=input.subarray(28+n),parts=[];let length=0;
for(const view of doc.bufferViews){
 const c=view.extensions?.EXT_meshopt_compression;let bytes;
 if(c){bytes=Buffer.alloc(c.count*c.byteStride);MeshoptDecoder.decodeGltfBuffer(bytes,c.count,c.byteStride,bin.subarray(c.byteOffset,c.byteOffset+c.byteLength),c.mode,c.filter);delete view.extensions.EXT_meshopt_compression;if(!Object.keys(view.extensions).length)delete view.extensions;}
 else {assert.equal(view.buffer,0);bytes=bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);}
 const pad=Buffer.alloc((4-length%4)%4);parts.push(pad,bytes);length+=pad.length;view.buffer=0;view.byteOffset=length;view.byteLength=bytes.length;length+=bytes.length;
}
parts.push(Buffer.alloc((4-length%4)%4));length+=(4-length%4)%4;doc.buffers=[{byteLength:length}];
for(const key of ['extensionsUsed','extensionsRequired'])if(doc[key])doc[key]=doc[key].filter(x=>x!=='EXT_meshopt_compression');
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const head=Buffer.alloc(20),bh=Buffer.alloc(8);head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+length,8);head.writeUInt32LE(json.length,12);head.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(length);bh.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(target,Buffer.concat([head,json,bh,...parts]));console.log(JSON.stringify({source,target,bytes:28+json.length+length,views:doc.bufferViews.length}));
