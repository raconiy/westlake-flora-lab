"""Agent B (Opus 5.5) — Blender material library (Principled BSDF only, so glTF export is faithful).
Material names are stable identifiers used by every generator. Render-only extras (leaf translucency) are
added by cg/blender/assemble_scene.py, never baked into the exported assets."""
import bpy, json, pathlib
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); TEX = B / "assets/textures"
SPECIES = json.load(open(B / "cg/trees/species.json"))
STATIC = {
    # name: (texture or None, base colour linear RGB (used if no texture / as tint), roughness, metallic, extra)
    "paving":        ("paving_granite", None, 0.75, 0.0, {}),
    "asphalt":       ("asphalt", None, 0.9, 0.0, {}),
    "lawn":          ("lawn", None, 0.95, 0.0, {}),
    "path_concrete": ("path_concrete", None, 0.85, 0.0, {}),
    "curb":          ("curb_granite", None, 0.8, 0.0, {}),
    "white_stone":   ("white_stone", None, 0.6, 0.0, {}),
    "slat":          ("slat_louvre", None, 0.5, 0.0, {}),
    "wood":          ("wood_panel", None, 0.6, 0.0, {}),
    "grey_stone":    ("grey_stone_panel", None, 0.7, 0.0, {}),
    "facade_bands":  ("facade_bands", None, 0.35, 0.0, {}),
    "ground_far":    (None, (0.22, 0.24, 0.18), 1.0, 0.0, {"spec": 0.02}),
    "glass":         (None, (0.02, 0.025, 0.03), 0.05, 0.0, {"glass": True}),
    "metal_light":   (None, (0.62, 0.63, 0.63), 0.35, 0.8, {}),
    "metal_dark":    (None, (0.06, 0.065, 0.07), 0.4, 0.7, {}),
    "paint_yellow":  (None, (0.75, 0.52, 0.03), 0.6, 0.0, {}),
    "paint_white":   (None, (0.80, 0.80, 0.78), 0.6, 0.0, {}),
    "bin_blue":      (None, (0.02, 0.07, 0.20), 0.45, 0.0, {}),
    "plastic_dark":  (None, (0.03, 0.03, 0.03), 0.5, 0.0, {}),
    "planter_grey":  (None, (0.25, 0.25, 0.24), 0.7, 0.0, {}),
    "shrub":         (None, (0.05, 0.12, 0.03), 0.8, 0.0, {}),
    "hydrant_red":   (None, (0.6, 0.03, 0.02), 0.45, 0.0, {}),
    "sign_orange":   (None, (0.7, 0.18, 0.02), 0.5, 0.0, {}),
    "whitewash":     (None, (0.72, 0.72, 0.68), 0.95, 0.0, {}),
    "facade_far":    (None, (0.55, 0.56, 0.57), 0.7, 0.0, {}),
    "glass_far":     (None, (0.12, 0.14, 0.16), 0.15, 0.0, {}),
    "emissive_lamp": (None, (0.9, 0.9, 0.85), 0.3, 0.0, {}),
}
def _img(name):
    p = TEX / name
    for im in bpy.data.images:
        if im.filepath and pathlib.Path(bpy.path.abspath(im.filepath)).resolve() == p.resolve(): return im
    return bpy.data.images.load(str(p))
def _principled(m):
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bs = nt.nodes.new("ShaderNodeBsdfPrincipled"); bs.location = (-300, 0)
    nt.links.new(bs.outputs[0], out.inputs[0]); return nt, bs
def _tex(nt, bs, texname, tint=None, normal=True, alpha=False, vcol=False, colorspace_srgb=True):
    tj = json.load(open(TEX / "textures.json"))[texname]
    ti = nt.nodes.new("ShaderNodeTexImage"); ti.image = _img(tj["albedo"]); ti.location = (-900, 200)
    col = ti.outputs["Color"]
    if tint is not None or vcol:
        mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0; mul.location = (-600, 200)
        nt.links.new(col, mul.inputs[6])
        if vcol:
            va = nt.nodes.new("ShaderNodeVertexColor"); va.layer_name = "Col"; va.location = (-900, -100); nt.links.new(va.outputs["Color"], mul.inputs[7])
        else: mul.inputs[7].default_value = (*tint, 1.0)
        col = mul.outputs[2]
    nt.links.new(col, bs.inputs["Base Color"])
    if alpha: nt.links.new(ti.outputs["Alpha"], bs.inputs["Alpha"])
    if normal and tj.get("normal"):
        tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = _img(tj["normal"]); tn.image.colorspace_settings.name = "Non-Color"; tn.location = (-900, -350)
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-600, -350); nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs[0], bs.inputs["Normal"])
def get(name):
    if name in bpy.data.materials: return bpy.data.materials[name]
    m = bpy.data.materials.new(name); nt, bs = _principled(m)
    kind, _, sp = name.partition("_")
    if name in STATIC:
        tex, col, rough, metal, ex = STATIC[name]
        bs.inputs["Roughness"].default_value = rough; bs.inputs["Metallic"].default_value = metal
        if tex: _tex(nt, bs, tex, vcol=name in ("lawn", "paving", "path_concrete"))
        else: bs.inputs["Base Color"].default_value = (*col, 1)
        if "spec" in ex: bs.inputs["Specular IOR Level"].default_value = ex["spec"]
        if name == "lawn": bs.inputs["Specular IOR Level"].default_value = 0.08   # matte turf: no blue sky sheen
        if ex.get("glass"):
            bs.inputs["Base Color"].default_value = (0.03, 0.035, 0.04, 1); bs.inputs["Roughness"].default_value = 0.04
            bs.inputs["Specular IOR Level"].default_value = 0.6; bs.inputs["IOR"].default_value = 1.52
        if name == "emissive_lamp": bs.inputs["Emission Strength"].default_value = 0.0
    elif kind == "bark" and sp in SPECIES:
        s = SPECIES[sp]; _tex(nt, bs, s["bark"], tint=s["bark_tint"]); bs.inputs["Roughness"].default_value = 0.92
    elif kind in ("leaf", "twig") and sp in SPECIES:
        s = SPECIES[sp]; _tex(nt, bs, f"{kind}_{s['leaf_shape']}", vcol=True, alpha=True, normal=False)
        bs.inputs["Roughness"].default_value = 0.72; bs.inputs["Specular IOR Level"].default_value = 0.12
        # Weak diffuse lift matches daylight backscatter visible through captured crowns.
        try:
            bs.inputs["Emission Strength"].default_value = 0.055
            mix = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeMix"), None)
            if mix: nt.links.new(mix.outputs[2], bs.inputs["Emission Color"])
        except Exception: pass
        m.blend_method = "CLIP" if hasattr(m, "blend_method") else None
        try: m.surface_render_method = "DITHERED"
        except Exception: pass
        m.use_backface_culling = False
        m["agentb_translucency"] = s.get("translucency", 0.3)
    else:
        bs.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
    m["agentb_material_id"] = name
    return m
