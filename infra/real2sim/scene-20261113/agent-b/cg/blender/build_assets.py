"""Agent B (Opus 5.5) — turn generator Parts (.parts.npz + .json) into editable Blender assets and exports.
For each <asset>.json: fresh scene -> root Empty `<asset_id>` at the pivot -> child mesh objects per part
(named <asset_id>.<part>), UV map 'UVMap', colour attribute 'Col', Principled materials from materials.py.
Writes next to the json:  <stem>.blend (editable source), <stem>.glb (self-contained),
and for *_web: assets/web/<asset_id>.gltf (+ .bin) referencing shared web textures.
Usage: blender -b --factory-startup -P cg/blender/build_assets.py -- <json> [<json> ...]
"""
import bpy, sys, json, pathlib, numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import materials
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); WEB = B / "assets/web"
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
def mk_mesh(name, a, matname):
    V, F, UV, COL = a["V"], a["F"], a["UV"], a["COL"]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V)); me.vertices.foreach_set("co", V.ravel())
    nl = F.shape[1]; me.loops.add(F.size); me.polygons.add(len(F))
    me.loops.foreach_set("vertex_index", F.ravel())
    me.polygons.foreach_set("loop_start", np.arange(0, F.size, nl)); me.polygons.foreach_set("loop_total", np.full(len(F), nl))
    me.update(calc_edges=True)
    uv = me.uv_layers.new(name="UVMap"); uv.data.foreach_set("uv", UV[F.ravel()].ravel())
    if not np.allclose(COL, 1.0) or matname in ("lawn", "paving", "path_concrete") or matname.startswith(("leaf_", "twig_", "leafmass_")):
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT"); ca.data.foreach_set("color", COL.ravel())
    me.materials.append(materials.get(matname))
    me.validate(clean_customdata=False)
    for p in me.polygons: p.use_smooth = True
    return me
def build(js):
    js = pathlib.Path(js); meta = json.load(open(js)); stem = str(js)[:-5]
    arr = np.load(stem + ".parts.npz")
    reset(); sc = bpy.context.scene
    root = bpy.data.objects.new(meta["asset_id"], None); root.empty_display_type = "ARROWS"; sc.collection.objects.link(root)
    for k, v in meta.items():
        if isinstance(v, (str, int, float)): root[f"agentb_{k}"] = v
    root["agentb_meta_json"] = json.dumps({k: meta[k] for k in meta if k not in ("parts",)}, ensure_ascii=False)[:60000]
    objs = {}
    for p in meta["parts"]:
        a = {k: arr[f"{p['idx']}_{k}"] for k in ("V", "F", "UV", "COL")}
        me = mk_mesh(f"{meta['asset_id']}.{p['name']}", a, p["material"])
        ob = bpy.data.objects.new(f"{meta['asset_id']}.{p['name']}", me); sc.collection.objects.link(ob)
        ob.location = p["offset"]; objs[p["name"]] = ob
        if p.get("instances"):
            # first instance uses the master object; the rest are linked duplicates (shared mesh datablock)
            grp = bpy.data.objects.new(f"{meta['asset_id']}.{p['name']}_group", None); sc.collection.objects.link(grp)
            grp.location = p["offset"]; objs[p["name"]] = grp
            for k, (loc, rz, s) in enumerate(p["instances"]):
                o = ob if k == 0 else bpy.data.objects.new(f"{meta['asset_id']}.{p['name']}.{k:03d}", me)
                if k: sc.collection.objects.link(o)
                o.location = loc; o.rotation_euler = (0, 0, rz); o.scale = s; o.parent = grp
    for p in meta["parts"]:
        ob = objs[p["name"]]; par = objs.get(p["parent"]) if p.get("parent") else root
        ob.parent = par
    bpy.ops.wm.save_as_mainfile(filepath=stem + ".blend", compress=True, relative_remap=True)
    bpy.ops.object.select_all(action="SELECT")
    common = dict(use_selection=True, export_yup=True, export_apply=True, export_vertex_color="ACTIVE", export_extras=True)
    if meta.get("lod") == "web":
        WEB.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(WEB / f"{meta['asset_id']}.gltf"), export_format="GLTF_SEPARATE", export_texture_dir="textures",
                                  export_image_format="AUTO", **common)
    else:
        bpy.ops.export_scene.gltf(filepath=stem + ".glb", export_format="GLB", **common)
    print("BUILT", meta["asset_id"], meta.get("lod"), sum(p["nf"] for p in meta["parts"]), "faces", flush=True)
argv = sys.argv[sys.argv.index("--") + 1:]
for j in argv:
    try: build(j)
    except Exception as e:
        import traceback; traceback.print_exc(); print("FAILED", j, e, flush=True)
