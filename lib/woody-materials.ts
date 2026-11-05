import * as THREE from 'three';

export type WoodySurfaceSpecies = 'osmanthus' | 'camphor' | 'acer';
type OwnTexture = (texture: THREE.DataTexture) => void;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const source = (slug: string) => `https://plants.ces.ncsu.edu/plants/${slug}/`;
/** Sources constrain topology and smooth/furrowed age classes only. None of the
 * RGB, roughness, vein widths, tile sizes, age transitions or bump amplitudes
 * below are measured reflectance, spectral constants or measured relief.
 * Photos are inspected references, never texture inputs or redistributed here.
 */
export const WOODY_SURFACE_EVIDENCE = {
  osmanthus: { source: source('osmanthus-fragrans'), image: 'public/references/osmanthus-leaf-flower.jpg',
    rule: 'visible midrib, pinnate secondaries and reticulation; text: leathery, lustrous; smooth bark' },
  camphor: { source: source('cinnamomum-camphora'), image: 'public/references/camphor-leaves.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Starr_060429-8045_Cinnamomum_camphora.jpg',
    rule: 'visible three strong basal veins; text: glossy upper lamina, new twigs green to red-brown, older bark scaly/furrowed with flat-topped ridges' },
  acer: { source: source('acer-palmatum'), image: 'public/references/acer-autumn.jpg',
    rule: 'visible palmate veins to lobes; text: 5–9 lobes, smooth bark, young green/reddish stems, older gray branches' },
  status: 'unmeasured appearance priors; qualitative source constraints, not campus calibration',
  limitations: 'one two-sided leaf material; no measured abaxial reflectance, vein metric, relief or roughness; merged lateral wood stays conservatively smooth',
} as const;

function texture(data: Uint8Array, width: number, height: number, label: string, color: boolean, repeat: boolean, own: OwnTexture) {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  t.name = `woody:${label}`;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true; own(t); return t;
}
function channels(size: number) { return [new Uint8Array(size * 4), new Uint8Array(size * 4), new Uint8Array(size * 4)]; }
function gray(data: Uint8Array, offset: number, value: number) {
  data[offset] = data[offset + 1] = data[offset + 2] = Math.round(clamp(value) * 255); data[offset + 3] = 255;
}

/** Changes UV only. The existing blade base stays (0,0,0); no silhouette,
 * normals, indexing, instances, bounds or material shader hooks are changed.
 * Shared explicit transforms are inverted by the vein graph below. */
export function mapWoodyLeafUV(geometry: THREE.BufferGeometry, species: WoodySurfaceSpecies) {
  const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    uv.setXY(i, .5 + x / (species === 'acer' ? .0924 : species === 'camphor' ? .05 : .05568),
      species === 'acer' ? (y + .01725) / .06 : y / (species === 'camphor' ? .095 : .1189));
  }
  uv.needsUpdate = true;
}

