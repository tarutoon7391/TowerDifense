// シミュレーション: step(state) で固定タイムステップ（1tick = 1/30秒）だけ状態を進める
// 描画・入力には一切依存しない（DOM, Math.random, Date.now などは使わない）
import { DT, TICK_RATE, ENEMIES, ECONOMY, COMBAT, getStage } from './config.js';
import { PHASE, cellIndex } from './state.js';
import { nextCells } from './pathfinding.js';
import { nextInt } from './rng.js';
import { getTowerStats } from './towers.js';

// 演出オブジェクトの寿命（tick）
const EFFECT_TTL = { chain: 8, blast: 10, aura: 6 };

// 1tick 進める。状態オブジェクトを直接更新し、同じ参照を返す
export function step(state) {
  if (state.phase !== PHASE.WAVE) return state;
  state.tick += 1;
  state.waveTick += 1;

  spawnEnemies(state);
  moveEnemies(state);
  applyStatusEffects(state);
  updateTowers(state);
  updateProjectiles(state);
  updateEffects(state);
  cleanupEnemies(state);
  checkWaveEnd(state);
  return state;
}

// ---- 出現 ----
function makeEnemy(state, type, hpMul, x, y, cx, cy, tx, ty) {
  const def = ENEMIES[type];
  const hp = Math.round(def.hp * hpMul);
  return {
    id: state.nextId++,
    type,
    x, y,
    hp,
    maxHp: hp,
    hpMul,
    speed: def.speed,
    reward: def.reward,
    livesCost: def.livesCost ?? 1,
    armor: def.armor || 0,
    regen: def.regen || 0,
    flying: !!def.flying,
    undead: !!def.undead,
    boss: !!def.boss,
    cx, cy,           // 現在マス
    tx, ty,           // 目標マス（飛行はゴール固定）
    slowUntil: 0,     // この waveTick までスロウ
    slowFactor: 1,
    poisonUntil: 0,   // この waveTick まで毒
    poisonDps: 0,
    reached: false,   // ゴール到達フラグ
  };
}

function spawnEnemies(state) {
  const q = state.spawnQueue;
  const { start, goal } = state.map;
  while (q.length > 0 && q[0].spawnTick <= state.waveTick) {
    const item = q.shift();
    const def = ENEMIES[item.type];
    let target;
    if (def.flying) target = goal;
    else target = pickNextCell(state, start.x, start.y) || goal;
    state.enemies.push(makeEnemy(state, item.type, item.hpMul,
      start.x + 0.5, start.y + 0.5, start.x, start.y, target.x, target.y));
  }
}

// 次に進むマスをフローフィールドから選ぶ（同距離の候補が複数ならシード乱数で選ぶ）
function pickNextCell(state, x, y) {
  const cands = nextCells(state.flow, state.map, x, y);
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  return cands[nextInt(state.rng, 0, cands.length - 1)];
}

// ---- 移動 ----
function moveEnemies(state) {
  const goal = state.map.goal;
  for (const e of state.enemies) {
    if (e.reached || e.hp <= 0) continue;
    const factor = state.waveTick < e.slowUntil ? e.slowFactor : 1;
    let budget = e.speed * factor * DT;
    while (budget > 0 && !e.reached) {
      const gx = e.tx + 0.5;
      const gy = e.ty + 0.5;
      const dx = gx - e.x;
      const dy = gy - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        // 目標マスの中心に到着
        e.x = gx;
        e.y = gy;
        budget -= dist;
        e.cx = e.tx;
        e.cy = e.ty;
        if (e.cx === goal.x && e.cy === goal.y) {
          e.reached = true;
          break;
        }
        const next = pickNextCell(state, e.cx, e.cy);
        if (!next) { e.reached = true; break; } // 保険: 経路が無い場合はゴール扱い
        e.tx = next.x;
        e.ty = next.y;
      } else {
        e.x += (dx / dist) * budget;
        e.y += (dy / dist) * budget;
        budget = 0;
      }
    }
  }
}

// ---- 毒・再生 ----
function applyStatusEffects(state) {
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.reached) continue;
    if (state.waveTick < e.poisonUntil) e.hp -= e.poisonDps * DT; // 毒は魔法扱い（鎧無視）
    if (e.regen > 0 && e.hp > 0) e.hp = Math.min(e.maxHp, e.hp + e.regen * DT);
  }
}

