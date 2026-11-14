#!/usr/bin/env python3
"""Agent A appearance refine pass.

Preserves the final-scene source meshes and UVs while adding a PBR render variant:
- Principled surfaces with image-backed color, roughness and micro-normal breakup;
- deterministic secondary foliage layers and lawn tufts;
- a clearly labelled, low-contrast inferred distant academic wing.
"""
from __future__ import annotations
import bpy, json, math, random, sys, hashlib
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
def arg(name, default=None, required=False):
    if name in argv:
        return argv[argv.index(name)+1]
    if required: raise SystemExit(f"missing {name}")
    return default

INPUT = Path(arg("--input", required=True)).resolve()
OUT = Path(arg("--output", required=True)).resolve()
QA = OUT / "qa"
OUT.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(INPUT))
scene = bpy.context.scene
random.seed(20261114)
report = {
    "schema_version": 1,
    "agent_id": "agent-a",
    "input": str(INPUT),
    "output": str(OUT),
    "seed": 20261114,
    "refinements": [],
    "inferred_assets": [],
    "qa": [],
}

def collection(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or scene.collection).children.link(c)
    return c

def image_from(mat):
    if not mat or not mat.use_nodes: return None
    for n in mat.node_tree.nodes:
        if n.bl_idname == "ShaderNodeTexImage" and n.image:
            return n.image
    return None

def clear_nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    nt.links.clear()
    return nt

def safe_input(node, name, value):
    if name in node.inputs:
        node.inputs[name].default_value = value

