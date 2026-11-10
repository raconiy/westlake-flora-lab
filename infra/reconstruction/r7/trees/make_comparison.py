from pathlib import Path
from PIL import Image,ImageDraw
import json
root=Path('/tmp/yungu-scene-r7/trees');dst=root/'comparison';dst.mkdir(exist_ok=True)
for cam in ['01','06','10','13']:
 paths=[Path('/tmp/yungu-scene-r6/registered')/('photo-'+cam+'.png'),Path('/tmp/yungu-scene-r6/native-render/final')/('final-'+cam+'.png'),root/'render/Cguard'/('final-'+cam+'.png')]
 board=Image.new('RGB',(1536,415),'white');d=ImageDraw.Draw(board)
 for i,(label,path) in enumerate(zip(['Photo registered '+cam,'Published R6 native','Cguard native, not accepted'],paths)):
  im=Image.open(path).convert('RGB').resize((512,384),Image.Resampling.LANCZOS);board.paste(im,(i*512,28));d.text((i*512+8,8),label,fill='black')
 board.save(dst/('compare-'+cam+'.jpg'),quality=93)
