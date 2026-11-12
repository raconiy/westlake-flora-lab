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

/**
 * Generic far tree line for the bearings no photograph covers. Without it the
 * lawn runs to a bare horizon as soon as the view leaves the photographed arc.
 * It is a prior, not a reconstruction: a continuous canopy silhouette 8 to 16 m
 * tall at 150 m, in the display colours of the photographed far trees, lit from
 * the scene's sun bearing and hazed like them. The photographed backdrop stands
 * in front of it and replaces it wherever photographs exist.
 */
export function createDistantTreeLine(centre: [number, number, number], sunDirection: THREE.Vector3, radius = 150) {
  const geometry = backdropGeometry({centre, radius, azimuth: [-Math.PI, Math.PI], y: [-2, 20]}, 192);
  const material = new THREE.ShaderMaterial({
    uniforms: {sunBearing: {value: Math.atan2(sunDirection.x, -sunDirection.z)}},
    vertexShader: /* glsl */`
      varying vec2 vLine;
      void main() {
        vLine = vec2(uv.x * 6.2831853, position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vLine;
      uniform float sunBearing;
      float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
      // Periodic in bearing, so the line closes on itself without a seam.
      float lumps(float bearing, float cells) {
        float x = bearing / 6.2831853 * cells, i = floor(x), f = fract(x);
        f = f * f * (3. - 2. * f);
        return mix(hash(mod(i, cells) + cells), hash(mod(i + 1., cells) + cells), f);
      }
      // Crown-sized mottling in bearing and height; periodic in bearing.
      float mottle(vec2 p, float cells) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        float a = hash(mod(i.x, cells) + i.y * 57.), b = hash(mod(i.x + 1., cells) + i.y * 57.);
        float c = hash(mod(i.x, cells) + (i.y + 1.) * 57.), d = hash(mod(i.x + 1., cells) + (i.y + 1.) * 57.);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float canopy(float bearing) {
        return 8. + 5. * lumps(bearing, 90.) + 2.2 * lumps(bearing, 330.) + .8 * lumps(bearing, 1100.);
      }
      void main() {
        float top = canopy(vLine.x), y = vLine.y;
        vec2 crown = vec2(vLine.x / 6.2831853 * 420., y * .45);
        float cover = 1. - smoothstep(top - .9, top, y + 1.1 * mottle(crown * 2.3, 966.));
        if (cover < .02) discard;
        // Crowns facing the sun bearing are lit; the slope of the silhouette
        // stands in for the crown surface.
        float slope = canopy(vLine.x + .004) - canopy(vLine.x - .004);
        float facing = .5 + .5 * cos(vLine.x - sunBearing);
        float lit = clamp(.35 + .5 * facing + .25 * slope * sign(sin(sunBearing - vLine.x)), 0., 1.) * smoothstep(1., top, y + 3.);
        vec3 colour = mix(vec3(.19, .25, .16), vec3(.42, .46, .24), lit);
        // Sunlit crown tops over shaded undersides, crown by crown.
        colour *= .62 + .55 * mottle(crown, 420.) + .18 * mottle(crown * 3.7, 1554.);
        // The same haze the photographed far trees carry at this range.
        colour = mix(colour, vec3(.74, .82, .9), .3);
        gl_FragColor = vec4(colour, cover);
      }`,
    transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Generic distant tree line';
  mesh.renderOrder = -60;
  mesh.userData = {basis: 'Prior, not reconstructed: continuous canopy silhouette for bearings without photographs'};
  return {mesh, dispose() { geometry.dispose(); material.dispose(); }};
}
