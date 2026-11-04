// シード付き疑似乱数（mulberry32）
// 状態はプレーンオブジェクトなので JSON シリアライズ可能
// ロジック内で乱数が必要な場合は必ずこれを使い、Math.random は使わない

// シードから乱数状態を作る
export function createRng(seed) {
  return { s: (seed >>> 0) || 1 };
}

// 0以上1未満の浮動小数を返し、状態を進める
export function nextFloat(rng) {
  rng.s = (rng.s + 0x6D2B79F5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// min以上max以下の整数を返す
export function nextInt(rng, min, max) {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}