type Line = { ax: number; ay: number; bx: number; by: number; width: number; strength: number };
function veinGraph(species: WoodySurfaceSpecies): Line[] {
  const lines: Line[] = [];
  const line = (ax: number, ay: number, bx: number, by: number, width: number, strength = 1) => lines.push({ ax, ay, bx, by, width, strength });
  if (species === 'acer') {
    // Same seven lobe axes as the existing blade, after its .88/.75 scaling.
    // Veins end inside the lobe tip; branches stay local to each narrow lobe.
    for (let l = 0; l < 7; l++) {
      const a = -2 + l * 2 / 3, r = .052 * (1 - Math.abs(a) * .13);
      const ex = Math.sin(a) * r * .88, ey = Math.cos(a) * r * .75;
      line(0, 0, ex * .96, ey * .96, .00026);
      for (let k = 2; k < 6; k++) for (const side of [-1, 1]) {
        const t = k / 7, width = .0024 * (1 - t);
        line(ex * t, ey * t, ex * (t + .14) + side * Math.cos(a) * width, ey * (t + .14) - side * Math.sin(a) * width, .00011, .45);
      }
    }
  } else {
    const length = species === 'camphor' ? .095 : .1189;
    line(0, 0, 0, length * .99, .00036);
    if (species === 'camphor') {
      // Two curved basal laterals plus the midrib, all rooted in the lamina.
      for (const side of [-1, 1]) for (let k = 0; k < 24; k++) {
        const point = (t: number) => [side * .0125 * Math.sin(t * Math.PI), length * (.025 + .92 * t)];
        const a = point(k / 24), b = point((k + 1) / 24); line(a[0], a[1], b[0], b[1], .00028, .85);
      }
    }
    for (let k = 1; k <= 8; k++) for (const side of [-1, 1]) {
      const y = length * (.08 + k * .085), x = side * (species === 'camphor' ? .016 : .018) * Math.sin(y / length * Math.PI);
      line(0, y, x, Math.min(length * .95, y + length * .14), .00015, .55);
      // Connect adjacent secondary veins into a faint irregular network.
      // Density and exact connections remain appearance priors.
      if (k < 8) for (let j = 1; j < 4; j++) {
        const t = j / 4, nextY = y + length * .085,
          nextX = side * (species === 'camphor' ? .016 : .018) * Math.sin(nextY / length * Math.PI),
          nextT = t + .035 * Math.sin(k * 2.1 + j);
        line(x * t, y + length * .14 * t, nextX * nextT, nextY + length * .14 * nextT, .000075, .22);
      }
    }
  }
  return lines;
}
function lineDistance(x: number, y: number, l: Line) {
  const dx = l.bx - l.ax, dy = l.by - l.ay;
  const t = clamp(((x - l.ax) * dx + (y - l.ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - l.ax - t * dx, y - l.ay - t * dy);
}

/** Bake the actual indexed silhouette into the detail mask. Outside pixels
 * remain opaque neutral pigment: geometry alone clips the leaf and all three
 * shadow passes, so no alpha fringe can float outside the silhouette. */
export function wireWoodyLeafSurface(material: THREE.MeshStandardMaterial, geometry: THREE.BufferGeometry, species: WoodySurfaceSpecies, own: OwnTexture) {
  mapWoodyLeafUV(geometry, species);
  const n = 192, [pigment, bump, roughness] = channels(n * n), mask = new Uint8Array(n * n);
  const uv = geometry.getAttribute('uv'), ix = geometry.index;
  for (let i = 0; i < (ix?.count ?? uv.count); i += 3) {
    const indices = [0, 1, 2].map(k => ix ? ix.getX(i + k) : i + k);
    const points = indices.map(j => new THREE.Vector2(uv.getX(j) * n, uv.getY(j) * n));
    const [a, b, c] = points, cross = (x: number, y: number, p: THREE.Vector2, q: THREE.Vector2) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    for (let y = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)))); y < Math.min(n, Math.ceil(Math.max(...points.map(p => p.y)))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)))); x < Math.min(n, Math.ceil(Math.max(...points.map(p => p.x)))); x++) {
        const e = [cross(x + .5, y + .5, a, b), cross(x + .5, y + .5, b, c), cross(x + .5, y + .5, c, a)];
        if (e.every(v => v >= 0) || e.every(v => v <= 0)) mask[y * n + x] = 1;
      }
    }
  }
  const lines = veinGraph(species), baseRoughness = species === 'acer' ? .74 : species === 'camphor' ? .48 : .56;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + .5) / n, v = (y + .5) / n, px = (u - .5) * (species === 'acer' ? .0924 : species === 'camphor' ? .05 : .05568),
      py = species === 'acer' ? v * .06 - .01725 : v * (species === 'camphor' ? .095 : .1189);
    let vein = 0;
    if (mask[y * n + x]) for (const l of lines) vein = Math.max(vein, clamp(1 - lineDistance(px, py, l) / l.width) * l.strength);
    const grain = mask[y * n + x] ? Math.sin(x * 1.73 + Math.sin(y * .81)) * Math.sin(y * 2.31 + x * .27) : 0;
    const o = (y * n + x) * 4;
    // Muted pigment multipliers retain seasonal/instance pigments. A modest
    // pale vein contrast survives the organ viewer mip levels; this is an
    // unmeasured display prior, not reconstructed spectral reflectance.
    pigment[o] = 222 + vein * 30 + grain * 2; pigment[o + 1] = 234 + vein * 20 + grain * 2; pigment[o + 2] = 210 + vein * 34 + grain * 2; pigment[o + 3] = 255;
    gray(bump, o, .46 + .30 * vein + .018 * grain);
    gray(roughness, o, baseRoughness + .07 * vein + .025 * grain);
  }
  material.map = texture(pigment, n, n, `${species}:leaf:pigment`, true, false, own);
  material.bumpMap = texture(bump, n, n, `${species}:leaf:microrelief`, false, false, own);
  material.roughnessMap = texture(roughness, n, n, `${species}:leaf:roughness`, false, false, own);
  material.roughness = 1; material.bumpScale = .000035; material.needsUpdate = true;
  material.userData.woodySurface = { species, organ: 'lamina', evidence: WOODY_SURFACE_EVIDENCE[species], status: WOODY_SURFACE_EVIDENCE.status,
    bumpScaleSceneUnits: material.bumpScale, note: 'renderer bump parameter, not measured metres of displacement; no vertex displacement' };
}

