// Scoring — points per word and combo / chain multipliers.
//
//   base    = 10 * length + 5 * (length - 3)^2     // longer words scale
//   combo   = +25% per consecutive clear within COMBO_WINDOW_MS
//   chain   = +50% per gravity-triggered chain step (set 1 = original word)
//
// We round to whole points at the end so floating UI labels stay clean.

export function wordBasePoints(word) {
  const n = word.length;
  if (n < 3) return 0;
  const longBonus = Math.max(0, n - 3);
  return 10 * n + 5 * longBonus * longBonus;
}

export function awardPoints({ word, comboCount, chainStep }) {
  const base = wordBasePoints(word);
  const comboMult = 1 + 0.25 * Math.max(0, comboCount - 1);
  const chainMult = 1 + 0.5 * Math.max(0, chainStep - 1);
  return Math.round(base * comboMult * chainMult);
}
