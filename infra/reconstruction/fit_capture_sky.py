"""Estimate a directional daylight background from one registered photograph.

Only clear, low-gradient sky windows contribute. The fit describes appearance,
not incident illumination. Extrapolation is bounded at the sampled elevations.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image

def directions(matrix, x, y, width, height):
    inv = np.linalg.inv(np.array(matrix).reshape((4,4),order='F'))
    clip = np.stack((2*(x+.5)/width-1, 1-2*(y+.5)/height, np.ones_like(x), np.ones_like(x)))
    far = inv @ clip
    clip[2] = -1
    near = inv @ clip
    ray = far[:3]/far[3] - near[:3]/near[3]
    return (ray/np.linalg.norm(ray,axis=0)).T

def main(photo, matrices, output):
    rgb = np.asarray(Image.open(photo).convert('RGB'),dtype=float)
    h,w = rgb.shape[:2]
    obs=[];coords=[]
    for y in range(12,int(.52*h),8):
        for x in range(12,w-12,8):
            block=rgb[y-4:y+5,x-4:x+5]
            color=np.median(block,axis=(0,1))
            if np.max(block.std(axis=(0,1))) < 3.5 and color[2]-color[0]>48 and color[1]-color[0]>14 and color[2]>185:
                obs.append(color);coords.append((x,y))
    if len(obs)<100:raise ValueError('Insufficient sky support')
    xy=np.array(coords); ray=directions(json.loads(matrices.read_text())['01'],*xy.T,w,h)
    center=ray.mean(axis=0); right=np.array([-center[2],0,center[0]])
    right/=np.linalg.norm(right)
    az=ray@right; e=ray[:,1]; features=np.column_stack((np.ones_like(e),az,e,e*e))
    mask=np.ones(len(obs),dtype=bool);obs=np.array(obs)
    for _ in range(4):
        weights=np.linalg.lstsq(features[mask],obs[mask],rcond=None)[0]
        err=np.max(np.abs(features@weights-obs),axis=1)
        mask=err<max(4,np.quantile(err,.88))
    output.write_text(json.dumps(dict(srgbDN=weights.round(5).tolist(),right=right.round(7).tolist(),
        azBounds=np.quantile(az[mask],[0,1]).tolist(),elevationBounds=np.quantile(e[mask],[0,1]).tolist(),
        fitCamera='01',windows=int(mask.sum())),indent=2)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for f in ('photo','matrices','output'):p.add_argument(f,type=Path)
    main(**vars(p.parse_args()))
