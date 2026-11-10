"""Create a periodic, metre-mapped turf reflectance field from the registered Yungu imagery."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

N = 3072
PERIOD_M = 44.0
SEED = 147173
# Clear regions of the original 1707x1280 photograph. Only illumination-normalized
# fine texture enters the quilt, never the photographed shadow or soil object footprint.
CROPS = [(518,1007,626,1061),(647,1030,758,1082),(1031,929,1155,954),
         (1104,1013,1243,1045),(1301,1031,1439,1061),(1053,1118,1211,1157)]
def linear(a):
    a=np.asarray(a,dtype=np.float32)/255.
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def srgb(a):
    return np.uint8(np.clip(255*np.where(a<=.0031308,a*12.92,1.055*np.maximum(a,0)**(1/2.4)-.055)+.5,0,255))
def smoothstep(x):
    t=np.clip(x,0.,1.)
    return t*t*(3.-2.*t)
def lowpass(a,sigma):
    radius=int(np.ceil(sigma*3));x=np.arange(-radius,radius+1)
    ker=np.exp(-.5*(x/sigma)**2);ker/=ker.sum()
    for axis in (0,1):
        a=np.apply_along_axis(lambda v:np.convolve(np.pad(v,radius,'reflect'),ker,'valid'),axis,a)
    return a.astype('f')
def normalized_crops(photo):
    originals=[];records=[]
    for bounds in CROPS:
        rgb=linear(photo.crop(bounds))
        y=rgb@np.array([.2126,.7152,.0722],dtype=np.float32)
        log=np.log(np.maximum(y,.004))
        grain=log-lowpass(log,4.)
        grain=np.clip(grain,*np.quantile(grain,[.015,.985]))
        grain-=np.mean(grain)
        originals.append(grain)
        records.append({'xyxy':bounds,'sourceLinearYMedian':float(np.median(y)),'logHighpassStandardDeviation':float(grain.std())})
    return originals,records
def quilt(patches,rng):
    # Offset, reflect, rotate and cross-fade many small measured texture fragments.
    # Neighbourhoods wrap on both axes, including the samples supporting the outer edge.
    step=16;side=2*step
    weight=np.sin(np.pi*(np.arange(side)+.5)/side)**2
    window=np.outer(weight,weight).astype('f')
    big=np.zeros((N+side,N+side),np.float32)
    for y in range(0,N,step):
        for x in range(0,N,step):
            grain=patches[rng.integers(len(patches))]
            # Wrap the thin source strips locally. Each source proposal is smaller than a real lawn mark.
            oy=rng.integers(grain.shape[0]);ox=rng.integers(grain.shape[1])
            patch=grain[np.ix_((oy+np.arange(side))%grain.shape[0],(ox+np.arange(side))%grain.shape[1])]
            patch=np.rot90(patch,int(rng.integers(4)))
            if rng.random()<.5:patch=patch[:,::-1]
            big[y:y+side,x:x+side]+=patch*window
    big[:side,:]+=big[N:N+side,:]
    big[:,:side]+=big[:,N:N+side]
    return big[:N,:N]
def macro_field(n,rng):
    grid=rng.uniform(-1.,1.,(n,n)).astype('f')
    u=(np.arange(N,dtype=np.float32)+.5)*(n/N)
    a=np.floor(u).astype(int);b=(a+1)%n;w=smoothstep(u-a).astype('f')
    rows=grid[:,a]*(1.-w)+grid[:,b]*w
    return rows[a]*(1.-w[:,None])+rows[b]*w[:,None]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def build(photo_file,registered_file,coverage_file,output):
    out=Path(output);out.mkdir(exist_ok=True,parents=True)
    rng=np.random.default_rng(SEED)
    photo=Image.open(photo_file).convert('RGB');assert photo.size==(1707,1280)
    reg=Image.open(registered_file).convert('RGB')
    cover=np.asarray(Image.open(coverage_file).convert('RGB'))
    # Dark background in the archived coverage legend denotes no accepted camera.
    accepted=np.any(cover!=np.array([17,23,31]),axis=-1)
    confidence=Image.fromarray(np.uint8(accepted)*255).filter(ImageFilter.GaussianBlur(6))
    near=np.array(reg.resize(cover.shape[1::-1],Image.Resampling.BOX))
    obs=linear(near[accepted]);unknown=linear(near[~accepted])
    common=np.median(unknown,axis=0)
    gain=np.clip(common/np.median(obs,axis=0),.8,1.25).astype('f')
    patches,crop_log=normalized_crops(photo)
    grain=quilt(patches,rng)
    # Three aperiodic-looking spatial scales inside one seamless 44 m repeat.
    grain*=.83
    for frequency,amp in ((5,.074),(13,.047),(47,.027)):
        grain+=macro_field(frequency,rng)*amp
    variation=np.exp(grain);del grain
    conf=np.asarray(confidence.resize((N,N),Image.Resampling.BILINEAR),dtype=np.float32)/255.
    nearest=np.minimum(np.arange(N)+.5,N-np.arange(N)-.5)*PERIOD_M/N
    weight=smoothstep(np.minimum(nearest[:,None],nearest[None,:])/3.).astype('f')*conf
    # The five-role tone rule preserves black and white and leaves uncertain matches untouched.
    gain_t=smoothstep((conf-.5)*2).astype('f')
    outpic=np.zeros((N,N,3),np.uint8)
    for c in range(3):
        measured=linear(reg.getchannel(c).resize((512,512),Image.Resampling.BOX).resize((N,N),Image.Resampling.BICUBIC))
        f=(gain[c]-1)*gain_t
        adjusted=measured*(1+f)/(1+measured*f)
        diffuse=(common[c]+weight*(adjusted-common[c]))*variation
        outpic[:,:,c]=srgb(diffuse)
    dest=out/'yungu-turf-world.jpg';Image.fromarray(outpic).save(dest,quality=92,subsampling=0,optimize=True)
    report={'sourcePhotoSha256':sha(photo_file),'registeredAtlasSha256':sha(registered_file),'observedCoverageSha256':sha(coverage_file),
            'outputSha256':sha(dest),'sampleCrops':crop_log,'observedFractionAtMaskResolution':float(accepted.mean()),
            'world':{'blenderXYMetresRectangle':[-20,-10,24,34],'periodM':PERIOD_M,'nominalMetresPerTexel':PERIOD_M/N,'wrap':'repeat on both axes, identical continuous field across every mesh and material ID'},
            'rendering':'Diffuse reflectance only. Captured foreground incident-light vertex multiplier and real-time geometry shadows remain separate.',
            'feather':{'policy':'lawn_feather: confidence * smoothstep(clamp(distance/width))','edgeWidthM':3,'confidence':'Gaussian-smoothed spatial support from the archived observation mask'},
            'tone':{'policy':'lawn_shade on linear reflectance, identity at 0 and 1','channelGains':gain.tolist(),'reference':'Median same-material unobserved infill matched to robust measured pixels, corrected only above 0.5 support.'},
            'priors':'Lamp-based metre scale, blending widths, spatial frequencies and microsurface outside observations are rendering assumptions. Blade geometry is supplied separately.',
            'source':{'size':list(photo.size),'color':'Original RGB; log-luminance residuals from six visually inspected turf-only patches. No direct rebake of tree shadows.'},
            'seed':SEED,'resolution':N,'medianNeutralBaseLinear':common.tolist()}
    (out/'reflectance-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('photo',type=Path);ap.add_argument('registered_atlas',type=Path);ap.add_argument('coverage',type=Path);ap.add_argument('out',type=Path)
    a=ap.parse_args();build(a.photo,a.registered_atlas,a.coverage,a.out)
