import sys, numpy as np
from PIL import Image
PAL = np.array([[0,0,0],[120,180,255],[200,60,200],[60,200,60],[200,200,200],[60,60,60],[255,160,0],[0,110,0],[255,255,0],[255,0,0],[0,200,255],[255,120,200],[140,90,40]],np.uint8)
im = np.asarray(Image.open(sys.argv[1]).convert("RGB")); lab = np.asarray(Image.open(sys.argv[2]))
o = (0.45*im + 0.55*PAL[lab]).astype(np.uint8)
Image.fromarray(np.concatenate([im, o], 1)).save(sys.argv[3])
