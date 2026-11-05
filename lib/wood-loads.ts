import * as THREE from 'three';
export type WoodSection={a:[number,number,number];b:[number,number,number];areaA:number;areaB:number};
/** Build-time capture of actual tube cross-sections. These circular/polygon
 * frustum volume and transverse-area approximations include merged fine axes;
 * they are not a structural FEM or calibrated wood-density measurement. */
export function tagWoodTube<T extends THREE.BufferGeometry>(geometry:T,segments:number,sides:number):T{
 geometry.userData.woodTube={segments,sides};return geometry;
}
export function woodSections(geometry:THREE.BufferGeometry):WoodSection[]{
 if(Array.isArray(geometry.userData.woodSections))return geometry.userData.woodSections;
 const spec=geometry.userData.woodTube;
 if(spec){
  const p=geometry.attributes.position,{segments,sides}=spec,centres:THREE.Vector3[]=[],areas:number[]=[];
  for(let i=0;i<=segments;i++){
   const c=new THREE.Vector3();for(let j=0;j<sides;j++)c.add(new THREE.Vector3().fromBufferAttribute(p,i*(sides+1)+j));c.divideScalar(sides);centres.push(c);
   const cross=new THREE.Vector3();for(let j=0;j<sides;j++){const a=new THREE.Vector3().fromBufferAttribute(p,i*(sides+1)+j).sub(c),b=new THREE.Vector3().fromBufferAttribute(p,i*(sides+1)+(j+1)%sides).sub(c);cross.add(a.cross(b));}areas.push(cross.length()*.5);
  }
  return centres.slice(1).map((b,i)=>({a:centres[i].toArray(),b:b.toArray(),areaA:areas[i],areaB:areas[i+1]}));
 }
 if(geometry instanceof THREE.CylinderGeometry){
  // Read actual rings so baked translations/rotations/scales are respected.
  // Circle-equivalent area corrects the regular radial polygon approximation.
  const {radialSegments:n,heightSegments:h}=geometry.parameters,p=geometry.attributes.position;
  const ring=(offset:number)=>{const c=new THREE.Vector3(),v=Array.from({length:n},(_,j)=>new THREE.Vector3().fromBufferAttribute(p,offset+j));for(const q of v)c.add(q);c.divideScalar(n);const cross=new THREE.Vector3();for(let j=0;j<n;j++)cross.add(v[j].clone().sub(c).cross(v[(j+1)%n].clone().sub(c)));return {c,area:cross.length()*.5*(Math.PI/(n*.5*Math.sin(2*Math.PI/n)))};};
  const top=ring(0),bottom=ring(h*(n+1));
  return Array.from({length:12},(_,i)=>{const a=i/12,b=(i+1)/12,area=(t:number)=>(Math.sqrt(bottom.area)*(1-t)+Math.sqrt(top.area)*t)**2;return {a:bottom.c.clone().lerp(top.c,a).toArray(),b:bottom.c.clone().lerp(top.c,b).toArray(),areaA:area(a),areaB:area(b)};});
 }
 return [];
}
export function mergeWoodSections(parts:THREE.BufferGeometry[],merged:THREE.BufferGeometry){merged.userData.woodSections=parts.flatMap(woodSections);}
export function sectionVolume(section:WoodSection){return new THREE.Vector3().fromArray(section.a).distanceTo(new THREE.Vector3().fromArray(section.b))*(section.areaA+section.areaB+Math.sqrt(section.areaA*section.areaB))/3;}
