import * as THREE from 'three';

/** Placement of the photographed distant scene; written by infra/reconstruction/backdrop. */
export interface BackdropPlacement {
  centre: [number, number, number];
  radius: number;
  /** Radians, measured from -Z toward +X. */
  azimuth: [number, number];
  y: [number, number];
}

/** Cylinder arc with the panorama's parameterisation: u along azimuth, v up. */
export function backdropGeometry(placement: BackdropPlacement, segments = 96) {
  const {centre, radius, azimuth, y} = placement;
  if (!(radius > 0) || !(azimuth[1] > azimuth[0]) || !(y[1] > y[0])) throw new Error('Invalid backdrop placement');
  const positions = new Float32Array((segments + 1) * 6), uvs = new Float32Array((segments + 1) * 4);
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments, a = azimuth[0] + u * (azimuth[1] - azimuth[0]);
    const x = centre[0] + radius * Math.sin(a), z = centre[2] - radius * Math.cos(a);
    positions.set([x, y[0], z, x, y[1], z], i * 6);
    uvs.set([u, 0, u, 1], i * 4);
    // Wound to face the cylinder axis.
    if (i < segments) indices.push(i*2, i*2 + 1, i*2 + 2, i*2 + 2, i*2 + 1, i*2 + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Buildings and the far tree line as photographed, on a cylinder beyond the
 * modelled lawn. Shown with the photographs' own exposure and haze, so it takes
 * neither scene lighting nor fog. It is appearance only: no collision, no wind.
 */
export async function loadCaptureBackdrop(base: string, signal: AbortSignal, maxAnisotropy: number) {
  const response = await fetch(base + 'backdrop.json', {signal});
  if (!response.ok) throw new Error('Backdrop placement unavailable');
  const placement: BackdropPlacement = await response.json();
  const image = await fetch(base + 'panorama.webp', {signal});
  if (!image.ok) throw new Error('Backdrop panorama unavailable');
  const bitmap = await createImageBitmap(await image.blob(), {imageOrientation: 'flipY', premultiplyAlpha: 'none'});
  const map = new THREE.Texture(bitmap);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = Math.min(8, maxAnisotropy);
  map.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({map, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide});
  const mesh = new THREE.Mesh(backdropGeometry(placement), material);
  mesh.name = 'Photographed distant scene';
  mesh.renderOrder = -50;
  mesh.userData = {placement, basis: 'Registered photographs on a single-radius cylinder; parallax not modelled'};
  return {
    mesh,
    dispose() { mesh.geometry.dispose(); material.dispose(); map.dispose(); bitmap.close(); },
  };
}