export const BARK_TILE_METRES = [.32, 1.28] as const;
/** u is base-circumference distance, v axial distance. Fixed base circumference
 * avoids diagonal shear across taper. Distal texel width contracts with taper.
 * Cylinder caps get planar UVs; curved tubes have no caps. UV-only mutation. */
export function mapWoodyBarkUV(geometry: THREE.BufferGeometry, radius: number, length: number) {
  const uv = geometry.getAttribute('uv'), cylinder = geometry instanceof THREE.CylinderGeometry;
  const torso = cylinder ? (geometry.parameters.radialSegments + 1) * (geometry.parameters.heightSegments + 1) : uv.count;
  const p = geometry.getAttribute('position');
  for (let i = 0; i < uv.count; i++) {
    if (i < torso) uv.setXY(i, uv.getX(i) * Math.PI * 2 * radius / BARK_TILE_METRES[0],
      (cylinder ? uv.getY(i) * length : uv.getY(i)) / BARK_TILE_METRES[1]);
    else uv.setXY(i, p.getX(i) / BARK_TILE_METRES[0], p.getZ(i) / BARK_TILE_METRES[1]);
  }
  uv.needsUpdate = true;
}

/** All merged lateral axes deliberately use the smooth young-wood set. Only
 * the separate main stem can acquire camphor's older flat-ridge appearance;
 * age 5–18 blending is a conservative appearance prior, not tissue dating. */
export function wireWoodyBarkSurface(material: THREE.MeshStandardMaterial, species: WoodySurfaceSpecies, age: number, young: boolean, seed: number, own: OwnTexture) {
  const w = 128, h = 256, [pigment, bump, roughness] = channels(w * h);
  const older = young ? 0 : clamp((age - 5) / 13), ridged = species === 'camphor' ? older : 0;
  const base = species === 'acer' ? [mix(139, 159, older), mix(106, 153, older), mix(91, 140, older)]
    : species === 'camphor' ? [mix(132, 125, older), mix(133, 123, older), mix(96, 112, older)] : [mix(139, 146, older), mix(143, 143, older), mix(112, 126, older)];
  const juvenileT = species === 'acer' ? clamp((age - .12) / .38) : 1;
  const skinMaturity = juvenileT * juvenileT * (3 - 2 * juvenileT);
  if (species === 'acer') for (let c = 0; c < 3; c++) base[c] = mix(245, base[c], skinMaturity);
  const phase = (Number.isFinite(seed) ? seed % 997 : 1) * .07;
  // Periodic, irregular elongated fields. No checker cells, cross-hatched
  // grid, photo sampling, shader injection or per-frame texture uploads.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w * Math.PI * 2, v = y / h * Math.PI * 2;
    const mottling = .45 * Math.sin(3 * u + Math.sin(v) + phase) + .3 * Math.sin(7 * u - 2 * v + phase) + .25 * Math.sin(13 * u + 3 * v);
    const grain = Math.sin(31 * u + Math.sin(2 * v)) * Math.sin(7 * v + 5 * u) * .5;
    const ridge = Math.pow(Math.max(0, Math.sin(11 * u + .45 * Math.sin(2 * v) + .25 * Math.sin(5 * v + phase))), 12);
    const shade = 1 + .05 * mottling + .018 * grain - ridged * .13 * ridge, o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) pigment[o + c] = base[c] * shade; pigment[o + 3] = 255;
    gray(bump, o, .52 + .035 * grain + .025 * mottling - ridged * .12 * ridge);
    gray(roughness, o, .77 + older * .06 + .045 * mottling + ridged * .04 * ridge);
  }
  const label = `${species}:${young ? 'young-wood' : 'main-stem'}`;
  material.map = texture(pigment, w, h, `${label}:pigment`, true, true, own);
  material.bumpMap = texture(bump, w, h, `${label}:microrelief`, false, true, own);
  material.roughnessMap = texture(roughness, w, h, `${label}:roughness`, false, true, own);
  material.color.set('#ffffff'); material.roughness = 1; material.bumpScale = young ? .00004 : .00008 + ridged * .00012; material.needsUpdate = true;
  material.userData.woodySurface = { species, organ: young ? 'young-wood' : 'main-stem', evidence: WOODY_SURFACE_EVIDENCE[species],
    status: WOODY_SURFACE_EVIDENCE.status, ageClass: young ? 'conservative smooth lateral wood' : 'illustrative main-stem age blend',
    bumpScaleSceneUnits: material.bumpScale, tileMetres: BARK_TILE_METRES, note: 'bump parameter is not measured relief; no geometry displacement' };
}
