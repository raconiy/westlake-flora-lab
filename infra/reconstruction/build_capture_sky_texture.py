"""Encode the fitted sky as an sRGB latitude-longitude environment."""
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image

config, target = map(Path,sys.argv[1:])
fit=json.loads(config.read_text())
height,width=256,512
y,x=np.mgrid[0:height,0:width]
latitude=(.5-(y+.5)/height)*np.pi
longitude=((x+.5)/width-.5)*(2*np.pi)
ray=np.stack((np.cos(latitude)*np.cos(longitude),np.sin(latitude),
              np.cos(latitude)*np.sin(longitude)),axis=-1)
side=np.clip(np.einsum('ijk,k->ij',ray,fit['right']),*fit['azBounds'])
up=np.clip(ray[:,:,1],*fit['elevationBounds'])
features=np.stack((np.ones_like(up),side,up,up*up),axis=-1)
rgb=np.einsum('ijk,kl->ijl',features,np.array(fit['srgbDN']))
Image.fromarray(np.clip(np.rint(rgb),0,255).astype(np.uint8)).save(target)
