#!/bin/bash
# Agent B (Opus 5.5): build + preview selected trees next to their video reference crops
# usage: scripts/preview_trees.sh <tag> idx idx ...
B=/root/real2sim/scene-20261113/agent-b; cd $B; BL=envs/blender-4.5.3-linux-x64/blender; tag=$1; shift
ids=$(IFS=,; echo "$*"); envs/da3/bin/python cg/trees/build_trees.py $ids > /dev/null
i=0; for k in "$@"; do d=$(ls -d assets/trees/tree_$(printf %02d $k)_*); a=$(basename $d)
  (CUDA_VISIBLE_DEVICES=$((i % 8)) $BL -b --factory-startup -P cg/blender/build_assets.py -- $d/${a}_research.json > /dev/null 2>&1 && \
   CUDA_VISIBLE_DEVICES=$((i % 8)) $BL -b -P cg/blender/preview_asset.py -- renders/assets/${a}_$tag.png $d/${a}_research.blend 30 6 480 64 > /dev/null 2>&1) &
  i=$((i+1)); done; wait
envs/da3/bin/python - "$tag" "$@" <<'PY'
import sys, glob
from PIL import Image
tag, ids = sys.argv[1], sys.argv[2:]; tiles = []
for k in ids:
    r = Image.open(glob.glob(f"renders/assets/tree_{int(k):02d}_*_{tag}.png")[0]).convert("RGB"); r.thumbnail((360, 450))
    f = Image.open(f"runs/layout/tree_crops/tree_{int(k):02d}.jpg"); f.thumbnail((360, 450))
    t = Image.new("RGB", (720, 450), (20, 20, 20)); t.paste(f, (0, 0)); t.paste(r, (360, 0)); tiles.append(t)
s = Image.new("RGB", (720, 450 * len(tiles))); [s.paste(t, (0, 450 * i)) for i, t in enumerate(tiles)]
s.save(f"renders/assets/compare_{tag}.jpg", quality=88)
PY