// ゴールまでの残り距離の見積もり（索敵の優先度に使う。小さいほどゴールに近い）
function remainingDistance(state, e) {
  if (e.flying) {
    return Math.hypot(state.map.goal.x + 0.5 - e.x, state.map.goal.y + 0.5 - e.y);
  }
  const base = state.flow[cellIndex(state.map, e.tx, e.ty)];
  return (base < 0 ? 0 : base) + Math.hypot(e.tx + 0.5 - e.x, e.ty + 0.5 - e.y);
}

// タワーが狙える敵か
function canTarget(stats, e) {
  if (e.hp <= 0 || e.reached) return false;
  if (stats.groundOnly && e.flying) return false;
  return true;
}

// ---- タワー ----
function updateTowers(state) {
  for (const t of state.towers) {
    if (t.cooldown > 0) t.cooldown -= 1;
    if (t.cooldown > 0) continue;
    const stats = getTowerStats(t.type, t.level);
    if (stats.attack === 'none') continue;
    const cx = t.x + 0.5;
    const cy = t.y + 0.5;

    if (stats.attack === 'aura') {
      // 射程内の全敵に即時ダメージ
      let hitAny = false;
      for (const e of state.enemies) {
        if (!canTarget(stats, e)) continue;
        if (Math.hypot(e.x - cx, e.y - cy) > stats.range) continue;
        applyDamage(e, stats.damage, stats);
        hitAny = true;
      }
      if (hitAny) {
        t.cooldown = Math.round(stats.cooldown * TICK_RATE);
        state.effects.push({ kind: 'aura', x: cx, y: cy, r: stats.range, ttl: EFFECT_TTL.aura, towerType: t.type });
      }
      continue;
    }

    // 射程内で最もゴールに近い敵を狙う
    let target = null;
    let best = Infinity;
    for (const e of state.enemies) {
      if (!canTarget(stats, e)) continue;
      if (Math.hypot(e.x - cx, e.y - cy) > stats.range) continue;
      const rem = remainingDistance(state, e);
      if (rem < best) { best = rem; target = e; }
    }
    if (!target) continue;
    t.cooldown = Math.round(stats.cooldown * TICK_RATE);

    if (stats.attack === 'chain') {
      fireChain(state, t, stats, target);
      continue;
    }

    state.projectiles.push({
      id: state.nextId++,
      kind: stats.attack,          // 'homing' | 'splash'
      towerType: t.type,
      x: cx,
      y: cy,
      speed: stats.projectileSpeed,
      damage: stats.damage,
      damageType: stats.damageType,
      pierceArmor: stats.pierceArmor,
      groundOnly: stats.groundOnly,
      targetId: target.id,
      tx: target.x,                // 範囲攻撃は発射時点の位置を狙う
      ty: target.y,
      slow: stats.slow,
      poison: stats.poison,
      splashRadius: stats.splashRadius || 0,
    });
  }
}

// 連鎖雷: 最初の敵に当て、近くの未命中の敵へ順に跳ねる（威力は減衰）
function fireChain(state, tower, stats, first) {
  const hit = new Set();
  const pts = [[tower.x + 0.5, tower.y + 0.5]];
  let cur = first;
  let dmg = stats.damage;
  for (let j = 0; j <= stats.chain.jumps && cur; j++) {
    applyDamage(cur, Math.round(dmg), stats);
    hit.add(cur.id);
    pts.push([cur.x, cur.y]);
    dmg *= stats.chain.decay;
    // 次の跳躍先: 直前の命中敵から chain.range 内で最も近い未命中の敵
    let next = null;
    let bestD = Infinity;
    for (const e of state.enemies) {
      if (hit.has(e.id) || !canTarget(stats, e)) continue;
      const d = Math.hypot(e.x - cur.x, e.y - cur.y);
      if (d <= stats.chain.range && d < bestD) { bestD = d; next = e; }
    }
    cur = next;
  }
  state.effects.push({ kind: 'chain', pts, ttl: EFFECT_TTL.chain, towerType: tower.type });
}

