"""Distant-scene backdrop for the captured lawn.

Everything beyond the modelled lawn (buildings, far tree line) is taken from the
registered photographs and laid on a vertical cylinder around the camera path.
Per photograph, monocular metric depth separates distant structure from the
foreground trees that hide it; a colour test removes open sky, which the depth
model cannot range. Each panorama texel takes the photograph that sees it
closest to its optical axis, so no two exposures are averaged.

The cylinder has one radius: structures nearer or farther than it show parallax
error away from the captured positions. Texels no photograph saw stay
transparent.

Inputs: cameras.json (registered photo cameras exported from the scene GLB),
depth.npz (depth.py), the source JPEGs. Outputs: panorama.webp, backdrop.json.
"""
import json, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

cameras_path, depth_path, photos, out = sys.argv[1:5]
RADIUS = 110.0                 # metres, about the median range of the distant structures
NEAR_LIMIT = 54.0              # depth-model metres; nearer pixels are modelled as geometry
Y_LOW, Y_HIGH = -2.0, 24.0     # metres on the cylinder
PX_PER_DEG = 20.0              # matches the photographs' angular resolution

cams = json.load(open(cameras_path))
z = np.load(depth_path)
names = [str(n)[:2] for n in z['files']]

def rotation(q):
    x, y, zq, w = q
    return np.array([[1-2*(y*y+zq*zq), 2*(x*y-zq*w), 2*(x*zq+y*w)],
                     [2*(x*y+zq*w), 1-2*(x*x+zq*zq), 2*(y*zq-x*w)],
                     [2*(x*zq-y*w), 2*(y*zq+x*w), 1-2*(x*x+y*y)]])

views = []
for k, name in enumerate(names):
    c = cams[name]
    image = np.asarray(Image.open(f'{photos}/{name}.jpg').convert('RGB'), dtype=np.float32)
    h, w = image.shape[:2]
    depth = np.asarray(Image.fromarray(z['depth'][k]).resize((w, h), Image.BILINEAR))
    r, g, b = image[..., 0], image[..., 1], image[..., 2]
    # Open sky: unranged by the depth model, blue-dominant and bright.
    # Sky is blue-dominant and bright, and either beyond the depth model's range
    # or, where foliage edges pull its depth inward, free of any texture.
    grey = image.mean(-1)
    flat = np.sqrt(np.maximum(ndimage.uniform_filter(grey * grey, 9) - ndimage.uniform_filter(grey, 9) ** 2, 0)) < 2.2
    blue = (b > r + 22) & (b > g + 6) & (b > 150) & ((depth > 128) | (flat & (depth > 85)))
    # A blue region is glazing only where distant structure encloses it. One that
    # reaches the top of the frame, or is bounded by foreground foliage, is sky.
    labels, count = ndimage.label(blue)
    ring = ndimage.binary_dilation(blue, iterations=4) & ~blue
    ring_labels = ndimage.grey_dilation(labels, size=9) * ring
    total = ndimage.sum(ring, ring_labels, np.arange(count + 1))
    structure = ndimage.sum(ring & (depth >= NEAR_LIMIT), ring_labels, np.arange(count + 1))
    # Panes are small and wholly framed; a sky pocket is larger or partly open.
    area = ndimage.sum(blue, labels, np.arange(count + 1))
    enclosed = (structure > .9 * np.maximum(total, 1)) & (area < 5000)
    enclosed[np.unique(labels[0])] = False
    enclosed[0] = False
    sky = blue & ~enclosed[labels]
    far = (depth >= NEAR_LIMIT) & ~sky
    # Specks of bright sky glimpsed through a foreground crown are not structure.
    labels, count = ndimage.label(far)
    sizes = ndimage.sum(far, labels, np.arange(count + 1))
    far = far & (sizes[labels] > 4000)
    # Retreat from foreground silhouettes, where depth and colour are both mixed.
    keep = np.asarray(Image.fromarray((far * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))) > 127
    views.append(dict(name=name, image=image, keep=keep, R=rotation(c['q']), t=np.array(c['t']),
        tan=np.tan(c['yfov'] / 2), aspect=c['aspect'], k=float(c['extras'].get('radial_k', 0)), w=w, h=h))

