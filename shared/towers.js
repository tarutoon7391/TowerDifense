// タワーのレベル別ステータス計算（config の値と UPGRADE 倍率から導出）
import { TOWERS, UPGRADE } from './config.js';

// level（1始まり）でのステータスを返す。攻撃しないタワーは range/damage が undefined のまま
export function getTowerStats(type, level = 1) {
  const def = TOWERS[type];
  const i = Math.max(0, Math.min(UPGRADE.maxLevel, level) - 1);
  const stats = {
    type,
    level,
    name: def.name,
    attack: def.attack,
    damageType: def.damageType,
    cost: def.cost,
    range: def.range !== undefined ? def.range + UPGRADE.rangeAdd[i] : undefined,
    damage: def.damage !== undefined ? Math.round(def.damage * UPGRADE.damageMul[i]) : undefined,
    cooldown: def.cooldown !== undefined ? def.cooldown * UPGRADE.cooldownMul[i] : undefined,
    projectileSpeed: def.projectileSpeed,
    splashRadius: def.splashRadius,
    groundOnly: !!def.groundOnly,
    pierceArmor: !!def.pierceArmor,
    undeadMul: def.undeadMul || 1,
    chain: def.chain || null,
    poison: def.poison || null,
    slow: def.slow
      ? { factor: Math.max(0.1, def.slow.factor + UPGRADE.slowFactorAdd[i]), duration: def.slow.duration }
      : null,
    income: def.income !== undefined ? Math.round(def.income * UPGRADE.incomeMul[i]) : 0,
  };
  return stats;
}

// level から level+1 へ上げる費用。最大レベルなら null
export function upgradeCost(type, level) {
  if (level >= UPGRADE.maxLevel) return null;
  return Math.round(TOWERS[type].cost * UPGRADE.costMul[level]);
}
