#!/bin/bash
# Agent B (Opus 5.5) — stage source + web edition into the site checkout (only Agent B paths are touched).
# usage: scripts/stage_repo.sh <render_iter_tag>
set -e
B=/root/real2sim/scene-20261113/agent-b; S=$B/repo/site; cd $B
TAG=${1:?tag}
I=$S/infra/real2sim/scene-20261113/agent-b; P=$S/public/real2sim/scene-20261113/agent-b
mkdir -p $I $P
rsync -a --delete --exclude __pycache__ cg scripts web docs $I/
mkdir -p $I/measurements $I/scenes
for f in world.json raster.json class_colors.json trees_refined.json rotunda_measured.json objects_measured.json road_profiles.json buildings_far_measured.json; do
  [ -f runs/layout/$f ] && cp runs/layout/$f $I/measurements/
done
cp scenes/scene_agentb.json $I/scenes/
cp assets/trees/trees_index.json $I/measurements/ ; cp assets/ground/ground_index.json $I/measurements/ ; cp assets/props/props_index.json $I/measurements/
cp logs/pip_freeze_da3.txt logs/pip_freeze_sam3.txt logs/blender_version.txt logs/input_sha256.txt $I/docs/ 2>/dev/null || true
cat > $I/.gitignore <<'EOF'
# Agent B: heavy/derived data stays on the server
*.blend
*.blend1
*.parts.npz
*_research.glb
envs/
cache/
runs/
frames/
EOF
# web edition
rm -rf $P/assets; envs/da3/bin/python cg/web/export_web.py $TAG
# evidence: same-camera comparisons (first + this iteration), novel-view videos, asset details
E=$P/evidence; mkdir -p $E
cp renders/compare/iter01/sheet.jpg $E/compare_iter01_sheet.jpg
cp renders/compare/$TAG/sheet.jpg $E/compare_${TAG}_sheet.jpg; cp renders/compare/$TAG/sheet.jpg $E/compare_latest_sheet.jpg
cp renders/compare/$TAG/metrics.json $E/compare_${TAG}_metrics.json
for v in orbit inner; do [ -f renders/novel/agentb_$v.mp4 ] && ffmpeg -v error -y -i renders/novel/agentb_$v.mp4 -c:v libx264 -crf 27 -preset slow -pix_fmt yuv420p -movflags +faststart $E/novel_$v.mp4; done
[ -f renders/details/details_sheet.jpg ] && cp renders/details/details_sheet.jpg $E/asset_details.jpg
cp renders/web_smoke/smoke.json $E/web_smoke.json 2>/dev/null || true
# integration patch for Agent A (NOT applied here): Agent A / Agent B switch inside the shared comparison tab
cd $S; cp app/page.tsx /tmp/page.orig.tsx
python3 - <<'PY'
p = "/tmp/page.new.tsx"; s = open("/tmp/page.orig.tsx").read()
old = "const source=`${import.meta.env.BASE_URL}real2sim/scene-20261113/agent-a/index.html`;"
new = "const [agent,setAgent]=useState<'agent-a'|'agent-b'>(()=>window.location.hash==='#comparison-b'?'agent-b':'agent-a');\n const source=`${import.meta.env.BASE_URL}real2sim/scene-20261113/${agent}/index.html`;"
assert old in s; s = s.replace(old, new)
old2 = "<p role=\"status\" aria-live=\"polite\" style={{margin:0}}>"
new2 = "<div role=\"group\" aria-label=\"选择重建结果\" style={{display:'flex',gap:'6px'}}>{([['agent-a','Agent A'],['agent-b','Agent B · Opus 5.5']] as const).map(([id,label])=><button key={id} className=\"subtle-button\" aria-pressed={agent===id} onClick={()=>{setLoaded(false);setAgent(id);}}>{label}</button>)}</div>\n   <p role=\"status\" aria-live=\"polite\" style={{margin:0}}>"
assert old2 in s; s = s.replace(old2, new2, 1)
open(p, "w").write(s)
PY
mkdir -p $I/integration
diff -u --label a/app/page.tsx --label b/app/page.tsx /tmp/page.orig.tsx /tmp/page.new.tsx > $I/integration/agent-b-comparison-switch.patch || true
echo "staged; web size: $(du -sh $P | cut -f1); infra size: $(du -sh $I | cut -f1)"
