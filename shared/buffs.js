// 支援建築のバフ集計・隣接シナジー・地形相性・警鐘ブースト・経済系建築による全体修正値
// どれも「重複せず最大（割引は最小）が有効」。state は読むだけ
import { ECONOMY, SYNERGIES, TERRAIN, CELL_WATER } from './config.js';
import { getTowerStats } from './towers.js';
import { cellIndex, inBounds } from './state.js';

// バフの初期値（何も受けていない状態）
export function emptyBuff() {
  return { damageMul: 1, rangeAdd: 0, cooldownMul: 1, critAdd: 0, flyingMul: 1, statusDurationMul: 1, sources: 0, boosted: false };
}

// 転送門の組（設置順に2基で1組）
export function portalsOf(state) {
  const ps = state.towers.filter((t) => t.type === 'portal');
  const out = [];
  for (let i = 0; i + 1 < ps.length; i += 2) {
    out.push({ a: { x: ps[i].x, y: ps[i].y }, b: { x: ps[i + 1].x, y: ps[i + 1].y } });
  }
  return out;
}

// tower が受けている支援効果を集計する
export function computeBuffFor(state, tower) {
  const target = getTowerStats(tower.type, tower.level, tower.branch);
  const out = emptyBuff();
  if (target.attack === 'none') return out;
  const tx = tower.x + 0.5;
  const ty = tower.y + 0.5;
  for (const s of state.towers) {
    if (s === tower) continue;
    const st = getTowerStats(s.type, s.level, s.branch);
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
  // 警鐘のブースト（ウェーブ中の一時効果。支援とは別枠で掛け算）
  if (tower.boostUntil && state.waveTick < tower.boostUntil) {
    out.damageMul *= tower.boostMul || 1;
    out.boosted = true;
  }
  return out;
}

// 8方向に隣接する建物の種類一覧
function adjacentTypes(state, tower) {
  const types = new Set();
  for (const t of state.towers) {
    if (t === tower) continue;
    if (Math.abs(t.x - tower.x) <= 1 && Math.abs(t.y - tower.y) <= 1) types.add(t.type);
  }
  return types;
}

// tower に発動している隣接シナジーの一覧
export function activeSynergies(state, tower) {
  const adj = adjacentTypes(state, tower);
  const out = [];
  for (const s of SYNERGIES) {
    if ((tower.type === s.a && adj.has(s.b)) || (tower.type === s.b && adj.has(s.a))) out.push(s);
  }
  return out;
}

// 地形相性: 高台（射程）・水辺（減速強化）
export function terrainBonus(state, tower) {
  const out = { hill: !!tower.onHill, shore: false };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = tower.x + dx;
    const ny = tower.y + dy;
    if (inBounds(state.map, nx, ny) && state.grid[cellIndex(state.map, nx, ny)] === CELL_WATER) out.shore = true;
  }
  return out;
}

// 支援効果・シナジー・地形・警鐘を適用した実効ステータス
export function effectiveStats(state, tower) {
  const base = getTowerStats(tower.type, tower.level, tower.branch);
  const buff = computeBuffFor(state, tower);
  const syn = activeSynergies(state, tower);
  const terrain = terrainBonus(state, tower);
  const out = { ...base, applied: buff, synergies: syn.map((s) => s.name), terrain };
  if (base.attack === 'none') return out;

  if (base.damage !== undefined) out.damage = Math.round(base.damage * buff.damageMul);
  if (base.range !== undefined) out.range = base.range + buff.rangeAdd + (terrain.hill ? TERRAIN.hillRangeAdd : 0);
  if (base.cooldown !== undefined) out.cooldown = base.cooldown * buff.cooldownMul;
  out.flyingMul = base.flyingMul * buff.flyingMul;
  if (buff.critAdd > 0) {
    out.crit = base.crit
      ? { chance: Math.min(1, base.crit.chance + buff.critAdd), mul: base.crit.mul }
      : { chance: buff.critAdd, mul: 2 };
  }
  out.statusDurationMul = buff.statusDurationMul;
  if (base.poison) out.poison = { dps: Math.round(base.poison.dps * buff.damageMul), duration: base.poison.duration };
  if (base.slow && terrain.shore) {
    out.slow = { factor: Math.max(0.1, base.slow.factor + TERRAIN.shoreSlowAdd), duration: base.slow.duration };
  }
  // 隣接シナジー
  for (const s of syn) {
    if (s.splashMul && out.splashRadius) out.splashRadius *= s.splashMul;
    if (s.rangeAdd && out.range !== undefined) out.range += s.rangeAdd;
    if (s.poisonMul && out.poison) out.poison = { dps: Math.round(out.poison.dps * s.poisonMul), duration: out.poison.duration };
    if (s.critAdd) {
      out.crit = out.crit
        ? { chance: Math.min(1, out.crit.chance + s.critAdd), mul: out.crit.mul }
        : { chance: s.critAdd, mul: 2 };
    }
    if (s.undeadExecuteChance) out.undeadExecuteChance = Math.max(out.undeadExecuteChance || 0, s.undeadExecuteChance);
  }
  return out;
}

// 経済系建築・契約による全体修正値
export function economyModifiers(state) {
  const mod = {
    sellRate: ECONOMY.sellRefundRate, wallSellRate: ECONOMY.sellRefundRate,
    upgradeDiscount: 1, bonusMul: 1, previewWaves: 0, manaPerWave: 0,
    enemyHpMul: 1, rewardMul: 1,
  };
  for (const t of state.towers) {
    const st = getTowerStats(t.type, t.level, t.branch);
    if (st.sellRate > mod.sellRate) mod.sellRate = st.sellRate;
    if (st.wallSellRate > mod.wallSellRate) mod.wallSellRate = st.wallSellRate;
    if (st.upgradeDiscount < mod.upgradeDiscount) mod.upgradeDiscount = st.upgradeDiscount;
    if (st.bonusMul > mod.bonusMul) mod.bonusMul = st.bonusMul;
    if (st.previewWaves > mod.previewWaves) mod.previewWaves = st.previewWaves;
    mod.manaPerWave += st.manaPerWave;
    if (st.pact) {
      mod.enemyHpMul = Math.max(mod.enemyHpMul, st.pact.enemyHpMul);
      mod.rewardMul = Math.max(mod.rewardMul, st.pact.rewardMul);
    }
  }
  if (mod.wallSellRate < mod.sellRate) mod.wallSellRate = mod.sellRate;
  return mod;
}
