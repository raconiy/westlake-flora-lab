// Three.js world X/Z, model metres. The GLB scale assumes a 3.41 m lamp height.
// Registered core and original seed grid. Its first 384,606 accepted sites
// remain byte-identical; the outer planting is a visual engineering prior.
export const meadowCoreBounds = { minX: -20, maxX: 24, minZ: -42, maxZ: 10 } as const;
export const meadowBounds = {minX:-32,maxX:36,minZ:-54,maxZ:22} as const;

export function meadowFringeWeight(x:number,z:number):number {
  const b=meadowCoreBounds;
  const dx=Math.max(b.minX-x,0,x-b.maxX), dz=Math.max(b.minZ-z,0,z-b.maxZ);
  const distance=Math.hypot(dx,dz);
  if(!distance)return 1;
  // Variable outward reach avoids an offset rectangular contour. Use distance
  // to the nearest point on the core so the four corners transition radially.
  const width=8.4+1.55*Math.sin(.125*x+.188*z)+.95*Math.cos(.23*x-.132*z);
  const t=Math.min(1,distance/width);
  return 1-t*t*(3-2*t);
}

type Footprint = readonly [x: number, z: number, radius: number];

// Maximum horizontal radius of decoded trunk vertices in the lowest 16 cm,
// rounded upwards. The root flare is wider than the capsule of the upper stem.
const trunks: readonly Footprint[] = [
  [0, 0, .364], [-1.07756, -11.78153, .671], [-12.74475, -13.19544, .424],
  [1.76948, -12.02367, .147], [-12.20567, -24.12775, .182], [-13.83782, -39.60335, .161],
  [-12.05344, -32.88597, .174], [-10.86224, -36.24413, .147], [-5.95305, -39.83594, .147],
  [5.87940, -23.57280, .094], [7.45593, -21.65280, .112], [10.59779, -21.71227, .128],
];

// The post foot is 6.35 cm in radius. Small luminaires have a 4.2 cm foot
// and an inclined head; 12 cm is a conservative radius around the assembly.
const lamps: readonly Footprint[] = [
  [-5.82212, 0, .064], [-.66607, -.08685, .12], [.66613, -.07612, .12],
  [-12.03364, -10.96339, .12], [-2.55712, -11.58642, .12],
  [-7.88735, -18.30766, .12], [2.78168, -10.54750, .12],
];

type Point = readonly [number, number];
// Convex hull of support-plane rays through the corners of the green lid in
// photos 01, 02 and 13. The hull includes the spread between camera solutions.
// The dark low object at photo 01's right edge has no confirmed identity.
const obstacles: readonly (readonly Point[])[] = [
  [[-1.3732, 3.5764], [-.6696, 2.5172], [-.4893, 2.6042], [-.0348, 2.9949], [.143, 3.1811],
   [.1028, 3.2543], [-.5737, 4.2675], [-.6266, 4.2316], [-.8093, 4.0835]],
  [[3.0228, 3.8557], [3.2839, 3.1384], [3.8511, 3.4127], [3.5091, 4.2692]],
];

function nearPolygon(x: number, z: number, polygon: readonly Point[], radius: number): boolean {
  let inside = true;
  for (let k = 0; k < polygon.length; k++) {
    const a = polygon[k], b = polygon[(k + 1) % polygon.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const px = x - a[0], pz = z - a[1];
    if (dx * pz - dz * px < 0) inside = false;
    const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / (dx * dx + dz * dz)));
    const ex = px - t * dx, ez = pz - t * dz;
    if (ex * ex + ez * ez <= radius * radius) return true;
  }
  return inside;
}

const bases = [...trunks, ...lamps];
const verge = .025; // Additional padding beyond the packed stone extent.

/** True where a grass root and its optional horizontal reach (metres) fit. */
export function isMeadowPoint(x: number, z: number, margin = 0): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(margin) || margin < 0) return false;
  if (x <= meadowBounds.minX + margin || x >= meadowBounds.maxX - margin ||
      z <= meadowBounds.minZ + margin || z >= meadowBounds.maxZ - margin) return false;

  // Support lines in the decoded mesh. Everything on the camera side of the
  // near walk is excluded; planting on that side is outside the pictured lawn.
  const near = -.64991375 * x + .76000797 * z;
  if (near >= 3.93095 - verge - margin) return false;
  const cross = -.34559091 * x + .93838527 * z;
  if (cross >= -12.41253 - verge - margin && cross <= -10.70670 + verge + margin) return false;

  for (const [cx, cz, radius] of bases) {
    const dx = x - cx, dz = z - cz, clearance = radius + verge + margin;
    if (dx * dx + dz * dz <= clearance * clearance) return false;
  }
  // Both photo-only obstacles are confined to this small foreground region.
  if (x >= -1.5 - margin && x <= 4.1 + margin && z >= 2.3 - margin && z <= 4.5 + margin) {
    for (const polygon of obstacles) if (nearPolygon(x, z, polygon, .08 + margin)) return false;
  }
  return true;
}
