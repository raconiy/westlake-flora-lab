#!/bin/bash
# Agent B (Opus 5.5) — render the two novel-view paths on all GPUs and encode mp4s.
# usage: scripts/render_novel.sh [n_frames=180] [spp=32]
B=/root/real2sim/scene-20261113/agent-b; cd $B; BL=envs/blender-4.5.3-linux-x64/blender
N=${1:-180}; SPP=${2:-32}; S=scenes/scene_agentb_research.blend
for P in orbit inner; do
  O=renders/novel/$P; mkdir -p $O; per=$(( (N + 7) / 8 ))
  for g in 0 1 2 3 4 5 6 7; do
    CUDA_VISIBLE_DEVICES=$g $BL -b -P cg/blender/render_flythrough.py -- $S $P $O $((g*per)) $(((g+1)*per)) $N $SPP > logs/novel_${P}_$g.log 2>&1 &
  done; wait
  ffmpeg -v error -y -framerate 24 -i $O/%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 renders/novel/agentb_${P}.mp4
  echo "novel $P: $(ls $O | wc -l) frames -> renders/novel/agentb_${P}.mp4"
done
