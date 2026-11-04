// 支援建築のバフ集計と、経済系建築による全体修正値
// どちらも「重複せず最大（割引は最小）が有効」。state は読むだけ
import { ECONOMY } from './config.js';
import { getTowerStats } from './towers.js';

// バフの初期値（何も受けていない状態）
export function emptyBuff() {
  return { damageMul: 1, rangeAdd: 0, cooldownMul: 1, critAdd: 0, flyingMul: 1, statusDurationMul: 1, sources: 0 };
}

// tower が受けている支援効果を集計する
export function computeBuffFor(state, tower) {
  const target = getTowerStats(tower.type, tower.level);
  const out = emptyBuff();
  if (target.attack === 'none') return out;
  const tx = tower.x + 0.5;
  const ty = tower.y + 0.5;
  for (const s of state.towers) {
    if (s === tower) continue;
    const st = getTowerStats(s.type, s.level);
    const b = st.buff;
    if (!b) continue;
    if (b.only && b.only !== target.damageType) continue;
    if (Math.hypot(s.x + 0.5 - tx, s.y + 0.5 - ty) > b.range) continue;
    out.damageMul = Math.max(out.damageMul, b.damageMul);
    out.rangeAdd = Math.max(out.rangeAdd, b.rangeAdd);
    out.cooldownMul = Math.min(out.cooldownMul, b.cooldownMul);
    out.critAdd = Math.max(out.critAdd, b.critAdd);
    out.flyingMul = Math.max(out.flyingMul, b.flyingMul);
    out.statusDurationMul = Math.max(out.statusDurationMul, b.statusDurationMul);
    out.sources += 1;
  }
  return out;
}

// 支援効果を適用した実効ステータス
export function effectiveStats(state, tower) {
  const base = getTowerStats(tower.type, tower.level);
  const buff = computeBuffFor(state, tower);
  if (buff.sources === 0) return { ...base, buff: base.buff, applied: buff };
  const out = { ...base, applied: buff };
  if (base.damage !== undefined) out.damage = Math.round(base.damage * buff.damageMul);
  if (base.range !== undefined) out.range = base.range + buff.rangeAdd;
  if (base.cooldown !== undefined) out.cooldown = base.cooldown * buff.cooldownMul;
  out.flyingMul = base.flyingMul * buff.flyingMul;
  if (buff.critAdd > 0) {
    out.crit = base.crit
      ? { chance: Math.min(1, base.crit.chance + buff.critAdd), mul: base.crit.mul }
      : { chance: buff.critAdd, mul: 2 };
  }
  out.statusDurationMul = buff.statusDurationMul;
  if (base.poison) out.poison = { dps: Math.round(base.poison.dps * buff.damageMul), duration: base.poison.duration };
  return out;
}

// 経済系建築による全体修正値（売却率・強化割引・クリアボーナス倍率・先読みウェーブ数）
export function economyModifiers(state) {
  const mod = { sellRate: ECONOMY.sellRefundRate, upgradeDiscount: 1, bonusMul: 1, previewWaves: 0 };
  for (const t of state.towers) {
    const st = getTowerStats(t.type, t.level);
    if (st.sellRate > mod.sellRate) mod.sellRate = st.sellRate;
    if (st.upgradeDiscount < mod.upgradeDiscount) mod.upgradeDiscount = st.upgradeDiscount;
    if (st.bonusMul > mod.bonusMul) mod.bonusMul = st.bonusMul;
    if (st.previewWaves > mod.previewWaves) mod.previewWaves = st.previewWaves;
  }
  return mod;
}