// ---- 弾 ----
function updateProjectiles(state) {
  const alive = [];
  for (const p of state.projectiles) {
    const moved = p.speed * DT;
    if (p.kind === 'homing') {
      const target = state.enemies.find((e) => e.id === p.targetId);
      if (!target || target.hp <= 0 || target.reached) continue; // 目標消失で消える
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= moved) {
        applyHit(state, target, p);
        continue;
      }
      p.x += (dx / dist) * moved;
      p.y += (dy / dist) * moved;
      alive.push(p);
    } else {
      // 範囲攻撃: 固定地点へ飛び、着弾時に周囲へダメージ
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= moved) {
        p.x = p.tx;
        p.y = p.ty;
        for (const e of state.enemies) {
          if (e.hp <= 0 || e.reached) continue;
          if (p.groundOnly && e.flying) continue;
          if (Math.hypot(e.x - p.x, e.y - p.y) <= p.splashRadius) applyHit(state, e, p);
        }
        state.effects.push({ kind: 'blast', x: p.x, y: p.y, r: p.splashRadius, ttl: EFFECT_TTL.blast, towerType: p.towerType });
        continue;
      }
      p.x += (dx / dist) * moved;
      p.y += (dy / dist) * moved;
      alive.push(p);
    }
  }
  state.projectiles = alive;
}

// ダメージ計算: 物理は鎧で軽減（貫通なら無視）、聖光はアンデッドに倍率
function applyDamage(enemy, amount, src) {
  let dmg = amount;
  if (src.damageType === 'physical' && !src.pierceArmor && enemy.armor > 0) {
    dmg = Math.max(COMBAT.minDamage, dmg - enemy.armor);
  }
  if (enemy.undead && src.undeadMul && src.undeadMul !== 1) dmg *= src.undeadMul;
  enemy.hp -= dmg;
}

// 弾の命中処理: ダメージ・スロウ・毒
function applyHit(state, enemy, p) {
  applyDamage(enemy, p.damage, p);
  if (p.slow) {
    enemy.slowFactor = p.slow.factor;
    enemy.slowUntil = state.waveTick + Math.round(p.slow.duration * TICK_RATE);
  }
  if (p.poison) {
    enemy.poisonDps = p.poison.dps;
    enemy.poisonUntil = state.waveTick + Math.round(p.poison.duration * TICK_RATE);
  }
}

// ---- 演出の寿命 ----
function updateEffects(state) {
  if (state.effects.length === 0) return;
  const alive = [];
  for (const fx of state.effects) {
    fx.ttl -= 1;
    if (fx.ttl > 0) alive.push(fx);
  }
  state.effects = alive;
}

// ---- 撃破・到達の後始末 ----
function cleanupEnemies(state) {
  const alive = [];
  for (const e of state.enemies) {
    if (e.hp <= 0) {
      state.money += e.reward;
      state.stats.earned += e.reward;
      state.stats.kills += 1;
      // 分裂: 同じ場所に子を生む（経路情報を引き継ぐ）
      const split = ENEMIES[e.type].splitInto;
      if (split) {
        for (let i = 0; i < split.count; i++) {
          const child = makeEnemy(state, split.type, e.hpMul, e.x, e.y, e.cx, e.cy, e.tx, e.ty);
          alive.push(child);
        }
      }
    } else if (e.reached) {
      state.lives -= e.livesCost;
      state.stats.leaked += 1;
    } else {
      alive.push(e);
    }
  }
  state.enemies = alive;
  if (state.lives <= 0) {
    state.lives = 0;
    state.phase = PHASE.GAMEOVER;
    state.projectiles = [];
    state.effects = [];
  }
}

// ---- ウェーブ終了判定 ----
function checkWaveEnd(state) {
  if (state.phase !== PHASE.WAVE) return;
  if (state.spawnQueue.length > 0 || state.enemies.length > 0) return;
  state.projectiles = [];
  state.effects = [];
  // クリアボーナス + 金鉱の収入
  let income = ECONOMY.waveClearBonusBase + ECONOMY.waveClearBonusPerWave * state.wave;
  for (const t of state.towers) {
    income += getTowerStats(t.type, t.level).income;
    t.cooldown = 0;
  }
  state.money += income;
  state.stats.earned += income;
  state.waveTick = 0;
  const total = getStage(state.stageId).waves.length;
  state.phase = state.wave >= total ? PHASE.CLEAR : PHASE.PREPARE;
}
