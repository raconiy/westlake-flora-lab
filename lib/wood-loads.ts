import * as THREE from 'three';
type Point=[number,number,number];
export type WoodSection={a:Point;b:Point;areaA:number;areaB:number;ringA?:Point[];ringB?:Point[];ellipse?:boolean};
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
  const p=geometry.attributes.position,{segments,sides}=spec,centres:THREE.Vector3[]=[],areas:number[]=[],rings:Point[][]=[];
  for(let i=0;i<=segments;i++){
   const c=new THREE.Vector3();for(let j=0;j<sides;j++)c.add(new THREE.Vector3().fromBufferAttribute(p,i*(sides+1)+j));c.divideScalar(sides);centres.push(c);
   const ring=Array.from({length:sides},(_,j)=>new THREE.Vector3().fromBufferAttribute(p,i*(sides+1)+j).sub(c));rings.push(ring.map(v=>v.toArray()));
   const cross=new THREE.Vector3();for(let j=0;j<sides;j++)cross.add(ring[j].clone().cross(ring[(j+1)%sides]));areas.push(cross.length()*.5);
  }
  return centres.slice(1).map((b,i)=>({a:centres[i].toArray(),b:b.toArray(),areaA:areas[i],areaB:areas[i+1],ringA:rings[i],ringB:rings[i+1]}));
 }
 if(geometry instanceof THREE.CylinderGeometry){
  // Read actual rings so baked translations/rotations/scales are respected.
  // Circle-equivalent area corrects the regular radial polygon approximation.
  const {radialSegments:n,heightSegments:h}=geometry.parameters,p=geometry.attributes.position;
  const ring=(offset:number)=>{const c=new THREE.Vector3(),v=Array.from({length:n},(_,j)=>new THREE.Vector3().fromBufferAttribute(p,offset+j));for(const q of v)c.add(q);c.divideScalar(n);const cross=new THREE.Vector3();for(let j=0;j<n;j++)cross.add(v[j].clone().sub(c).cross(v[(j+1)%n].clone().sub(c)));const axisV=v[0].clone().sub(c),axisU=v[1].clone().sub(c).addScaledVector(axisV,-Math.cos(2*Math.PI/n)).divideScalar(Math.sin(2*Math.PI/n));return {c,axes:[axisU,axisV],area:cross.length()*.5*(Math.PI/(n*.5*Math.sin(2*Math.PI/n)))};};
  const top=ring(0),bottom=ring(h*(n+1));
  return Array.from({length:12},(_,i)=>{const a=i/12,b=(i+1)/12,area=(t:number)=>(Math.sqrt(bottom.area)*(1-t)+Math.sqrt(top.area)*t)**2,axes=(t:number)=>bottom.axes.map((v,j)=>v.clone().lerp(top.axes[j],t).toArray());return {a:bottom.c.clone().lerp(top.c,a).toArray(),b:bottom.c.clone().lerp(top.c,b).toArray(),areaA:area(a),areaB:area(b),ringA:axes(a),ringB:axes(b),ellipse:true};});
 }
 return [];
}
export function mergeWoodSections(parts:THREE.BufferGeometry[],merged:THREE.BufferGeometry){merged.userData.woodSections=parts.flatMap(woodSections);}
export function sectionVolume(section:WoodSection){return new THREE.Vector3().fromArray(section.a).distanceTo(new THREE.Vector3().fromArray(section.b))*(section.areaA+section.areaB+Math.sqrt(section.areaA*section.areaB))/3;}

/** Lateral projected area in m², excluding end caps and mutual sheltering.
 * Use transformed ring support widths, not a circle-equivalent diameter: that
 * diameter gives incorrect drag for anisotropically scaled/elliptical tubes.
 * Cylinder rings retain the same analytic-circle convention as their volume;
 * custom tubes retain their actual polygon. Old area-only records use a proxy. */
export function sectionProjectedArea(section:WoodSection,matrix:THREE.Matrix4,wind:THREE.Vector3){
 const a=new THREE.Vector3(...section.a).applyMatrix4(matrix),b=new THREE.Vector3(...section.b).applyMatrix4(matrix),axis=b.sub(a),length=axis.length();
 if(!(length>0))return 0;
 const across=new THREE.Vector3().crossVectors(axis.divideScalar(length),wind),sine=across.length();if(sine<1e-15)return 0;across.divideScalar(sine);
 const e=matrix.elements,ux=e[0]*across.x+e[1]*across.y+e[2]*across.z,uy=e[4]*across.x+e[5]*across.y+e[6]*across.z,uz=e[8]*across.x+e[9]*across.y+e[10]*across.z;
 const width=(ring:Point[])=>{let min=Infinity,max=-Infinity,squared=0;for(const p of ring){const projection=p[0]*ux+p[1]*uy+p[2]*uz;min=Math.min(min,projection);max=Math.max(max,projection);squared+=projection*projection;}return section.ellipse?2*Math.sqrt(squared):max-min;};
 if(section.ringA&&section.ringB)return length*sine*(width(section.ringA)+width(section.ringB))/2;
 const localLength=new THREE.Vector3(...section.a).distanceTo(new THREE.Vector3(...section.b)),scale=Math.abs(matrix.determinant())*localLength/length;
 return length*sine*(Math.sqrt(section.areaA*scale/Math.PI)+Math.sqrt(section.areaB*scale/Math.PI));
}

/** Integrate the owner's end-slope load factors (m²). Radius and centreline
 * position vary linearly within a frustum. Three-point Gauss quadrature is exact
 * for area(t)*arm(t)^2 (degree four); split where the lumped-owner arm clips.
 * This corrects midpoint bias, not the unsolved off-axis/tapered-EI mechanics. */
export function sectionArmFactors(section:WoodSection,armA:number,armB:number,ownerLength:number){
 const rA=Math.sqrt(section.areaA),rB=Math.sqrt(section.areaB),cuts=[0,1];
 if(armA!==armB)for(const limit of [0,ownerLength]){const t=(limit-armA)/(armB-armA);if(t>0&&t<1)cuts.push(t);}
 cuts.sort((a,b)=>a-b);
 let mass=0,drag=0;
 const nodes=[-Math.sqrt(3/5),0,Math.sqrt(3/5)],weights=[5/9,8/9,5/9];
 for(let i=1;i<cuts.length;i++){
  const half=(cuts[i]-cuts[i-1])/2,mid=(cuts[i]+cuts[i-1])/2;
  for(let j=0;j<3;j++){
   const t=mid+half*nodes[j],r=rA+(rB-rA)*t,arm=Math.max(0,Math.min(ownerLength,armA+(armB-armA)*t)),factor=half*weights[j]*arm*arm/2;
   mass+=r*r*factor;drag+=r*factor;
  }
 }
 const meanArea=(section.areaA+section.areaB+rA*rB)/3,meanRadius=(rA+rB)/2;
 return {mass:meanArea>0?mass/meanArea:0,drag:meanRadius>0?drag/meanRadius:0};
}
