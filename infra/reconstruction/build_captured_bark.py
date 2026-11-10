"""Bake a cylindrical photograph-informed bark sample onto the existing native stem.

Camera 01 provides the visible side. The reverse side repeats the nearest visible
bark appearance. The high fork is extrapolated from the last clear lower-stem row.
"""
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, gaussian_filter

stem_file,photo_file,projection_file,output=map(Path,sys.argv[1:])
vertices=np.asarray(json.loads(stem_file.read_text())['vertices']).reshape(-1,24,3)
matrix=np.asarray(json.loads(projection_file.read_text())['01']).reshape(4,4,order='F')
photo=np.asarray(Image.open(photo_file).convert('RGB'),dtype=float)/255
centres=vertices.mean(axis=1)
heights=centres[:,2]
height,width=1024,512
samples=np.linspace(0,1,height)
u=np.linspace(0,1,width)
idx=np.clip(u*23,0,22.999999); left=idx.astype(int); blend=idx-left
coords=[]
for v in samples:
 z=min(4.32,v*heights[-1])
 k=np.clip(np.searchsorted(heights,z)-1,0,len(heights)-2)
 t=(z-heights[k])/(heights[k+1]-heights[k])
 ring=vertices[k]*(1-t)+vertices[k+1]*t
 points=ring[left]*(1-blend[:,None])+ring[left+1]*blend[:,None]
 # Project the physical lower stem to the capture. Mirror the unseen cylinder
 # angles into the visible bark area rather than sampling the surrounding lawn.
 px=np.column_stack((points[:,0],points[:,2],-points[:,1],np.ones(width)))@matrix.T
 x=(px[:,0]/px[:,3]+1)*512
 y=(1-px[:,1]/px[:,3])*384
 centre=np.append([centres[k,0],z,-centres[k,1]],1)@matrix.T
 cx=(centre[0]/centre[3]+1)*512
 x=cx+(x-cx)*.72
 coords.append((x,y))
coords=np.array(coords)
rgb=np.stack([map_coordinates(photo[:,:,c],[coords[:,1,:],coords[:,0,:]],order=1,mode='nearest') for c in range(3)],axis=-1)
assert rgb.shape == (height, width, 3), 'Projected bark must retain both texture dimensions'
# Approximate albedo compensation for the fixed display illumination. The texture
# remains diffuse; this multiplier is recorded, not treated as measured reflectance.
linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
linear=np.clip(linear*1.20,0,.88)
rgb=np.where(linear<=.0031308,12.92*linear,1.055*linear**(1/2.4)-.055)
Image.fromarray((rgb[::-1]*255).astype('uint8')).save(output)