def pbr_from_image(mat, roughness=0.7, noise_scale=24.0, bump_strength=0.08, noise_amount=0.12):
    image = image_from(mat)
    nt = clear_nodes(mat)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.name = "PBR surface"
    uv = nt.nodes.new("ShaderNodeUVMap")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "Observed texture"
    tex.image = image
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.name = "Micro variation"
    noise.inputs["Scale"].default_value = noise_scale
    noise.inputs["Detail"].default_value = 3.0
    noise.inputs["Roughness"].default_value = 0.72
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.name = "Subtle albedo breakup"
    ramp.color_ramp.elements[0].position = 0.24
    ramp.color_ramp.elements[0].color = (0.72, 0.78, 0.66, 1)
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = (1.04, 1.02, 0.90, 1)
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.name = "Observed albedo plus breakup"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = noise_amount
    bump = nt.nodes.new("ShaderNodeBump")
    bump.name = "Micro relief"
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.035
    nt.links.new(uv.outputs.get("UV"), tex.inputs["Vector"])
    nt.links.new(tex.outputs.get("Color"), mix.inputs[1])
    nt.links.new(noise.outputs.get("Fac"), ramp.inputs[0])
    nt.links.new(ramp.outputs.get("Color"), mix.inputs[2])
    nt.links.new(mix.outputs.get("Color"), bs.inputs["Base Color"])
    nt.links.new(noise.outputs.get("Fac"), bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    safe_input(bs, "Roughness", roughness)
    safe_input(bs, "Metallic", 0.0)
    return mat

def solid_pbr(mat, color, roughness=0.55, metallic=0.0, transmission=0.0):
    nt = clear_nodes(mat)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.name = "PBR surface"
    safe_input(bs, "Base Color", (*color, 1.0))
    safe_input(bs, "Roughness", roughness)
    safe_input(bs, "Metallic", metallic)
    safe_input(bs, "IOR", 1.45)
    safe_input(bs, "Transmission Weight", transmission)
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    return mat

def world_bounds(objects):
    lo = Vector((float("inf"),)*3); hi = Vector((float("-inf"),)*3); n=0
    for obj in objects:
        if obj.type != "MESH" or obj.hide_render: continue
        for corner in obj.bound_box:
            v = obj.matrix_world @ Vector(corner)
            lo.x=min(lo.x,v.x); lo.y=min(lo.y,v.y); lo.z=min(lo.z,v.z)
            hi.x=max(hi.x,v.x); hi.y=max(hi.y,v.y); hi.z=max(hi.z,v.z); n += 1
    return (lo,hi) if n else (Vector((0,0,0)),Vector((1,1,1)))

# 1) Replace flat emission render materials with measured-image PBR materials.
image_mats = {"Actual source photo atlas | original lighting baked": (0.52, 26, 0.07, 0.08),
              "Observed_forecourt_RealAtlas": (0.86, 16, 0.06, 0.10),
              "Observed_lawn_RealAtlas": (0.94, 30, 0.08, 0.16),
              "Observed_paving_RealAtlas": (0.88, 38, 0.13, 0.11),
              "Observed_road_RealAtlas": (0.82, 32, 0.10, 0.09)}
for name, (rough, scale, bump, amount) in image_mats.items():
    mat = bpy.data.materials.get(name)
    if mat and image_from(mat):
        pbr_from_image(mat, roughness=rough, noise_scale=scale, bump_strength=bump, noise_amount=amount)
        mat["refine_pass"] = "image-backed-principled-with-micro-breakup"
        mat["source_texture_preserved"] = True
        report["refinements"].append({"material": name, "type": "image_pbr_micro_breakup"})

# 2) Restore physically shaded inferred building parts whose old variant was unlit.
solid_rules = [
    ("glazing", (0.045,0.075,0.085), 0.18, 0.12, 0.10),
    ("column", (0.68,0.70,0.68), 0.43, 0.0, 0.0),
    ("headerband", (0.40,0.28,0.20), 0.44, 0.0, 0.0),
    ("rooftransition", (0.46,0.48,0.47), 0.48, 0.0, 0.0),
    ("soffit", (0.62,0.64,0.61), 0.52, 0.0, 0.0),
    ("upperscreen", (0.49,0.51,0.49), 0.56, 0.0, 0.0),
]
for mat in list(bpy.data.materials):
    low = mat.name.lower()
    for token, color, rough, metal, trans in solid_rules:
        if token in low and "measured_unseen_color" in low:
            solid_pbr(mat, color, roughness=rough, metallic=metal, transmission=trans)
            mat["refine_pass"] = "inferred-part-principled"
            mat["appearance_status"] = "inferred where source texture was not observed"
            report["refinements"].append({"material": mat.name, "type": "inferred_part_pbr", "token": token})
            break

# 3) Add deterministic secondary tree canopy layers. Original mesh, UVs and atlas stay linked.
tree_refine = collection("tree-canopy-refinement-v2")
foliage = [o for o in scene.objects if o.get("asset_collection") == "forecourt-tree" and o.name.startswith("Foliage_")]
secondary_count = 0
for idx, src in enumerate(foliage):
    for j, (scale, offset, angle) in enumerate(((1.035, (0.012,-0.010,0.008), 0.035), (0.975, (-0.016,0.014,-0.006), -0.045))):
        dup = src.copy()
        dup.data = src.data
        dup.name = f"{src.name}_secondary_{j+1:02d}"
        tree_refine.objects.link(dup)
        dup.matrix_world = src.matrix_world.copy()
        dup.location += Vector(offset)
        dup.scale = tuple(float(x)*scale for x in src.scale)
        dup.rotation_euler.rotate_axis("Z", angle)
        dup["asset_id"] = "plant.forecourt_tree.canopy_refinement.v2"
        dup["parent_asset_id"] = "plant.forecourt_tree.observed.v1"
        dup["layer_role"] = "secondary foliage depth"
        secondary_count += 1
report["refinements"].append({"type":"secondary_canopy_layers","source_layers":[o.name for o in foliage],"instances":secondary_count,"seed":20261114})

# 4) Add small, separate grass tuft instances over the observed lawn footprint.
grass_col = collection("ground-grass-tufts-v2")
grass_mat = bpy.data.materials.get("Grass tuft PBR") or bpy.data.materials.new("Grass tuft PBR")
solid_pbr(grass_mat, (0.16,0.25,0.055), roughness=0.92)
lawn_objs=[o for o in scene.objects if o.name=="Observed_lawn"]
if lawn_objs:
    lo,hi=world_bounds(lawn_objs); mesh_count=0
    for i in range(28):
        x=random.uniform(lo.x,hi.x); y=random.uniform(lo.y,hi.y); z=hi.z+0.006
        h=random.uniform(0.018,0.040); w=random.uniform(0.008,0.016)
        verts=[(x-w,y,z),(x+w,y,z),(x,y+w*0.55,z),(x-w*0.45,y,z+h),(x+w*0.45,y,z+h*0.92),(x,y+w*0.28,z+h*1.05)]
        faces=[(0,1,4,3),(1,2,5,4),(2,0,3,5)]
        me=bpy.data.meshes.new(f"GrassTuftMesh_{i:03d}"); me.from_pydata(verts,[],faces); me.update()
        ob=bpy.data.objects.new(f"GrassTuft_{i:03d}",me); grass_col.objects.link(ob); me.materials.append(grass_mat)
        ob["asset_id"]="ground.grass_tuft.instance.v2"; ob["seed"]=20261114; mesh_count += 1
    report["refinements"].append({"type":"grass_tuft_instances","instances":mesh_count,"seed":20261114})

# 5) Inferred low-contrast distant academic wing with independent asset collection.
distant_col=collection("inferred-distant-academic-wing-v1")
# Avoid duplicating on reruns.
for obj in list(distant_col.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
concrete=bpy.data.materials.get("Distant wing concrete PBR") or bpy.data.materials.new("Distant wing concrete PBR")
glass=bpy.data.materials.get("Distant wing glazing PBR") or bpy.data.materials.new("Distant wing glazing PBR")
roof=bpy.data.materials.get("Distant wing roof PBR") or bpy.data.materials.new("Distant wing roof PBR")
solid_pbr(concrete,(0.34,0.37,0.35),0.68); solid_pbr(glass,(0.025,0.055,0.07),0.22,0.08,0.08); solid_pbr(roof,(0.20,0.22,0.21),0.58)
main_objs=[o for o in scene.objects if o.get("asset_collection")=="mainhall"]
lo,hi=world_bounds(main_objs)
base_x=(lo.x+hi.x)*0.5+1.8; base_y=hi.y+2.6; base_z=max(hi.z*0.25,0.0)
def box(name, center, dims, mat):
    x,y,z=center; dx,dy,dz=[v/2 for v in dims]
    vs=[(x+sx*dx,y+sy*dy,z+sz*dz) for sz in(-1,1) for sy in(-1,1) for sx in(-1,1)]
    fs=[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
    me=bpy.data.meshes.new(name+"Mesh"); me.from_pydata(vs,[],fs); me.materials.append(mat); me.update()
    ob=bpy.data.objects.new(name,me); distant_col.objects.link(ob); ob["asset_id"]="building.distant_academic.inferred.v1"; ob["appearance_status"]="inferred beyond covered views"; return ob
box("DistantWing_MainMass",(base_x,base_y,base_z+0.58),(3.8,0.72,1.16),concrete)
box("DistantWing_Roof",(base_x,base_y,base_z+1.20),(4.05,0.84,0.10),roof)
box("DistantWing_Base",(base_x,base_y,base_z+0.05),(3.95,0.80,0.10),concrete)
for i in range(9):
    x=base_x-1.55+i*0.39
    for yy in (base_y-0.371,base_y+0.371):
        box(f"DistantWing_Glazing_{i:02d}_{'F' if yy<base_y else 'B'}",(x,yy,base_z+0.60),(0.25,0.025,0.58),glass)
        box(f"DistantWing_Mullion_{i:02d}_{'F' if yy<base_y else 'B'}",(x+0.14,yy*0.999,base_z+0.60),(0.025,0.035,0.64),concrete)
report["inferred_assets"].append({"asset_id":"building.distant_academic.inferred.v1","collection":distant_col.name,"placement_note":"Placed behind the observed main hall using conservative low-contrast massing; not directly visible in all source views."})

# Soft directional fill so PBR materials show form without changing the observed overcast mood.
ld=bpy.data.lights.get("Refine soft overcast key") or bpy.data.lights.new("Refine soft overcast key","AREA")
ld.energy=85; ld.shape="DISK"; ld.size=5.0
light=bpy.data.objects.get("Refine soft overcast key") or bpy.data.objects.new("Refine soft overcast key",ld)
if not light.users_collection: scene.collection.objects.link(light)
light.location=(1.5,-3.5,4.5); light.rotation_euler=((Vector((3.0,0.0,0.4))-light.location).to_track_quat("-Z","Y").to_euler())

# Render QA in Eevee with the solved reference cameras.
try: scene.render.engine="BLENDER_EEVEE_NEXT"
except Exception: pass
scene.render.resolution_x=544; scene.render.resolution_y=960; scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"; scene.render.image_settings.color_mode="RGBA"
for cid in ("ref260","ref270"):
    cam=bpy.data.objects.get(cid)
    if cam:
        scene.camera=cam; scene.render.filepath=str(QA/(cid+".png")); bpy.ops.render.render(write_still=True)
        report["qa"].append(str(QA/(cid+".png")))

# Save an editable full scene and web GLB.
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"appearance-scene-refined.blend"))
# export all renderable scene meshes
bpy.ops.object.select_all(action="DESELECT")
for o in scene.objects:
    if o.type=="MESH" and not o.hide_render: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/"appearance-scene-refined.glb"),export_format="GLB",use_selection=True,export_yup=True,export_extras=True,export_apply=True,export_materials="EXPORT")
# Independent collection packages.
for col_name,file_name in (("inferred-distant-academic-wing-v1","distant-academic-wing-inferred.blend"),("tree-canopy-refinement-v2","tree-canopy-refinement.blend"),("ground-grass-tufts-v2","ground-grass-tufts.blend")):
    col=bpy.data.collections.get(col_name)
    if col:
        try: bpy.data.libraries.write(str(OUT/file_name), {col}, fake_user=True)
        except Exception as e: report.setdefault("package_warnings",[]).append({"file":file_name,"error":repr(e)})
for f in ("appearance-scene-refined.blend","appearance-scene-refined.glb"):
    p=OUT/f
    report.setdefault("exports",{})[f]={"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}
(OUT/"refinement-receipt.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
print("REFINE_COMPLETE",json.dumps(report["exports"],ensure_ascii=False))
