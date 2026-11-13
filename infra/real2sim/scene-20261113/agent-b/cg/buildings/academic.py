"""Measured-guided academic ribbon building for Agent B.
The long glazed block is a separate asset. Its placement follows the near building evidence
centroid; floor count, rear depth and unseen elevations are conservative inferences.
"""
import json, pathlib, sys, numpy as np
HERE=pathlib.Path(__file__).resolve().parent; sys.path.insert(0,str(HERE.parent))
from common.meshio import Part, save_parts, box
B=HERE.parents[1]; OUT=B/"assets/buildings"; AID="bldg_academic_block"; P=np.array([0.0,130.0,0.0])

def addbox(part, center, size, mat, uv=1.0):
    v,f,u=box(*center,*size,uvscale=uv); part.add(v,f,u)

def build():
    parts=[]
    base=Part("plinth","white_stone"); addbox(base,(0,0,0.38),(84,16.0,.76),"white_stone",.4); parts.append((base,None,(0,0,0)))
    glass=Part("glazing_bands","glass_far"); mull=Part("mullions","metal_light"); slabs=Part("floor_slabs","white_stone")
    bands=[(0.85,3.20),(3.80,6.15),(6.75,9.10),(9.70,12.05),(12.65,15.0)]
    for z0,z1 in bands:
        addbox(glass,(0,-7.08,(z0+z1)/2),(82,.16,z1-z0),"glass_far",3.0)
        addbox(glass,(0,7.08,(z0+z1)/2),(82,.16,z1-z0),"glass_far",3.0)
        addbox(slabs,(0,0,z0-.12),(84,16.6,.26),"white_stone",1.0)
        for x in np.linspace(-39.5,39.5,28):
            addbox(mull,(float(x),-7.22,(z0+z1)/2),(.14,.18,z1-z0+.18),"metal_light",.2)
            addbox(mull,(float(x),7.22,(z0+z1)/2),(.14,.18,z1-z0+.18),"metal_light",.2)
    roof=Part("roof_fascia","white_stone"); addbox(roof,(0,0,15.72),(84.8,16.8,.72),"white_stone",.6); addbox(roof,(0,0,16.15),(83.4,15.8,.22),"grey_stone",.6); parts.extend([(glass,None,(0,0,0)),(slabs,None,(0,0,0)),(mull,None,(0,0,0)),(roof,None,(0,0,0))])
    end=Part("end_walls","white_stone")
    for x in (-41.0,41.0): addbox(end,(x,0,8.2),(.38,16.2,15.8),"white_stone",.5)
    # recessed end glazing and vertical frames
    eg=Part("end_glazing","glass_far"); ef=Part("end_frames","metal_light")
    for x in (-41.22,41.22):
        addbox(eg,(x,0,8.3),(.08,14.2,14.4),"glass_far",2.5)
        for y in np.linspace(-6.0,6.0,6): addbox(ef,(x + (-.08 if x<0 else .08),float(y),8.3),(.16,.12,14.5),"metal_light",.2)
    parts.extend([(end,None,(0,0,0)),(eg,None,(0,0,0)),(ef,None,(0,0,0))])
    meta=dict(asset_id=AID,category="building",generator="cg/buildings/academic.py",pivot="centre of footprint at ground, +Z up, metres",world_pivot=P.tolist(),measured=dict(centroid=P.tolist(),facade_height_m=16.4,footprint_m=[84,16]),inferred=["floor count and rear depth inferred from Agent A comparison and visible video bands","far elevation and interior unseen","straight ribbon plan approximates the curved academic block visible in video"])
    d=OUT/AID; d.mkdir(parents=True,exist_ok=True)
    for lod in ("research","web"): save_parts(d/f"{AID}_{lod}",parts,dict(meta,lod=lod))
    print(AID,"parts",[x[0].name for x in parts],"faces",sum(len(x[0].arrays()["F"]) for x in parts))
if __name__=="__main__": build()
