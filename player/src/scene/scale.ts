export interface MarkerScaleInput {
  mode: 'external' | 'satellite' | 'free';
  distance: number;
  satelliteSpan: number;
  transient: boolean;
  modelScale: number;
}

/**
 * One scale rule for every camera. The old formula used the camera distance,
 * which is ~1e6 m in satellite mode and made aircraft fill the map. Selection
 * is deliberately not an input: it must never change a model's size.
 */
export function markerScale(input: MarkerScaleInput): number {
  const modelScale = Math.max(0.01, input.modelScale);
  if (input.mode === 'satellite') {
    return Math.max(0.01, input.satelliteSpan * 0.0003) * modelScale;
  }
  return Math.max(0.2, Math.min(400, input.distance * 0.00026)) * modelScale;
}
