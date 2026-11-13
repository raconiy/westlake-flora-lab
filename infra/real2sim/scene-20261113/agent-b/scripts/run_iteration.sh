#!/bin/bash
# Agent B (Opus 5.5) — full reproducible iteration: generate -> build assets -> assemble -> render video cameras -> compare.
# usage: scripts/run_iteration.sh <tag> [frames_csv] [spp] [skip_gen=0]
set -e
B=/root/real2sim/scene-20261113/agent-b; cd $B
PY=envs/da3/bin/python; BL=envs/blender-4.5.3-linux-x64/blender
TAG=${1:-iter}; FRAMES=${2:-"00010,00045,00090,00140,00190,00240,00290,00340,00390,00440,00490,00540,00590,00640,00690,00740,00790,00840"}; SPP=${3:-64}
if [ "${4:-0}" != "1" ]; then
  # generated region assets are fully reproducible: clear them so removed regions do not linger
  rm -rf assets/ground assets/web; find assets/buildings -maxdepth 1 \( -name "bldg_far_*" -o -name "bldg_near_*" \) -exec rm -rf {} +
  $PY cg/textures/gen_textures.py > logs/gen_textures.log 2>&1
  $PY cg/trees/build_trees.py > logs/build_trees.log 2>&1
  $PY cg/ground/build_ground.py > logs/build_ground.log 2>&1
  $PY cg/buildings/rotunda.py > logs/build_rotunda.log 2>&1
  for g in cg/buildings/gen_*.py cg/props/gen_*.py; do [ -f "$g" ] && $PY $g >> logs/build_misc.log 2>&1; done
  find assets -name "*_research.json" -o -name "*_web.json" | grep -v textures | sort > runs/asset_jsons.txt
  # parallel Blender builds (16 processes)
  cat runs/asset_jsons.txt | xargs -P 16 -n 6 sh -c "$BL -b --factory-startup -P cg/blender/build_assets.py -- \"\$@\" 2>&1 | grep -E 'BUILT|FAILED'" _ > logs/build_assets.log
  echo "built $(grep -c BUILT logs/build_assets.log) failed $(grep -c FAILED logs/build_assets.log || true)"
fi
$PY cg/scene/make_scene_config.py
$BL -b --factory-startup -P cg/blender/assemble_scene.py -- assemble research 2>&1 | grep -E "ASSEMBLED|MISSING|Error" || true
OUT=renders/compare/$TAG; mkdir -p $OUT/cg
IFS=, read -ra FR <<< "$FRAMES"; N=${#FR[@]}
for g in 0 1 2 3 4 5 6 7; do
  sub=$(for ((i=g; i<N; i+=8)); do printf "%s," ${FR[$i]}; done); sub=${sub%,}
  [ -z "$sub" ] && continue
  CUDA_VISIBLE_DEVICES=$g $BL -b -P cg/blender/assemble_scene.py -- render scenes/scene_agentb_research.blend $OUT/cg $sub $SPP 1.0 > logs/render_${TAG}_$g.log 2>&1 &
done; wait
$PY scripts/compare_sheet.py $OUT "$FRAMES"
echo "ITERATION $TAG DONE -> $OUT"
