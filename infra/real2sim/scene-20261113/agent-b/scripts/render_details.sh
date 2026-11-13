#!/bin/bash
# Agent B (Opus 5.5) — close-up look-dev renders of key independent assets (each from its own .blend).
B=/root/real2sim/scene-20261113/agent-b; cd $B; BL=envs/blender-4.5.3-linux-x64/blender; O=renders/details; mkdir -p $O
i=0
for spec in "buildings/bldg_rotunda 215 8" "buildings/bldg_rotunda 160 25" "trees/tree_22_camphor 30 6" "trees/tree_13_red_maple 30 6" \
            "trees/tree_40_broadleaf 30 6" "trees/tree_05_ginkgo_young 30 6" "trees/tree_02_purple_plum 30 6" "props/prop_lamp_lawn 30 10"; do
  set -- $spec; a=$(basename $1); f=assets/$1/${a}_research.blend
  CUDA_VISIBLE_DEVICES=$((i % 8)) $BL -b -P cg/blender/preview_asset.py -- $O/${a}_az$2.png $f $2 $3 900 96 > logs/detail_$i.log 2>&1 &
  i=$((i+1))
done; wait
envs/da3/bin/python - <<'PY'
from PIL import Image; import glob
fs = sorted(glob.glob("renders/details/*_az*.png")); ims = [Image.open(f).convert("RGB") for f in fs]
for im in ims: im.thumbnail((450, 560))
s = Image.new("RGB", (450 * 4, 560 * ((len(ims) + 3) // 4)), (235, 238, 232))
for k, im in enumerate(ims): s.paste(im, ((k % 4) * 450, (k // 4) * 560))
s.save("renders/details/details_sheet.jpg", quality=88); print(len(ims), "detail renders")
PY
