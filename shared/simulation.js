// シミュレーション: step(state) で固定タイムステップ（1tick = 1/30秒）だけ状態を進める
// 描画・入力には一切依存しない（DOM, Math.random, Date.now などは使わない）
import { MAP, DT, TICK_RATE, TOWERS, ENEMIES, WAVES, ECONOMY } from './config.js';
import { PHASE, cellIndex } from './state.js';
import { nextCells } from './pathfinding.js';
import { nextInt } from './rng.js';

// 1tick 進める。状態オブジェクトを直接更新し、同じ参照を返す
export function step(state) {
  if (state.phase !== PHASE.WAVE) return state;
  state.tick += 1;
  state.waveTick += 1;

  spawnEnemies(state);
  moveEnemies(state);
  updateTowers(state);
  updateProjectiles(state);
  cleanupEnemies(state);
  checkWaveEnd(state);
  return state;
}

// ---- 出現 ----
function spawnEnemies(state) {
  const q = state.spawnQueue;
  while (q.length > 0 && q[0].spawnTick <= state.waveTick) {
    const item = q.shift();
    const def = ENEMIES[item.type];
    const hp = Math.round(def.hp * item.hpMul);
    const first = pickNextCell(state, MAP.start.x, MAP.start.y) || MAP.goal;
    state.enemies.push({
      id: state.nextId++,
      type: item.type,
      x: MAP.start.x + 0.5,
      y: MAP.start.y + 0.5,
      hp,
      maxHp: hp,
      speed: def.speed,
      reward: def.reward,
      cx: MAP.start.x,  // 現在マス
      cy: MAP.start.y,
      tx: first.x,      // 目標マス
      ty: first.y,
      slowUntil: 0,     // この waveTick までスロウ
      slowFactor: 1,
      reached: false,   // ゴール到達フラグ
    });
  }
}

// 次に進むマスをフローフィールドから選ぶ（同距離の候補が複数ならシード乱数で選ぶ）
function pickNextCell(state, x, y) {
  const cands = nextCells(state.flow, x, y);
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  return cands[nextInt(state.rng, 0, cands.length - 1)];
}

// ---- 移動 ----
function moveEnemies(state) {
  for (const e of state.enemies) {
    if (e.reached) continue;
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
        if (e.cx === MAP.goal.x && e.cy === MAP.goal.y) {
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

// ゴールまでの残り距離の見積もり（索敵の優先度に使う。小さいほどゴールに近い）
function remainingDistance(state, e) {
  const base = state.flow[cellIndex(e.tx, e.ty)];
  return (base < 0 ? 0 : base) + Math.hypot(e.tx + 0.5 - e.x, e.ty + 0.5 - e.y);
}

// ---- タワー ----
function updateTowers(state) {
  for (const t of state.towers) {
    if (t.cooldown > 0) t.cooldown -= 1;
    if (t.cooldown > 0) continue;
    const def = TOWERS[t.type];
    const cx = t.x + 0.5;
    const cy = t.y + 0.5;
    // 射程内で最もゴールに近い敵を狙う
    let target = null;
    let best = Infinity;
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.reached) continue;
      if (Math.hypot(e.x - cx, e.y - cy) > def.range) continue;
      const rem = remainingDistance(state, e);
      if (rem < best) { best = rem; target = e; }
    }
    if (!target) continue;
    t.cooldown = Math.round(def.cooldown * TICK_RATE);
    state.projectiles.push({
      id: state.nextId++,
      kind: def.kind,
      towerType: t.type,
      x: cx,
      y: cy,
      speed: def.projectileSpeed,
      damage: def.damage,
      targetId: target.id,
      tx: target.x,   // 範囲攻撃は発射時点の位置を狙う
      ty: target.y,
      slow: def.slow || null,
      splashRadius: def.splashRadius || 0,
    });
  }
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
          if (Math.hypot(e.x - p.x, e.y - p.y) <= p.splashRadius) applyHit(state, e, p);
        }
        continue;
      }
      p.x += (dx / dist) * moved;
      p.y += (dy / dist) * moved;
      alive.push(p);
    }
  }
  state.projectiles = alive;
}

// 命中処理: ダメージとスロウ
function applyHit(state, enemy, p) {
  enemy.hp -= p.damage;
  if (p.slow) {
    enemy.slowFactor = p.slow.factor;
    enemy.slowUntil = state.waveTick + Math.round(p.slow.duration * TICK_RATE);
  }
}

// ---- 撃破・到達の後始末 ----
function cleanupEnemies(state) {
  const alive = [];
  for (const e of state.enemies) {
    if (e.hp <= 0) {
      state.money += e.reward;
      state.stats.kills += 1;
    } else if (e.reached) {
      state.lives -= 1;
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
  }
}

// ---- ウェーブ終了判定 ----
function checkWaveEnd(state) {
  if (state.phase !== PHASE.WAVE) return;
  if (state.spawnQueue.length > 0 || state.enemies.length > 0) return;
  state.projectiles = [];
  state.money += ECONOMY.waveClearBonusBase + ECONOMY.waveClearBonusPerWave * state.wave;
  state.waveTick = 0;
  state.phase = state.wave >= WAVES.length ? PHASE.CLEAR : PHASE.PREPARE;
  for (const t of state.towers) t.cooldown = 0;
}
