import * as THREE from 'three';
import {soilMaterial} from './soil-material.ts';

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
 const surface=soilMaterial('#75634b',8191),material=surface.material;material.side=THREE.DoubleSide;
 const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;group.add(mesh);
 return {group,resize(radius:number){group.scale.set(radius,Math.min(.007,radius*.012),radius);group.position.y=0;surface.repeat(Math.max(.3,radius*4));},dispose(){geometry.dispose();material.dispose();for(const map of surface.textures)map.dispose();group.clear();}};
}
