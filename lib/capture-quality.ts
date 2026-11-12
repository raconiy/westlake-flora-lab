/**
 * Rendering budget for the captured lawn. The scene is the same on every
 * device; only sampling density changes: laminae per tree, shadow-map size and
 * pixel ratio. Nothing here alters geometry the mechanics read.
 */
export interface CaptureQuality {
  tier: 'high' | 'medium' | 'low';
  laminaePerTree: number;
  shadowMapSize: number;
  pixelRatio: number;
}

export interface DeviceHints {
  /** WEBGL_debug_renderer_info string, when the browser exposes it. */
  renderer?: string;
  mobile?: boolean;
  devicePixelRatio?: number;
  maxTextureSize?: number;
  /** Explicit request, e.g. from ?quality=. */
  override?: string | null;
}

const tiers: Record<CaptureQuality['tier'], Omit<CaptureQuality, 'tier' | 'pixelRatio'> & {maxPixelRatio: number}> = {
  high: {laminaePerTree: 40000, shadowMapSize: 4096, maxPixelRatio: 1.5},
  medium: {laminaePerTree: 18000, shadowMapSize: 2048, maxPixelRatio: 1.25},
  low: {laminaePerTree: 7000, shadowMapSize: 1024, maxPixelRatio: 1},
};

// Software rasterisers and integrated graphics of the classes that cannot hold
// several million triangles with a 4096 shadow map.
const software = /swiftshader|llvmpipe|software|basic render/i;
const discrete = /nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc\b|apple m\d/i;

export function chooseCaptureQuality(hints: DeviceHints = {}): CaptureQuality {
  let tier: CaptureQuality['tier'];
  const name = hints.renderer ?? '';
  if (hints.override === 'high' || hints.override === 'medium' || hints.override === 'low') tier = hints.override;
  else if (hints.mobile || software.test(name)) tier = 'low';
  else if (discrete.test(name)) tier = 'high';
  // Unknown hardware is treated as integrated: starting light and looking
  // sparse is recoverable, starting heavy and stalling the page is not.
  else tier = 'medium';
  const budget = tiers[tier];
  const ratio = Math.min(Number.isFinite(hints.devicePixelRatio) && hints.devicePixelRatio! > 0 ? hints.devicePixelRatio! : 1, budget.maxPixelRatio);
  const texture = Number.isFinite(hints.maxTextureSize) && hints.maxTextureSize! > 0 ? hints.maxTextureSize! : budget.shadowMapSize;
  return {tier, laminaePerTree: budget.laminaePerTree, shadowMapSize: Math.min(budget.shadowMapSize, texture), pixelRatio: ratio};
}
