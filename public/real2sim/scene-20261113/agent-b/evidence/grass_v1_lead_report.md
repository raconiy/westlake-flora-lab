# Grass realism refine — lead report (Agent 2 worktree, 2026-11-14)
Status: integrated in this worktree only, NOT committed, web NOT exported. Awaiting review.
Team evidence: /tmp/real2sim-grass-team/{foliage,boundary,camera}/ (proposal.md, review.md, *.json, crops).
Before = runs/a2_appearance/compare_final (A2 final). After = runs/a2_appearance/renders/grass_v1. Metrics: camera/validate.py v4.

## Adopted
| change | files | params |
|---|---|---|
| Tier 1 blade colour (render-time) | cg/scene/look.json, cg/blender/render_setup.py, assemble_scene.py | grass_gain_rgb B 0.95→0.42; blade spec 0.18→0.35; rough 0.62→0.50 (picked from t1/t1b/t1c renders) |
| Tier 2 tuft speckle | cg/grass/gen_grass.py, grass_params.json | per-blade var σ 0.13→0.07; hue jitter ½; green_base (0.054,0.120,0.016); dry 0.02/0.03/0.01, turf_dry 0.30 |
| Tier 3 patch field | cg/grass/scatter_grass.py, grass_params.json | world-anchored lum amp 0.06, dry amp 0.10; iid jitter 0.07→0.03 |
| Cut fringe | grass_params.json | tuft_05/06 h 5–8 cm, lean 0.2–0.6, dry 0.03/0.04, cut |
| Boundary P0–P6 + footprint-paving incr | cg/ground/build_ground.py, ground_config.json, scatter_grass.py | infill footprint 3 m (paving only) + gap 1 m; sidewalk_min_w 0.6; poly_sigma_px 2; sliver_fill 0.6 m/≤12 m²; stable_ids; fringe_hard_from geometry |
| Lead infra | gen_grass.py (AGENTB_ROOT), render_setup.py (CYCLES_DEVICES log), scripts/appearance_ab.sh (render_sharded) | — |
Same 40 ground asset_ids/pivots, 169 instances, scatter 2,086,393 tufts.

## Not adopted
- Tier-1 B/G lit−shadow separation gate: fails for every variant (lighting/sky-fill, not material); absolute lit≥0.08 contradicts validate's own video value at 00140 (0.054). Overridden by lead, see t1 table.
- b0.55 (t1) and spec 0.50/rough 0.45 (t1b): worse on all colour metrics than t1c.
- Lawn sheen, under-tree dryness ring, more blades, global R/G darkening, lawn texture contrast/albedo change (foliage rejects).
- D6/D9 "bright rim" colour fix (not reproduced). Walkway carving, plaza-band rule fix, D6–D8 road/apron items (out of scope / no evidence).
- Cycles multi-device for the final render: measured slower (6 GPUs one process 24.5 s/frame vs 1 GPU 18 s/frame) → frame-sharded workers.

## Tier-1 variant renders (5 frames, existing scatter)
| variant | mad_B | dE76 | abs dB | lit/shadow B/G |
|---|---|---|---|---|
| baseline | 12.43 | 6.56 | 11.4 | 0.118/0.110 |
| t1 b0.55 s0.35 r0.50 | 11.99 | 5.66 | 9.2 | 0.092/0.091 |
| t1b b0.55 s0.50 r0.45 | 12.33 | 6.11 | 10.8 | 0.104/0.103 |
| **t1c b0.42 s0.35 r0.50** | **11.78** | **5.22** | **7.8** | 0.079/0.080 |

