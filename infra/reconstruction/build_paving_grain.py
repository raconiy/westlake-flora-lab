"""Build a periodic neutral granite detail texture using spectrum from photographed paving tiles.

The source is registered, displayed photography, not measured material reflectance.
Only high-frequency texture is used. The broad blue shade belongs to the receiver light field.
"""
import argparse, hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

def build(pictures, out, info):
    donors = {'01':[(112,670),(290,692),(456,726)],'13':[(166,656),(478,698),(770,720)]}
    powers=[]; patches=[]; count=32; win=np.outer(np.hanning(count),np.hanning(count))
    for camera, places in donors.items():
        image=Image.open(pictures / ('photo-'+camera+'-registered.png')).convert('RGB')
        for x,y in places:
            part=np.asarray(image.crop((x,y,x+count,y+count)),float)@np.array([.2126,.7152,.0722])
            smooth=np.asarray(Image.fromarray(np.uint8(part)).filter(ImageFilter.GaussianBlur(2.8)),float)
            residual=part-smooth
            residual=np.clip(residual,*np.percentile(residual,[8,92]))
            residual-=residual.mean()
            powers.append(np.abs(np.fft.fft2(residual*win))**2)
            patches.append({'camera':camera,'pixels':[x,y,x+count,y+count]})
    # Ring averaging deliberately discards seam orientation. Match the measured power envelope
    # with a fixed phase field. The 1.2m UV repeat is an existing construction assumption.
    f=np.fft.fftfreq(count);radius=np.hypot(f[None,:],f[:,None]);bins=np.linspace(0,.72,19)
    power=np.mean(powers,axis=0);spectrum=np.array([np.mean(power[(radius>=a)&(radius<b)]) for a,b in zip(bins[:-1],bins[1:])])
    n=256;f=np.fft.fftfreq(n);target=np.hypot(f[None,:],f[:,None]);mag=np.sqrt(np.interp(target,(bins[:-1]+bins[1:])/2,spectrum))
    phase=np.fft.fft2(np.random.default_rng(6851).normal(size=(n,n)));noise=np.fft.ifft2(phase*mag/np.maximum(abs(phase),1e-8)).real
    noise=(noise-np.mean(noise))/max(noise.std(),1e-9)
    # Original granite texture median is retained; relative grain contrast is a rendering prior.
    rgb=np.clip(np.asarray([168,172,175])+11.5*np.clip(noise,-2.45,2.45)[:,:,None],0,255)
    Image.fromarray(np.uint8(np.rint(rgb))).save(out,quality=94,subsampling=0)
    info.write_text(json.dumps({'donors':patches,'fileSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'neutralMedianSrgb':[168,172,175],'grainStdSrgbPrior':11.5,'rngSeed':6851,'source':'Registered 01/13 foreground stone; clipped residual, radially averaged spectrum, deterministic random phase.'},indent=2)+'\n')
if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['registeredDir','texture','receipt']:parser.add_argument(name,type=Path)
    args=parser.parse_args();build(args.registeredDir,args.texture,args.receipt)
