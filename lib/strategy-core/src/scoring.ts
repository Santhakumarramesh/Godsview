export interface ScoreInput {
  structure: number;
  orderflow: number;
  recall: number;
  ml: number;
  claude: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function computeFinalQualityScore(input: ScoreInput): number {
  const structure = clamp01(input.structure);
  const orderflow = clamp01(input.orderflow);
  const recall = clamp01(input.recall);
  const ml = clamp01(input.ml);
  const claude = clamp01(input.claude);

  return Number(
    (
      0.30 * structure +
      0.25 * orderflow +
      0.20 * recall +
      0.15 * ml +
      0.10 * claude
    ).toFixed(4),
  );
}