centre = np.mean([v['t'] for v in views], 0); centre[1] = 0
# Azimuth span: where the photographs' optical axes and half-widths reach.
def azimuth(d): return np.arctan2(d[0], -d[2])
edges = []
for v in views:
    half = np.arctan(v['tan'] * v['aspect'])
    a = azimuth(v['R'] @ np.array([0, 0, -1.0]))
    edges += [a - half, a + half]
a0, a1 = min(edges), max(edges)
W = int(np.ceil(np.degrees(a1 - a0) * PX_PER_DEG)); H = int(np.ceil((Y_HIGH - Y_LOW) / (RADIUS * np.radians(1 / PX_PER_DEG))))
az = a0 + (np.arange(W) + .5) / W * (a1 - a0)
ys = Y_HIGH - (np.arange(H) + .5) / H * (Y_HIGH - Y_LOW)
A, Y = np.meshgrid(az, ys)
P = np.stack([centre[0] + RADIUS * np.sin(A), Y, centre[2] - RADIUS * np.cos(A)], -1)

best = np.full((H, W), np.inf); rgb = np.zeros((H, W, 3), np.float32); owner = np.full((H, W), -1)
for i, v in enumerate(views):
    pc = (P - v['t']) @ v['R']          # world to camera: R^T (P - t)
    front = pc[..., 2] < -1e-3
    xn = pc[..., 0] / -pc[..., 2]; yn = pc[..., 1] / -pc[..., 2]
    off = xn * xn + yn * yn
    scale = 1 + v['k'] * off            # SIMPLE_RADIAL of the raw JPEG
    u = (xn * scale / (v['tan'] * v['aspect']) + 1) * .5 * v['w']; vv = (1 - yn * scale / v['tan']) * .5 * v['h']
    inside = front & (u >= 1) & (u < v['w'] - 2) & (vv >= 1) & (vv < v['h'] - 2)
    ui = np.clip(u, 0, v['w'] - 2); vi = np.clip(vv, 0, v['h'] - 2)
    x0 = ui.astype(int); y0 = vi.astype(int); fx = (ui - x0)[..., None]; fy = (vi - y0)[..., None]
    valid = inside & v['keep'][y0, x0] & v['keep'][y0 + 1, x0 + 1] & v['keep'][y0, x0 + 1] & v['keep'][y0 + 1, x0]
    take = valid & (off < best)
    im = v['image']
    colour = (im[y0, x0] * (1 - fx) + im[y0, x0 + 1] * fx) * (1 - fy) + (im[y0 + 1, x0] * (1 - fx) + im[y0 + 1, x0 + 1] * fx) * fy
    rgb[take] = colour[take]; best[take] = off[take]; owner[take] = i

# Fragments too small to be a structure are residue of the masks above.
labels, count = ndimage.label(owner >= 0)
sizes = ndimage.sum(owner >= 0, labels, np.arange(count + 1))
owner[sizes[labels] < 1500] = -1
alpha = (owner >= 0).astype(np.uint8) * 255
alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
alpha = np.clip((alpha - 96) / 96, 0, 1)   # feather inward only: never widen into unseen texels
# Bleed colour into transparent texels so filtering does not pull in black.
filled = rgb.copy(); known = owner >= 0
for _ in range(12):
    blurred = np.asarray(Image.fromarray(filled.astype(np.uint8)).filter(ImageFilter.BoxBlur(2)), dtype=np.float32)
    weight = np.asarray(Image.fromarray((known * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2)), dtype=np.float32) / 255
    grow = ~known & (weight > .02)
    filled[grow] = blurred[grow] / weight[grow][:, None]; known = known | grow
Image.fromarray(np.dstack([np.clip(filled, 0, 255), alpha * 255]).astype(np.uint8)).save(f'{out}/panorama.webp', quality=92, method=6)
coverage = float((owner >= 0).mean())
json.dump(dict(centre=[round(float(c), 4) for c in centre], radius=RADIUS, azimuth=[float(a0), float(a1)], y=[Y_LOW, Y_HIGH],
    size=[W, H], coverage=round(coverage, 4), nearLimitDepthModelM=NEAR_LIMIT,
    views={v['name']: int((owner == i).sum()) for i, v in enumerate(views)},
    basis='13 registered photographs; monocular metric depth for the near/far split; single-radius cylinder, parallax not modelled'),
    open(f'{out}/backdrop.json', 'w'), indent=1)
print(W, H, 'coverage', coverage, 'azimuth deg', np.degrees([a0, a1]).round(1), 'centre', centre.round(2))