## Final per-frame (before → after)
| frame | overall MAD | grass MAD (A) | grass MAD (B) | dE76 | median Δ sRGB | intrusion | missing |
|---|---|---|---|---|---|---|---|
| 00140 | 58.09→55.45 | 7.60→6.99 | 7.04→6.44 | 3.47→0.86 | +2,+1,+3 | 0.069→0.000 | 0.020→0.019 |
| 00340 | 28.57→28.49 | 28.36→26.79 | 28.36→26.79 | 12.13→**14.07** | +30,+30,+17 | 0.002→0 | 0→0 |
| 00590 | 49.65→49.26 | 8.59→8.56 | 8.27→8.16 | 4.00→1.62 | −2,+2,+5 | 0.005→0 | 0.001→0 |
| 00790 | 40.29→39.67 | 31.05→15.48 | 9.16→**9.60** | 7.93→4.41 | −8,−10,−6 | 0→0 | 0.403→0.131 |
| 00840 | 39.18→39.19 | n/a (0 grass px) | | | | 0→0 | |
| 00690 (extra) | 32.98→28.54 | 32.67→8.55 | 9.34→8.52 | 5.27→2.25 | +2,0,+11 | 0→0 | 0.252→0.001 |
Aggregates: 6f overall 41.46→40.10; 18f overall 35.42→34.85; 18f grass MAD A 22.42→18.20, B 14.20→13.54, |dB| 11.7→7.5; band IoU 0.53→0.57; D1 windows 0.54–0.57→0.00.
Tier 2 gate (hp_mtf ≤1.3): FAIL — 00140 1.86→1.71, 00590 3.48→3.15, 00790 2.27→2.00, 00690 2.22→1.47.
Tier 3 gate (geomean lf R/G & chroma ≥0.75, 00140/00590/00790): PASS — 0.82 / 0.86.
Caveat: Tier 2, Tier 3 and the geometry rebuild were rendered together (rebuild re-randomises all tufts); only Tier 1 was isolated. Per camera-validation, grass MAD changes < 1.0 across a rebuild are within noise.

## Novel 10 m inward (pos 235.47,−64.77,2.20 → 261.45,−49.77,0.20)
Footprint infill green 0.999→0.000 (now paving; ring path full width); dark fold/wedge at path edge gone. Observed-lawn vs inferred-lawn seam dE 33.6→31.8 (still a hard seam). Green on observed hard ground 0.092→0.101.

## Resources
Final frames: 6 workers (GPU0 00010,00290,00590 | GPU1 00045,00340,00640 | GPU3 00090,00390,00690 | GPU5 00140,00440,00740 | GPU6 00190,00490,00790 | GPU7 00240,00540,00840), 75.4 s wall, 4.19 s/frame, 68–75 s/worker, peak RSS 12.5–12.6 GB/worker. GPU2/GPU4 excluded (occupied by others: 3.8 GB / 0.5 GB).
Tier-1 multi-device (6 GPUs, one Blender): 18 frames 7:21, 13.2 GB. Tier-1b/c single GPU5: 5 frames 1:31 / 1:37. Asset build 92/92 in 20.6 s (1.3 GB). Assemble 10.4 s (3.7 GB). Novel views 24 s / 20 s (12.3 GB).
Logs: runs/a2_appearance/logs/{render_grass_t1*,render_grass_v1_gpu*,render_grass_v1_shards.json,view_grass_*,grass_v1_*}.log

## Lawn still needs work
1. Tree shadows on lawn 3–4× too weak (00290/00340/00440; 00340 +30 sRGB, dE 14.1): sun strength / direction / crown opacity.
2. 00790 rotunda island: plaza_01 band still covers lawn up to the yellow line (missing 0.13), CG darker (−8/−10/−6).
3. Near-field blade speckle still 1.5–3× video (Tier 2 gate fail), worst 00590.
4. Inferred inner lawn (novel view) much lighter than observed lawn: hard seam dE ≈32.
5. In-lawn walkway swallowed (00340 path_swallowed 1.0; 00140 0.20).
6. Plaza paving over lawn at 00140 (23–39 m) and 00840 (D3, unchanged).
7. Patch-scale saturation variation still low (lf sat ratio worse after blue cut).
