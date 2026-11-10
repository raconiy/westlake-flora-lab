"""Bounded relative bark-light correction from a photographed stem.

The confidence map excludes the unobserved rear and fork. Neither the fitted
lighting nor extrapolated rear appearance is a measured material property.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates


def build(stem_file, mapping_file, photo_file, output, attempt_separation=False):
    output.mkdir(parents=True, exist_ok=True)
    vertices = np.asarray(json.loads(stem_file.read_text())['vertices']).reshape(-1, 24, 3)
    mapping = json.loads(mapping_file.read_text())['views']['01']['rawLens']
    photo = np.asarray(Image.open(photo_file).convert('RGB'), float) / 255
    world = np.asarray(mapping['matrixWorldThreeColumnMajor']).reshape(4, 4, order='F')
    world[:3, 3] *= 3.41
    inverse = np.linalg.inv(world)
    camera = world[:3, 3][[0, 2, 1]] * [1, -1, 1]
    centres = vertices.mean(axis=1)
    heights = centres[:, 2]
    h, w = 1024, 512
    # Manually inspected source-01 stem boundary, in a 1024x768 raw-image
    # preview. These are image annotations, not surveyed stem coordinates.
    # Only the lower bare stem is constrained; the fork is excluded below.
    boundary_y = np.array([350,375,400,425,450,475,500,525,550,575,600,620])
    boundary_left = np.array([559,560,561,561,561,562,563,564,566,568,570,571])
    boundary_right = np.array([594,591,588,587,587,588,589,590,592,596,601,603])
    theta = np.linspace(0, 1, w)
    index = np.minimum(theta * 23, 22.999999)
    left, fraction = index.astype(int), index % 1
    coordinates, confidences = [], []

    def project(points):
        three = np.column_stack((points[:, 0], points[:, 2], -points[:, 1], np.ones(len(points))))
        view = three @ inverse.T
        x, y = view[:, 0] / -view[:, 2], -view[:, 1] / -view[:, 2]
        radial = 1 + mapping['normalizedSimpleRadialK'] * (x*x + y*y)
        return np.array([mapping['fxPx']*x*radial + mapping['principalPointPx'][0],
                         mapping['fyPx']*y*radial + mapping['principalPointPx'][1]])

    for height in np.linspace(0, heights[-1], h):
        z = min(4.32, height)
        k = np.clip(np.searchsorted(heights, z)-1, 0, len(heights)-2)
        t = (z-heights[k])/(heights[k+1]-heights[k])
        ring = vertices[k]*(1-t) + vertices[k+1]*t
        center = centres[k]*(1-t) + centres[k+1]*t
        points = ring[left]*(1-fraction[:, None]) + ring[left+1]*fraction[:, None]
        xy = project(points)
        cx = project(center[None, :])[0, 0]
        # Erode the sampled stem silhouette. This is a conservative image-space
        # foreground mask, independent of the visible-facing confidence below.
        xy[0] = cx + .72*(xy[0]-cx)
        preview_y = xy[1]*768/mapping['height']
        lower = (np.interp(preview_y,boundary_y,boundary_left)+2)*mapping['width']/1024
        upper = (np.interp(preview_y,boundary_y,boundary_right)-2)*mapping['width']/1024
        inside = (xy[0] >= lower) & (xy[0] <= upper)
        if .3 <= height <= 3.0:
            # Background projections are filled from the nearest interior bark
            # pixel for appearance, but receive zero observation confidence.
            xy[0] = np.clip(xy[0],lower,upper)
        coordinates.append(xy)
        outward = points-center
        outward[:, 2] = 0
        outward /= np.maximum(np.linalg.norm(outward, axis=1)[:, None], 1e-12)
        direction = camera-points
        direction /= np.linalg.norm(direction, axis=1)[:, None]
        facing = np.einsum('ij,ij->i', outward, direction)
        confidence = np.clip((facing-.3)/.4, 0, 1)
        # Only the unobstructed lower stem constrains the fit. Upper forks,
        # ground occlusion and the mirror-filled back are explicitly unknown.
        confidence *= (height >= .30) & (height <= 3.0)
        confidence *= inside
        confidences.append(confidence)
    coordinates = np.asarray(coordinates)
    rgb = np.stack([map_coordinates(photo[:, :, c], [coordinates[:, 1, :], coordinates[:, 0, :]],
                                   order=1, mode='nearest') for c in range(3)], -1)
    rgb[:, -1] = rgb[:, 0]
    linear = np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)
    confidence = np.asarray(confidences)
    np.savez_compressed(output/'separation-input.npz', confidence=confidence, linearRGB=linear, sourceCoordinates=coordinates)
    receipt = {'ok': True, 'mode': 'raw-foreground-sampling',
               'confidenceDefinition': 'front-facing eroded lower stem, 0.30–3.0 m; rear and fork zero',
               'limits': 'Photographed lighting remains; unknown rear repeats the photograph. No measured albedo or normal map.'}
    Image.fromarray((confidence[::-1]*255).astype('uint8')).save(output/'confidence.png')
    Image.fromarray((rgb[::-1]*255).astype('uint8')).save(output/'raw-bark.png')
    if not attempt_separation:
        (output/'receipt.json').write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt))
        return
    from separation import separate_bark
    result = separate_bark({'linearRGB': linear.tolist(), 'confidence': confidence.tolist(),
                            'illuminationBounds': [.5, 2.]})
    receipt.update(ok=result['ok'], mode='experimental-light-separation-not-selected')
    if result['ok']:
        limited = np.asarray(result['limited'])
        receipt['limitedSupportedFraction'] = float((confidence*limited).sum()/confidence.sum())
        receipt['illuminationRange'] = [min(result['illumination']), max(result['illumination'])]
        receipt['supportFraction'] = float((confidence > 0).mean())
        receipt['acceptedNumerically'] = receipt['limitedSupportedFraction'] <= .10
        corrected = np.asarray(result['linearRGB'])
        srgb = np.where(corrected <= .0031308, 12.92*corrected, 1.055*corrected**(1/2.4)-.055)
        Image.fromarray(np.rint(srgb[::-1]*255).astype('uint8')).save(output/'bark.png')
        np.savez_compressed(output/'separation-data.npz', confidence=confidence, illumination=result['illumination'],
                            linearRGBBefore=linear, linearRGBAfter=corrected)
    else:
        receipt['reason'] = result['reason']
    (output/'receipt.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stem', type=Path)
    parser.add_argument('camera_mapping', type=Path)
    parser.add_argument('photo', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--attempt-separation', action='store_true')
    args = parser.parse_args()
    build(args.stem, args.camera_mapping, args.photo, args.output, args.attempt_separation)
