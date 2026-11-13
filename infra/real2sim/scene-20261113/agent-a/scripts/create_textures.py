
# Portable package root; override only when using another runtime directory.
import os as _real2sim_os
from pathlib import Path as _Real2SimPath
_REAL2SIM_ROOT = _Real2SimPath(_real2sim_os.environ.get(
    'REAL2SIM_ROOT', str(_Real2SimPath(__file__).resolve().parents[1])
)).expanduser().resolve()

import numpy as np
from PIL import Image, ImageFilter
from pathlib import Path
r=Path(str(_REAL2SIM_ROOT / 'assets/textures'));r.mkdir(parents=True,exist_ok=True)
rng=np.random.default_rng(1132026);n=1024

def fbm(scales):
    out=np.zeros((n,n))
    for size,weight in scales:
        a=(rng.random((size,size))*255).astype('uint8')
        out+=np.array(Image.fromarray(a).resize((n,n),Image.Resampling.BICUBIC),dtype=float)/255*weight
    out-=out.mean();return out
fine=rng.normal(0,1,(n,n));cloud=fbm([(5,1),(17,.45),(61,.23),(240,.1)])
for name,base,amplitude,grain in [('limestone',[179,180,175],30,5),('concrete',[181,184,180],18,2),('asphalt',[65,66,63],12,7),('grass',[58,88,33],28,8),('bark',[107,104,91],40,10)]:
    tex=np.zeros((n,n,3))+base
    tex+=(cloud*amplitude+fine*grain)[...,None]
    if name=='limestone':
        dark=(rng.random((n,n))>.98)*rng.uniform(5,30,(n,n));tex-=dark[...,None]
    if name=='grass':
        tex[:,:,1]+=rng.normal(0,4,(n,n));tex[:,:,0]-=4
    if name=='bark':
        ridges=fbm([(80,.8),(230,.3)])
        vertical=np.array(Image.fromarray(np.uint8((ridges-ridges.min())/(ridges.max()-ridges.min())*255)).resize((n,64)).resize((n,n),Image.Resampling.BILINEAR))/255
        tex+=(vertical-.5)[...,None]*45
    Image.fromarray(np.uint8(np.clip(tex,0,255))).save(r/(name+'.jpg'),quality=93)
    rough=np.clip(215+cloud*40+fine*3,0,255).astype('uint8');Image.fromarray(rough).save(r/(name+'-roughness.jpg'),quality=88)
print('TEXTURES_READY')

# Procedural low-contrast cloud lighting, explicitly not a reconstructed sky map.
w,h=2048,1024
noise=np.zeros((h,w),dtype=float)
for s,weight in [(5,1),(11,.55),(25,.27),(65,.12),(140,.06)]:
    cells=rng.random((s,s*2))
    cells[:,-1]=cells[:,0]
    a=Image.fromarray(np.uint8(cells*255)).resize((w,h),Image.Resampling.BICUBIC)
    noise+=np.asarray(a,dtype=float)/255*weight
noise=(noise-noise.mean())/noise.std()
clouds=np.clip((noise+.65)/1.8,0,1)
elevation=np.cos(np.linspace(0,np.pi,h))[:,None]
sky=np.empty((h,w,3))
for k,(clear,cloud,horizon) in enumerate(zip([126,159,181],[221,225,226],[209,216,219])):
    val=clear*(1-clouds)+cloud*clouds
    fade=np.clip(1-np.maximum(elevation,0)*2,0,1)*.72
    val=val*(1-fade)+horizon*fade
    groundmix=np.clip(-elevation*8,0,1)
    sky[:,:,k]=val*(1-groundmix)+(85 if k==1 else 80)*groundmix
Image.fromarray(np.uint8(np.clip(sky,0,255))).save(r/'environment.jpg',quality=93)
print('PROCEDURAL_ENVIRONMENT_READY')
