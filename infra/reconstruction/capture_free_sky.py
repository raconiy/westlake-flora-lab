"""Precompute camera-calibrated sky distances for an actual multi-view visual hull."""
import argparse
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import distance_transform_edt
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('capture', type=Path)
ap.add_argument('output', type=Path)
args = ap.parse_args()
views = ('01', '03', '06', '09')
frame = json.loads((args.capture/'sfm/refined/asset-frame.json').read_text())
result = {}
for view in views:
    cam = next(c for k,c in frame['cameras'].items() if k.endswith('/'+view+'.jpg'))
    shape=(1024,768)
    photo=Image.open(args.capture/'sources'/(view+'.jpg')).convert('RGB').resize(shape,Image.Resampling.LANCZOS)
    r,g,b=np.moveaxis(np.asarray(photo,dtype=np.float32),-1,0)
    # Restrict to blue sky well above the actual building rooflines.
    yy=np.arange(768)[:,None]
    sky=(b-r>35)&(b-g>17)&(b>135)&(g>96)&(yy<320)
    sky[:3]=False;sky[:,:3]=False;sky[:,-3:]=False
    dist=distance_transform_edt(sky)
    result['sky_'+view]=np.clip(np.rint(dist*8),0,255).astype('u1')
    matrix=np.array(cam['matrixWorldThreeColumnMajor']).reshape(4,4).T.copy()
    matrix[:3,3]*=3.41
    result['matrix_'+view]=matrix
    scale=1024/cam['width']
    result['optics_'+view]=np.array([cam['fxPx']*scale,cam['fyPx']*scale,*np.array(cam['principalPointPx'])*scale,cam['normalizedSimpleRadialK']])
result['views']=np.array(views)
np.savez_compressed(args.output,**result)
