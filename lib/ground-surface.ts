import * as THREE from 'three';

/** A soil surface in metres, with relief kept at millimetre scale.
 * This is a visual substrate, not a measured campus soil or hydraulic model. */
export function createGroundSurface(){
 const group=new THREE.Group();group.name='soil-surface:visual-substrate';
 const rings=22,segments=128,positions:number[]=[],uvs:number[]=[],indices:number[]=[];
 for(let j=0;j<=rings;j++)for(let i=0;i<=segments;i++){
  const a=i/segments*Math.PI*2,r=j/rings;
  const edge=1+.021*Math.sin(a*7)+.014*Math.cos(a*13);
  const x=r*Math.cos(a)*edge,z=r*Math.sin(a)*edge;
  positions.push(x,(Math.sin(x*61+z*23)*Math.sin(z*47-x*17)*.35+Math.sin(x*14+z*18)*.65)*(1-r*r),z);uvs.push((x+1)/2,(z+1)/2);
  if(j<rings&&i<segments){const k=j*(segments+1)+i;indices.push(k,k+1,k+segments+1,k+1,k+segments+2,k+segments+1);}
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
 let state=8191;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const size=256,pixels=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const grain=random(),coarse=Math.sin(x*.17+Math.sin(y*.12)*2)*Math.sin(y*.21),fleck=grain>.975?1.45:grain<.035?.52:1;
  const tone=(.88+.26*grain+.08*coarse)*fleck,o=(y*size+x)*4;
  pixels[o]=111*tone;pixels[o+1]=94*tone;pixels[o+2]=67*tone;pixels[o+3]=255;
 }
 const map=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.anisotropy=8;map.needsUpdate=true;
 const material=new THREE.MeshStandardMaterial({map,bumpMap:map,bumpScale:.0015,roughness:1,side:THREE.DoubleSide});
 const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;group.add(mesh);
 return {group,resize(radius:number){group.scale.set(radius,Math.min(.007,radius*.012),radius);group.position.y=-Math.min(.004,radius*.006);map.repeat.setScalar(Math.max(.3,radius*4));},dispose(){geometry.dispose();material.dispose();map.dispose();group.clear();}};
}
