import * as THREE from 'three';
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Procedural morphology/artwork constrained by NCSU Iris tectorum: broad falls,
 * frilled white crests and ribbed blades. Dimensions/relief remain engineering
 * priors; texture pigment is not calibrated spectral reflectance. */
export function irisFallSurface(){
 const p:number[]=[],uv:number[]=[],ix:number[]=[],rows=28,cols=12;
 for(let r=0;r<=rows;r++){const t=r/rows,w=.024*Math.pow(Math.sin(t*Math.PI),.65)*(.38+.62*smooth(.12,.55,t));
  for(let c=0;c<=cols;c++){const u=c/cols*2-1,frill=.0015*Math.sin(t*47+u*3)*Math.abs(u)**5*Math.sin(t*Math.PI);
   p.push(u*w*(1+.055*Math.sin(t*51)*Math.abs(u)**4),t*.065,-.045*t*t+frill);uv.push(c/cols,t);
   if(r<rows&&c<cols){const a=r*(cols+1)+c;ix.push(a,a+cols+1,a+1,a+1,a+cols+1,a+cols+2);}
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}
export function irisCrestSurface(){
 const p:number[]=[],ix:number[]=[];for(let i=0;i<=18;i++){const t=.18+i/18*.47,w=.0016*Math.sin(i/18*Math.PI),z=-.045*t*t+.0012+(.0006+.0007*(i%2))*Math.sin(i/18*Math.PI);
  p.push(-w,t*.065,z,w,t*.065,z);if(i<18){const a=i*2;ix.push(a,a+2,a+1,a+1,a+2,a+3);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return g;
}
export function herbPigment(kind:'iris-fall'|'iris-blade'|'oxalis-blade'){
 const width=128,height=256,data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const u=x/(width-1)*2-1,t=y/(height-1);let r=1,g=1,b=1;
  if(kind==='iris-fall'){
   const patch=Math.exp(-Math.pow(u/(.24+.35*t),4))*smooth(.06,.24,t)*(1-smooth(.72,.94,t));
   const stripe=1-smooth(.06,.19,Math.abs(Math.sin(u*(19+8*t)+Math.sin(t*17)*.55)));
   r=.66+patch*.30-stripe*patch*.36;g=.56+patch*.37-stripe*patch*.41;b=.82+patch*.15-stripe*patch*.27;
  }else if(kind==='iris-blade'){const vein=(1-smooth(.04,.20,Math.abs(Math.sin(u*29))))*.10;const ridge=.055*Math.exp(-u*u*90);r=.85+ridge-vein;g=.96+ridge-vein;b=.76+ridge-vein;}
  else {const mid=1-smooth(.025,.075,Math.abs(u)),side=1-smooth(.035,.09,Math.abs(Math.sin((t-Math.abs(u)*.37)*35)));const vein=Math.max(mid,side*.55)*.14;r=.88+vein;g=.96+vein*.25;b=.83+vein;}
  const o=(y*width+x)*4;data[o]=Math.min(255,r*255);data[o+1]=Math.min(255,g*255);data[o+2]=Math.min(255,b*255);data[o+3]=255;
 }
 const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
