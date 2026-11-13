#!/bin/bash
# Agent B (Opus 5.5) environment setup — clones existing read-only conda envs into agent-b/envs
# (direct pip/pytorch downloads are too slow on this host; torch 2.8.0+cu128 supports sm_120 / RTX 5090)
set -e
B=/root/real2sim/scene-20261113/agent-b
C=/root/miniconda3/bin/conda
export PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ PIP_DEFAULT_TIMEOUT=120 PIP_CACHE_DIR=$B/cache/pip
[ -d $B/envs/da3 ] || $C create -y -p $B/envs/da3 --clone grase-da3 --offline
[ -d $B/envs/sam3 ] || $C create -y -p $B/envs/sam3 --clone grase-sam3 --offline
$B/envs/da3/bin/pip install trimesh shapely scikit-image scikit-learn pygltflib tqdm
$B/envs/da3/bin/pip freeze > $B/logs/pip_freeze_da3.txt
$B/envs/sam3/bin/pip freeze > $B/logs/pip_freeze_sam3.txt
$B/envs/blender-4.5.3-linux-x64/blender --version | head -1 > $B/logs/blender_version.txt
echo ENV_OK
