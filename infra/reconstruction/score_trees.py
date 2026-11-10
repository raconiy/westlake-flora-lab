"""Fixed camera comparison, with colour and occupancy measured independently."""
import sys, json, numpy as np
from pathlib import Path
from PIL import Image,ImageDraw
r=Path(sys.argv[1]);cap=Path(sys.argv[2]);dest=Path(sys.argv[3]);dest.mkdir(exist_ok=True,parents=True)
from registered_crown_masks import space,classify,SKY_BACKED_BOTTOM
SKY_BACKED_BOTTOM.update({'06':400,'10':400})
stats={}
board=Image.new('RGB',(1200,4*277),'white');draw=ImageDraw.Draw(board)
for index,cam in enumerate(['01','06','10','13']):
 photo,regions,safe=space(cam,cap); images={'reference':photo}
 for k in ['R5','R6']:images[k]=Image.open(r/(k+'-'+cam+'.png')).convert('RGB').resize(photo.size,Image.Resampling.LANCZOS)
 label={k:classify(im) for k,im in images.items()};raw={k:np.array(im,dtype='f4') for k,im in images.items()};count=sum(g.astype(int) for g in regions);stats[cam]={}
 for j,tree in enumerate(['foreground','middle','left']):
  valid=regions[j] & (count==1) & safe
  common=valid&~label['reference']['unknown']&~label['R5']['unknown']&~label['R6']['unknown']
  row={}
  for k in images:
   mask=label[k]['crown'];target=label['reference']['crown']
   row[k]={'skyShare':float(np.mean(label[k]['gap'][common])), 'iou':float(np.sum(common&mask&target)/max(1,np.sum(common&(mask|target))))}
   rgb=raw[k];green=(rgb[...,1]>23)&(rgb[...,1]>rgb[...,2]*1.12)
   q=common&mask&green
   row[k]['redToGreenMedian']=float(np.median(rgb[...,0][q]/np.maximum(1,rgb[...,1][q]))) if q.any() else None
   row[k]['commonKnownPixels']=int(common.sum())
  for k in ['R5','R6']:
   row[k]['skyAbsoluteError']=abs(row[k]['skyShare']-row['reference']['skyShare'])
   row[k]['chromaticAbsoluteError']=abs(row[k]['redToGreenMedian']-row['reference']['redToGreenMedian'])
  stats[cam][tree]=row
 for j,(label,im) in enumerate(images.items()):
  x=j*400;y=index*277
  board.paste(im.crop((0,0,1024,615)).resize((400,241)),(x,y+25))
  draw.text((x+5,y+7),cam+' / '+label,fill='black')
for key,views in [('training',['01','06']),('held',['10','13'])]:
 rows=[stats[v][t] for v in views for t in stats[v]]
 stats[key]={k:{col:float(np.mean([x[k][col] for x in rows])) for col in ['skyAbsoluteError','iou','chromaticAbsoluteError']} for k in ['R5','R6']}
(dest/'tree-score.json').write_text(json.dumps(stats,indent=2));board.save(dest/'crown-registered-comparison.jpg',quality=91)
print(json.dumps({k:stats[k] for k in ('training','held')},indent=2))
