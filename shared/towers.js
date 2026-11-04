// タワーのレベル別ステータス計算（config の値と UPGRADE 倍率、Lv3 分岐から導出）
import { TOWERS, UPGRADE, COMBAT } from './config.js';

// level（1始まり）・branch（Lv3 分岐 'a'|'b'|null）でのステータスを返す
// 攻撃しないタワーは range/damage が undefined のまま
export function getTowerStats(type, level = 1, branch = null) {
  const def = TOWERS[type];
  const i = Math.max(0, Math.min(UPGRADE.maxLevel, level) - 1);
  const dmgMul = UPGRADE.damageMul[i];
  const bMul = UPGRADE.buffMul[i];
  const stats = {
    type,
    level,
    branch: null,
    branchName: '',
    genre: def.genre,
    name: def.name,
    attack: def.attack,
    damageType: def.damageType,
    cost: def.cost,
    range: def.range !== undefined ? def.range + UPGRADE.rangeAdd[i] : undefined,
    damage: def.damage !== undefined ? Math.round(def.damage * dmgMul) : undefined,
    cooldown: def.cooldown !== undefined ? def.cooldown * UPGRADE.cooldownMul[i] : undefined,
    projectileSpeed: def.projectileSpeed,
    splashRadius: def.splashRadius || 0,
    groundOnly: !!def.groundOnly,
    pierceArmor: !!def.pierceArmor,
    leadTarget: !!def.leadTarget,
    undeadMul: def.undeadMul || 1,
    flyingMul: def.flyingMul || 1,
    groundMul: def.groundMul || 1,
    bossMul: def.bossMul || 1,
    lineWidth: def.lineWidth || 0,
    chain: def.chain ? { ...def.chain } : null,
    multishot: def.multishot || 1,
    executeBelow: def.executeBelow || 0,
    ramp: def.ramp || null,
    crit: def.crit ? { chance: def.crit.chance, mul: def.crit.mul || COMBAT.critMulDefault } : null,
    stun: def.stun || null,
    knockback: def.knockback || null,
    // 毒（継続ダメージ）もレベルで伸びる
    poison: def.poison
      ? { dps: Math.round(def.poison.dps * dmgMul), duration: def.poison.duration }
      : null,
    curse: def.curse || null,
    slow: def.slow
      ? { factor: Math.max(0.1, def.slow.factor + UPGRADE.slowFactorAdd[i]), duration: def.slow.duration }
      : null,
    // 支援効果: 倍率の「上乗せ分」がレベルで伸びる
    buff: def.buff
      ? {
          range: def.buff.range,
          only: def.buff.only || null,
          damageMul: def.buff.damageMul ? 1 + (def.buff.damageMul - 1) * bMul : 1,
          rangeAdd: (def.buff.rangeAdd || 0) * bMul,
          cooldownMul: def.buff.cooldownMul ? 1 - (1 - def.buff.cooldownMul) * bMul : 1,
          critAdd: (def.buff.critAdd || 0) * bMul,
          flyingMul: def.buff.flyingMul ? 1 + (def.buff.flyingMul - 1) * bMul : 1,
          statusDurationMul: def.buff.statusDurationMul ? 1 + (def.buff.statusDurationMul - 1) * bMul : 1,
        }
      : null,
    // 経済効果（収入系はレベルで伸びる。率や割引は固定）
    income: def.income !== undefined ? Math.round(def.income * UPGRADE.incomeMul[i]) : 0,
    incomeGrowth: def.incomeGrowth ? Math.round(def.incomeGrowth * UPGRADE.incomeMul[i]) : 0,
    interest: def.interest || null,
    livesPerWave: def.livesPerWave || 0,
    bonusMul: def.bonusMul || 1,
    sellRate: def.sellRate || 0,
    upgradeDiscount: def.upgradeDiscount || 1,
    bounty: def.bounty ? { range: def.bounty.range, gold: def.bounty.gold } : null, // 賞金は固定（強化で増えない）
    perTowerGold: def.perTowerGold || null,
    previewWaves: def.previewWaves || 0,
    manaPerWave: def.manaPerWave ? Math.round(def.manaPerWave * UPGRADE.incomeMul[i]) : 0,
    wallSellRate: def.wallSellRate || 0,
    pact: def.pact || null,
    gamble: def.gamble || null,
    // 属性（状態反応に使う）
    fire: !!def.fire,
    shatter: !!def.shatter,
    holy: !!def.holy,
    ground: def.ground || null,
    // 兵士・警鐘
    units: def.units ? { count: def.units.count, hp: Math.round(def.units.hp * dmgMul), range: def.units.range } : null,
    alarm: def.alarm || null,
    // 床・罠・壁・転送門の性質
    passable: !!def.passable,
    floor: def.floor || null,
    trap: def.trap || null,
    breakable: !!def.breakable,
    placeOn: def.placeOn || 'land',
    convertsToLand: !!def.convertsToLand,
    toggleable: !!def.toggleable,
    portal: !!def.portal,
    limit: def.limit || 0,
    branches: def.branches || null,
  };

  // Lv3 分岐の上書き
  if (branch && def.branches && def.branches[branch] && level >= UPGRADE.maxLevel) {
    const b = def.branches[branch];
    const m = b.mods;
    stats.branch = branch;
    stats.branchName = b.name;
    if (m.damageMul && stats.damage !== undefined) stats.damage = Math.round(stats.damage * m.damageMul);
    if (m.cooldownMul && stats.cooldown !== undefined) stats.cooldown *= m.cooldownMul;
    if (m.rangeAdd && stats.range !== undefined) stats.range += m.rangeAdd;
    if (m.pierceArmor) stats.pierceArmor = true;
    if (m.stun) stats.stun = m.stun;
    if (m.splashRadius) stats.splashRadius = Math.max(stats.splashRadius, m.splashRadius);
    if (m.splashMul) stats.splashRadius *= m.splashMul;
    if (m.poison) stats.poison = { dps: Math.round(m.poison.dps * dmgMul), duration: m.poison.duration };
    if (m.chainJumpsAdd && stats.chain) stats.chain.jumps += m.chainJumpsAdd;
    if (m.chainDecay && stats.chain) stats.chain.decay = m.chainDecay;
  }
  return stats;
}

// level から level+1 へ上げる費用（割引前）。最大レベルなら null
export function upgradeCost(type, level) {
  if (level >= UPGRADE.maxLevel) return null;
  return Math.round(TOWERS[type].cost * UPGRADE.costMul[level]);
}

// 次の強化で分岐を選ぶ必要があるか
export function needsBranchChoice(type, level) {
  return !!TOWERS[type].branches && level + 1 === UPGRADE.maxLevel;
}
