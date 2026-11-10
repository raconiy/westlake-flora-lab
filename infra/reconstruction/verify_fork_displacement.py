"""Overlay actual ring centers extracted from both Blender projects in camera pixels."""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageDraw,ImageOps
from registered_crown_masks import space,SKY_BACKED_BOTTOM
cap,baseline,new,fit_file,renders,dest=map(Path,sys.argv[1:])
base=json.loads(baseline.read_text()); geom=json.loads(new.read_text()); fits=json.loads(fit_file.read_text())
frame=json.loads((cap/'sfm/refined/asset-frame.json').read_text())['cameras']
report={};board=Image.new('RGB',(4*284,6*178),(246,245,240));labels=ImageDraw.Draw(board)
for vi,view in enumerate(['01','06']):
    SKY_BACKED_BOTTOM[view]=9999
    im,_,_=space(view,cap); src=[im,Image.open(renders/('R5-'+view+'.png')).convert('RGB').resize(im.size),Image.open(renders/('R6-'+view+'.png')).convert('RGB').resize(im.size)]
    cam=next(x for k,x in frame.items() if k.endswith('/'+view+'.jpg'));m=np.array(cam['matrixWorldThreeColumnMajor']).reshape(4,4).T.copy();m[:3,3]*=3.41
    def project(points):
        q=(points-m[:3,3])@m[:3,:3];return q[:,:2]/(-q[:,2:3])*[1,-1]*(cam['fxPx']*1024/cam['width'])+[512,384]
    for ti,limb in enumerate(fits['limbs']):
        tree=limb.rsplit('.wood.',1)[0];old=np.array(base[tree][limb]['points']);now=np.array(geom[tree][limb]['points'])
        a,b=project(old),project(now); overlay=im.copy();dd=ImageDraw.Draw(overlay)
        for line,color in [(a,(254,63,116)),(b,(10,221,215))]:
            dd.line(list(map(tuple,line)),fill=color,width=2)
            mid=line[len(line)//2];dd.ellipse((mid[0]-2,mid[1]-2,mid[0]+2,mid[1]+2),fill=color)
        mid=(a[len(a)//2]+b[len(b)//2])*.5
        maxx=min(1024,max(0,mid[0]-119)+238);maxy=min(768,max(0,mid[1]-64)+128)
        crop=tuple(round(k) for k in (maxx-238,maxy-128,maxx,maxy))
        r=vi*3+ti
        for j,(key,x) in enumerate(zip(['Photo', 'R5','R6', 'Old pink / new cyan'],src+[overlay])):
            board.paste(x.crop(crop).resize((280,151),Image.Resampling.LANCZOS),(j*284,r*178+21))
            labels.text((j*284+4,r*178+5),view+'  '+tree.replace('tree.','')+'  '+key,fill='black')
        shift=np.linalg.norm(old-now,axis=1);diff=np.linalg.norm(a-b,axis=1)
        report.setdefault(limb,{'maxCenterlineDisplacementM':float(shift.max()),'baseCenterDisplacementM':float(shift[0]),'distalCenterDisplacementM':float(shift[-1]),'views':{}})['views'][view]={'maxPx':float(diff.max()),'midPx':float(diff[len(diff)//2]),'evaluatedAtWidth':1024,'source':'actual ring-mean centres in before/after blend'}
board.save(dest/'fork-real-old-new.jpg',quality=94)
(dest/'fork-geometry-test.json').write_text(json.dumps(report,indent=2))
