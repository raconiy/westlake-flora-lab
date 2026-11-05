import * as THREE from 'three';

/** Deterministic visual aggregate prior, not a sampled campus soil. Colour,
 * height and roughness are separate signals; height is millimetre-scale relief.
 * Periodic multi-scale noise avoids the previous regular sine/grid pattern. */
export function soilMaterial(baseColor:string,seed:number,size=256){
 const base=new THREE.Color(baseColor).convertLinearToSRGB(),colour=new Uint8Array(size*size*4),height=new Uint8Array(size*size*4),rough=new Uint8Array(size*size*4);
 const hash=(x:number,y:number)=>{let n=Math.imul(x+seed,374761393)^Math.imul(y+31,668265263);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;};
 const fade=(x:number)=>x*x*x*(x*(x*6-15)+10);
 function noise(u:number,v:number,n:number){const x=u*n,y=v*n,ix=Math.floor(x),iy=Math.floor(y),a=fade(x-ix),b=fade(y-iy),h=(dx:number,dy:number)=>hash(((ix+dx)%n+n)%n,((iy+dy)%n+n)%n);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(0,0),h(1,0),a),THREE.MathUtils.lerp(h(0,1),h(1,1),a),b);}
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size,broad=noise(u,v,4),aggregate=noise(u,v,26),grain=noise(u,v,83),pore=Math.max(0,(.34-grain)/.34),mineral=Math.max(0,(aggregate-.66)/.34);
  const tone=.64+.34*broad+.24*aggregate+.12*grain-.25*pore,o=(y*size+x)*4;
  colour[o]=Math.min(255,255*base.r*tone+24*mineral);colour[o+1]=Math.min(255,255*base.g*tone+24*mineral);colour[o+2]=Math.min(255,255*base.b*tone+22*mineral);colour[o+3]=255;
  const relief=Math.round(255*THREE.MathUtils.clamp(.1+.48*aggregate+.32*grain-.3*pore,0,1));
  height[o]=height[o+1]=height[o+2]=relief;height[o+3]=255;
  rough[o]=rough[o+1]=rough[o+2]=Math.round(255*(.86+.14*grain));rough[o+3]=255;
 }
 function texture(data:Uint8Array,srgb=false){const t=new THREE.DataTexture(data,size,size);if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=8;t.needsUpdate=true;return t;}
 const map=texture(colour,true),bumpMap=texture(height),roughnessMap=texture(rough);
 const material=new THREE.MeshStandardMaterial({map,bumpMap,roughnessMap,bumpScale:.0015,roughness:1});
 return {material,textures:[map,bumpMap,roughnessMap],repeat(value:number){for(const t of [map,bumpMap,roughnessMap])t.repeat.setScalar(value);}};
}
