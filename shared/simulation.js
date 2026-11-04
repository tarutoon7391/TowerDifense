// シミュレーション: step(state) で固定タイムステップ（1tick = 1/30秒）だけ状態を進める
// 描画・入力には一切依存しない（DOM, Math.random, Date.now などは使わない）
import { DT, TICK_RATE, ENEMIES, ECONOMY, COMBAT, getStage } from './config.js';
import { PHASE, cellIndex } from './state.js';
import { nextCells } from './pathfinding.js';
import { nextInt } from './rng.js';
import { getTowerStats } from './towers.js';

// 演出オブジェクトの寿命（tick）
const EFFECT_TTL = { chain: 8, blast: 10, aura: 6, beam: 7 };

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
  // 撃破報酬は HP 倍率に応じて伸びる（終盤の資金効率を保つ）
  const reward = Math.round(def.reward * (1 + ECONOMY.rewardHpScale * (hpMul - 1)));
  return {
    id: state.nextId++,
    type,
    x, y,
    hp,
    maxHp: hp,
    hpMul,
    speed: def.speed,
    reward,
    livesCost: def.livesCost ?? 1,
    armor: def.armor || 0,
    regen: def.regen || 0,
    slowResist: def.slowResist || 0,
    flying: !!def.flying,
    undead: !!def.undead,
    boss: !!def.boss,
    cx, cy,           // 現在マス
    tx, ty,           // 目標マス（飛行はゴール固定）
    slowUntil: 0,     // この waveTick までスロウ
    slowFactor: 1,
    poisonUntil: 0,   // この waveTick まで毒
    poisonDps: 0,
    curseUntil: 0,    // この waveTick まで呪い
    curseArmor: 0,    // 呪いによる鎧低下量
    curseMul: 1,      // 呪いによる被ダメージ倍率
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

// 現在の実効速度（スロウ込み）
function currentSpeed(state, e) {
  return e.speed * (state.waveTick < e.slowUntil ? e.slowFactor : 1);
}

// ---- 移動 ----
function moveEnemies(state) {
  const goal = state.map.goal;
  for (const e of state.enemies) {
    if (e.reached || e.hp <= 0) continue;
    let budget = currentSpeed(state, e) * DT;
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

// 射程内で最もゴールに近い敵
function findTarget(state, stats, cx, cy) {
  let target = null;
  let best = Infinity;
  for (const e of state.enemies) {
    if (!canTarget(stats, e)) continue;
    if (Math.hypot(e.x - cx, e.y - cy) > stats.range) continue;
    const rem = remainingDistance(state, e);
    if (rem < best) { best = rem; target = e; }
  }
  return target;
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
        applyDamage(state, e, stats.damage, stats);
        hitAny = true;
      }
      if (hitAny) {
        t.cooldown = Math.round(stats.cooldown * TICK_RATE);
        state.effects.push({ kind: 'aura', x: cx, y: cy, r: stats.range, ttl: EFFECT_TTL.aura, towerType: t.type });
      }
      continue;
    }

    const target = findTarget(state, stats, cx, cy);
    if (!target) continue;
    t.cooldown = Math.round(stats.cooldown * TICK_RATE);

    if (stats.attack === 'chain') {
      fireChain(state, t, stats, target);
      continue;
    }
    if (stats.attack === 'line') {
      fireLine(state, t, stats, target);
      continue;
    }

    // 範囲弾は着弾予測: 目標の進行方向 × 速度 × 飛行時間 ぶん先を狙う
    let tx = target.x;
    let ty = target.y;
    if (stats.leadTarget && !target.flying) {
      const dist = Math.hypot(target.x - cx, target.y - cy);
      const flight = dist / stats.projectileSpeed;
      const ddx = target.tx + 0.5 - target.x;
      const ddy = target.ty + 0.5 - target.y;
      const dlen = Math.hypot(ddx, ddy);
      if (dlen > 0) {
        // 次のマス中心を越えない範囲で先読みする（曲がり角で外れすぎないように）
        const lead = Math.min(dlen, currentSpeed(state, target) * flight);
        tx += (ddx / dlen) * lead;
        ty += (ddy / dlen) * lead;
      }
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
      flyingMul: stats.flyingMul,
      groundMul: stats.groundMul,
      undeadMul: stats.undeadMul,
      targetId: target.id,
      tx,
      ty,
      slow: stats.slow,
      poison: stats.poison,
      curse: stats.curse,
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
    applyDamage(state, cur, Math.round(dmg), stats);
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

// 直線貫通: 目標の方向へ射程いっぱいの射線を引き、射線の近くにいる敵を全員撃つ
function fireLine(state, tower, stats, target) {
  const ox = tower.x + 0.5;
  const oy = tower.y + 0.5;
  let dx = target.x - ox;
  let dy = target.y - oy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  for (const e of state.enemies) {
    if (!canTarget(stats, e)) continue;
    const ex = e.x - ox;
    const ey = e.y - oy;
    const along = ex * dx + ey * dy;                 // 射線方向の距離
    if (along < 0 || along > stats.range) continue;
    const side = Math.abs(ex * dy - ey * dx);        // 射線からの垂直距離
    if (side > stats.lineWidth) continue;
    applyDamage(state, e, stats.damage, stats);
  }
  state.effects.push({
    kind: 'beam', x1: ox, y1: oy, x2: ox + dx * stats.range, y2: oy + dy * stats.range,
    ttl: EFFECT_TTL.beam, towerType: tower.type,
  });
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

// ダメージ計算: 物理は鎧で軽減（貫通なら無視・呪いで鎧低下）、種族倍率、呪いの被ダメ倍率
function applyDamage(state, enemy, amount, src) {
  let dmg = amount;
  const cursed = state.waveTick < enemy.curseUntil;
  if (src.damageType === 'physical' && !src.pierceArmor && enemy.armor > 0) {
    const armor = Math.max(0, enemy.armor - (cursed ? enemy.curseArmor : 0));
    dmg = Math.max(COMBAT.minDamage, dmg - armor);
  }
  if (enemy.undead && src.undeadMul && src.undeadMul !== 1) dmg *= src.undeadMul;
  if (enemy.flying && src.flyingMul && src.flyingMul !== 1) dmg *= src.flyingMul;
  if (!enemy.flying && src.groundMul && src.groundMul !== 1) dmg *= src.groundMul;
  if (cursed) dmg *= enemy.curseMul;
  enemy.hp -= dmg;
}

// 弾の命中処理: ダメージ・スロウ・毒・呪い
function applyHit(state, enemy, p) {
  applyDamage(state, enemy, p.damage, p);
  if (p.slow) {
    // スロウ耐性: 減速量を (1 − 耐性) 倍にする
    enemy.slowFactor = 1 - (1 - p.slow.factor) * (1 - enemy.slowResist);
    enemy.slowUntil = state.waveTick + Math.round(p.slow.duration * TICK_RATE);
  }
  if (p.poison) {
    enemy.poisonDps = p.poison.dps;
    enemy.poisonUntil = state.waveTick + Math.round(p.poison.duration * TICK_RATE);
  }
  if (p.curse) {
    enemy.curseArmor = p.curse.armorReduce;
    enemy.curseMul = p.curse.damageTakenMul;
    enemy.curseUntil = state.waveTick + Math.round(p.curse.duration * TICK_RATE);
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
