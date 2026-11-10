"""Compare paired frozen renders using only source-designated sky-backed crown regions."""
import hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

W,H=1024,768
KEYS=('foreground','middle','left')
SKY_BACKED_BOTTOM={'01':575,'13':429}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def space(view, capture):
    CAP=Path(capture)
    FRAME=json.loads((CAP/'sfm/refined/asset-frame.json').read_text())
    POLYS=json.loads((CAP/'crowns/manual-rois.json').read_text())
    photo=Image.open(CAP/'sources'/(view+'.jpg')).convert('RGB'); pw,ph=photo.size
    cam=next(c for k,c in FRAME['cameras'].items() if k.endswith('/'+view+'.jpg'))
    yy,xx=np.mgrid[0:H,0:W]
    fx=cam['fxPx']*W/cam['width']
    x=(xx+.5-W/2)/fx;y=(yy+.5-H/2)/fx
    f=1+cam['normalizedSimpleRadialK']*(x*x+y*y)
    u=(cam['principalPointPx'][0]+cam['fxPx']*x*f)*pw/cam['width']-.5
    v=(cam['principalPointPx'][1]+cam['fyPx']*y*f)*ph/cam['height']-.5
    valid=(u>=0)&(v>=0)&(u<pw-1)&(v<ph-1)
    u0=np.floor(u).astype(int).clip(0,pw-2);v0=np.floor(v).astype(int).clip(0,ph-2)
    du=(u-u0)[:,:,None];dv=(v-v0)[:,:,None];src=np.asarray(photo)
    mapped=(1-dv)*((1-du)*src[v0,u0]+du*src[v0,u0+1])+dv*((1-du)*src[v0+1,u0]+du*src[v0+1,u0+1])
    mapped=np.uint8(np.clip(mapped,0,255));mapped[~valid]=[132,133,130]
    regions=[]
    for coords in POLYS[view]:
        tile=Image.new('1',(pw,ph));ImageDraw.Draw(tile).polygon([tuple(p) for p in coords],fill=1)
        reg=np.asarray(tile)[np.rint(v).astype(int).clip(0,ph-1),np.rint(u).astype(int).clip(0,pw-1)]
        regions.append(reg & valid)
    return Image.fromarray(mapped),regions,valid&(v<SKY_BACKED_BOTTOM[view])

def classify(im,lum_t=.65,high=.60,low=.27):
    R,G,B=np.moveaxis(np.asarray(im,dtype=np.float32),-1,0)
    anchors=[];positions=[]
    for y in range(20,324,24):
        ri,gi,bi=[p[y-7:y+8,int(.84*W):int(.94*W)] for p in (R,G,B)]
        use=(bi-ri>25)&(bi-gi>12)&(bi>145)
        if use.mean()<.75:continue
        anchors.append([np.median(a[use]) for a in (ri,gi,bi)]);positions.append(y)
    if len(positions)<9:raise ValueError('Insufficient unobstructed outer-right blue sky reference.')
    sr,sg,sb=[np.interp(np.arange(H),positions,np.array(anchors)[:,i])[:,None] for i in range(3)]
    purity=np.minimum((B-R)/np.maximum(sb-sr,15.),(B-G)/np.maximum(sb-sg,12.))
    bright=(purity>=high)&(B>=lum_t*sb)&(G>=.52*sg)
    woody=(purity<=low)|(B<=.45*sb)
    woody &=~bright
    return {'gap':bright,'crown':woody,'unknown':~(bright|woody)}
