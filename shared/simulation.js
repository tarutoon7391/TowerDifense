// シミュレーション: step(state) で固定タイムステップ（1tick = 1/30秒）だけ状態を進める
// 描画・入力には一切依存しない（DOM, Math.random, Date.now などは使わない）
import { DT, TICK_RATE, ENEMIES, ECONOMY, COMBAT, SPELLS, MUTATIONS, REACTIONS, CELL_FLOOR, getStage } from './config.js';
import { PHASE, cellIndex } from './state.js';
import { nextCells } from './pathfinding.js';
import { nextInt, nextFloat } from './rng.js';
import { getTowerStats } from './towers.js';
import { effectiveStats, economyModifiers, portalsOf } from './buffs.js';
import { removeTowerAt, isWallType } from './commands.js';

// 演出オブジェクトの寿命（tick）
const EFFECT_TTL = { chain: 8, blast: 10, aura: 6, beam: 7, trap: 12, summon: 10, teleport: 10 };

// 1tick 進める。状態オブジェクトを直接更新し、同じ参照を返す
export function step(state) {
  if (state.phase !== PHASE.WAVE) return state;
  state.tick += 1;
  state.waveTick += 1;

  spawnEnemies(state);
  applySpells(state);
  moveEnemies(state);
  applyStatusEffects(state);
  updateUnits(state);
  enemyAbilities(state);
  updateTowers(state);
  updateProjectiles(state);
  updateEffects(state);
  cleanupEnemies(state);
  checkWaveEnd(state);
  return state;
}

// ---- 出現 ----
function makeEnemy(state, type, hpMul, x, y, cx, cy, tx, ty, mutationId = 'none', giant = false) {
  const def = ENEMIES[type];
  const mut = MUTATIONS.find((m) => m.id === mutationId) || MUTATIONS[0];
  const mod = economyModifiers(state);
  const hp = Math.round(def.hp * hpMul * mod.enemyHpMul * (giant ? mut.giantHpMul : 1));
  // 撃破報酬は HP 倍率に応じて伸びる（終盤の資金効率を保つ）
  const reward = Math.round(def.reward * (1 + ECONOMY.rewardHpScale * (hpMul - 1)) * mod.rewardMul * (giant ? mut.giantRewardMul : 1));
  return {
    id: state.nextId++,
    type,
    x, y,
    hp,
    maxHp: hp,
    hpMul,
    mutation: mutationId,
    giant,
    speed: def.speed * (mut.speedMul || 1),
    reward,
    livesCost: def.livesCost ?? 1,
    armor: (def.armor || 0) + (mut.armorAdd || 0),
    regen: (def.regen || 0) + (mut.regenAdd || 0),
    slowResist: def.slowResist || 0,
    flying: !!def.flying,
    undead: !!def.undead,
    boss: !!def.boss,
    stealGold: def.stealGold || 0,
    cx, cy,           // 現在マス
    tx, ty,           // 目標マス（飛行はゴール固定）
    slowUntil: 0,     // この waveTick までスロウ
    slowFactor: 1,
    poisonUntil: 0,   // この waveTick まで毒
    poisonDps: 0,
    curseUntil: 0,    // この waveTick まで呪い
    curseArmor: 0,    // 呪いによる鎧低下量
    curseMul: 1,      // 呪いによる被ダメージ倍率
    stunUntil: 0,     // この waveTick まで気絶（動けない）
    oilUntil: 0,      // この waveTick まで油まみれ（炎で引火）
    groundedUntil: 0, // この waveTick まで着地中（飛行が迷路を歩く）
    knockImmuneUntil: 0, // この waveTick まで押し戻し無効
    abilityTick: state.waveTick, // 特殊能力（壁破壊・召喚）を最後に使った tick
    revives: 0,       // ネクロマンサーが蘇生した回数
    reached: false,   // ゴール到達フラグ
  };
}

function spawnAt(state, type, hpMul, x, y, cx, cy, mutationId = 'none', giant = false) {
  const { goal } = state.map;
  const def = ENEMIES[type];
  let target;
  if (def.flying) target = goal;
  else target = pickNextCell(state, cx, cy) || goal;
  const e = makeEnemy(state, type, hpMul, x, y, cx, cy, target.x, target.y, mutationId, giant);
  state.enemies.push(e);
  return e;
}

function spawnEnemies(state) {
  const q = state.spawnQueue;
  const { start } = state.map;
  while (q.length > 0 && q[0].spawnTick <= state.waveTick) {
    const item = q.shift();
    spawnAt(state, item.type, item.hpMul, start.x + 0.5, start.y + 0.5, start.x, start.y, item.mutation || 'none', !!item.giant);
  }
}

// 次に進むマスをフローフィールドから選ぶ（同距離の候補が複数ならシード乱数で選ぶ）
function pickNextCell(state, x, y) {
  const cands = nextCells(state.flow, state.map, x, y, portalsOf(state));
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  return cands[nextInt(state.rng, 0, cands.length - 1)];
}

// 現在の実効速度（スロウ込み）
function currentSpeed(state, e) {
  return e.speed * (state.waveTick < e.slowUntil ? e.slowFactor : 1);
}

// 飛行として振る舞うか（着地中は地上扱い）
function isAirborne(state, e) {
  return e.flying && state.waveTick >= e.groundedUntil;
}

// ---- アクティブ魔法 ----
function applySpells(state) {
  if (!state.pendingSpells || state.pendingSpells.length === 0) return;
  for (const cast of state.pendingSpells) {
    const spell = SPELLS[cast.id];
    if (cast.id === 'meteor') {
      for (const e of state.enemies) {
        if (e.hp <= 0 || e.reached) continue;
        if (Math.hypot(e.x - cast.x, e.y - cast.y) <= spell.radius) applyDamage(state, e, spell.damage, spell);
      }
      state.effects.push({ kind: 'blast', x: cast.x, y: cast.y, r: spell.radius, ttl: EFFECT_TTL.blast, towerType: 'meteor' });
    } else if (cast.id === 'freeze') {
      for (const e of state.enemies) {
        if (e.hp <= 0 || e.reached) continue;
        applySlow(state, e, spell.slow.factor, spell.slow.duration);
      }
      state.effects.push({ kind: 'aura', x: state.map.cols / 2, y: state.map.rows / 2, r: state.map.cols, ttl: EFFECT_TTL.aura, towerType: 'freeze' });
    }
  }
  state.pendingSpells = [];
}

// ---- 移動 ----
function moveEnemies(state) {
  const goal = state.map.goal;
  for (const e of state.enemies) {
    if (e.reached || e.hp <= 0) continue;
    if (state.waveTick < e.stunUntil) continue; // 気絶中は動けない
    // 着地が終わった飛行は再び飛び立つ（ゴールへ直進）
    if (e.flying && e.groundedUntil > 0 && state.waveTick >= e.groundedUntil) {
      e.groundedUntil = 0;
      e.tx = goal.x;
      e.ty = goal.y;
    }
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
        if (!isAirborne(state, e)) onEnterCell(state, e);
        if (state.waveTick < e.stunUntil) break; // 罠で拘束された
        if (e.reached) break;
        const next = pickNextCell(state, e.cx, e.cy);
        if (!next) { e.reached = true; break; } // 保険: 経路が無い場合はゴール扱い
        if (next.teleport) {
          // 転送門: 相方へ瞬間移動
          state.effects.push({ kind: 'teleport', x: e.x, y: e.y, r: 0.6, ttl: EFFECT_TTL.teleport, towerType: 'portal' });
          e.cx = next.x; e.cy = next.y;
          e.x = next.x + 0.5; e.y = next.y + 0.5;
          state.effects.push({ kind: 'teleport', x: e.x, y: e.y, r: 0.6, ttl: EFFECT_TTL.teleport, towerType: 'portal' });
          const after = pickNextCell(state, e.cx, e.cy);
          if (!after) { e.reached = true; break; }
          e.tx = after.x; e.ty = after.y;
          continue;
        }
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

// 床・罠・警鐘: 地上の敵がマスに入ったときの効果
function onEnterCell(state, e) {
  if (state.grid[cellIndex(state.map, e.cx, e.cy)] !== CELL_FLOOR) return;
  const t = state.towers.find((tw) => tw.x === e.cx && tw.y === e.cy);
  if (!t) return;
  const st = getTowerStats(t.type, t.level, t.branch);
  if (st.floor) {
    if (!st.floor.undeadOnly || e.undead) {
      applyHit(state, e, { damage: 0, slow: st.floor.slow || null, curse: st.floor.curse || null, poison: st.floor.poison || null }, null);
      if (st.floor.oil) e.oilUntil = state.waveTick + Math.round(st.floor.oil.duration * TICK_RATE);
    }
  }
  if (st.trap && t.armed) {
    t.armed = false;
    if (st.trap.stun) applyHit(state, e, { damage: 0, stun: st.trap.stun }, null);
    if (st.trap.damage) {
      for (const o of state.enemies) {
        if (o.hp <= 0 || o.reached || isAirborne(state, o)) continue;
        if (Math.hypot(o.x - (t.x + 0.5), o.y - (t.y + 0.5)) <= st.trap.radius) {
          applyDamage(state, o, st.trap.damage, { damageType: st.trap.damageType });
        }
      }
    }
    state.effects.push({ kind: 'trap', x: t.x + 0.5, y: t.y + 0.5, r: st.trap.radius || 0.6, ttl: EFFECT_TTL.trap, towerType: t.type });
  }
  if (st.alarm && state.waveTick >= (t.alarmReadyAt || 0)) {
    t.alarmReadyAt = state.waveTick + Math.round(st.alarm.cooldown * TICK_RATE);
    for (const o of state.towers) {
      if (Math.hypot(o.x - t.x, o.y - t.y) > st.alarm.range) continue;
      o.boostUntil = state.waveTick + Math.round(st.alarm.duration * TICK_RATE);
      o.boostMul = st.alarm.damageMul;
    }
    state.effects.push({ kind: 'aura', x: t.x + 0.5, y: t.y + 0.5, r: st.alarm.range, ttl: EFFECT_TTL.aura, towerType: 'alarm' });
  }
}

// 押し戻し: 現在マスの中心に戻し、ゴールから遠ざかる隣接マスへ cells 回たどる
function knockback(state, e, cells) {
  e.knockImmuneUntil = state.waveTick + Math.round(ECONOMY.knockbackImmunitySec * TICK_RATE);
  if (isAirborne(state, e)) {
    // 飛行は門の方向へ直線的に戻す
    const { start } = state.map;
    const dx = start.x + 0.5 - e.x;
    const dy = start.y + 0.5 - e.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return;
    const back = Math.min(d, cells);
    e.x += (dx / d) * back;
    e.y += (dy / d) * back;
    return;
  }
  const { cols, rows } = state.map;
  let cx = e.cx;
  let cy = e.cy;
  for (let i = 0; i < cells; i++) {
    const here = state.flow[cellIndex(state.map, cx, cy)];
    let found = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (state.flow[cellIndex(state.map, nx, ny)] === here + 1) { found = { x: nx, y: ny }; break; }
    }
    if (!found) break;
    cx = found.x;
    cy = found.y;
  }
  e.cx = cx;
  e.cy = cy;
  e.x = cx + 0.5;
  e.y = cy + 0.5;
  const next = pickNextCell(state, cx, cy);
  if (next) { e.tx = next.x; e.ty = next.y; }
}

// 飛行する敵を地面に下ろす（足元が通れるマスのときだけ）
function groundEnemy(state, e, duration) {
  if (!e.flying) return;
  const cx = Math.floor(e.x);
  const cy = Math.floor(e.y);
  if (state.flow[cellIndex(state.map, cx, cy)] < 0) return; // 水や岩の上では着地できない
  e.groundedUntil = state.waveTick + Math.round(duration * TICK_RATE);
  e.cx = cx;
  e.cy = cy;
  const next = pickNextCell(state, cx, cy);
  if (next) { e.tx = next.x; e.ty = next.y; }
}

// ---- 毒・再生 ----
function applyStatusEffects(state) {
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.reached) continue;
    if (state.waveTick < e.poisonUntil) e.hp -= e.poisonDps * DT; // 毒は魔法扱い（鎧無視）
    if (e.regen > 0 && e.hp > 0) e.hp = Math.min(e.maxHp, e.hp + e.regen * DT);
  }
}

// ---- 兵士ユニット: 触れた地上の敵を足止めし、代わりに殴られる ----
function updateUnits(state) {
  if (state.units.length === 0) return;
  for (const u of state.units) {
    if (u.hp <= 0) {
      // 再出撃
      if (u.deadAt >= 0 && state.waveTick - u.deadAt >= ECONOMY.unitRespawnSec * TICK_RATE) {
        u.hp = u.maxHp;
        u.deadAt = -1;
      }
      continue;
    }
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.reached || e.boss || isAirborne(state, e)) continue;
      if (Math.hypot(e.x - (u.x + 0.5), e.y - (u.y + 0.5)) > ECONOMY.unitEngageRadius) continue;
      // 足止め（毎tick延長）と兵士への攻撃
      e.stunUntil = Math.max(e.stunUntil, state.waveTick + 2);
      u.hp -= ECONOMY.enemyAttackPerSec * DT;
      if (u.hp <= 0) {
        u.hp = 0;
        u.deadAt = state.waveTick;
        state.effects.push({ kind: 'blast', x: u.x + 0.5, y: u.y + 0.5, r: 0.5, ttl: EFFECT_TTL.blast, towerType: 'unit' });
        break;
      }
    }
  }
}

// ---- 敵の特殊能力: 壁破壊・召喚 ----
function enemyAbilities(state) {
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.reached) continue;
    const def = ENEMIES[e.type];
    if (def.breakWalls) {
      if (state.waveTick - e.abilityTick < def.breakWalls.cooldown * TICK_RATE) continue;
      // 近くの壊せる建物のうち最も近いものを壊す
      let best = -1;
      let bestD = Infinity;
      state.towers.forEach((t, i) => {
        if (!getTowerStats(t.type, t.level, t.branch).breakable) return;
        const d = Math.hypot(t.x + 0.5 - e.x, t.y + 0.5 - e.y);
        if (d <= def.breakWalls.range && d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) {
        const t = state.towers[best];
        state.destroyed.push({ x: t.x, y: t.y, type: t.type });
        state.stats.wallsBroken += 1;
        state.effects.push({ kind: 'blast', x: t.x + 0.5, y: t.y + 0.5, r: 0.8, ttl: EFFECT_TTL.blast, towerType: 'break' });
        removeTowerAt(state, best); // flow も再計算される
        e.abilityTick = state.waveTick;
        // 壁が消えて経路が変わったので、目標マスが無効になった敵は取り直す
        for (const o of state.enemies) {
          if (isAirborne(state, o) || o.reached || o.hp <= 0) continue;
          if (state.flow[cellIndex(state.map, o.tx, o.ty)] < 0) {
            const next = pickNextCell(state, o.cx, o.cy);
            if (next) { o.tx = next.x; o.ty = next.y; }
          }
        }
      }
    }
    if (def.summon) {
      if (state.waveTick - e.abilityTick < def.summon.every * TICK_RATE) continue;
      e.abilityTick = state.waveTick;
      for (let i = 0; i < def.summon.count; i++) spawnAt(state, def.summon.type, e.hpMul, e.x, e.y, e.cx, e.cy);
      state.effects.push({ kind: 'summon', x: e.x, y: e.y, r: 1.0, ttl: EFFECT_TTL.summon, towerType: 'summon' });
    }
  }
}

// ゴールまでの残り距離の見積もり（索敵の優先度に使う。小さいほどゴールに近い）
function remainingDistance(state, e) {
  if (isAirborne(state, e)) {
    return Math.hypot(state.map.goal.x + 0.5 - e.x, state.map.goal.y + 0.5 - e.y);
  }
  const base = state.flow[cellIndex(state.map, e.tx, e.ty)];
  return (base < 0 ? 0 : base) + Math.hypot(e.tx + 0.5 - e.x, e.ty + 0.5 - e.y);
}

// タワーが狙える敵か
function canTarget(state, stats, e) {
  if (e.hp <= 0 || e.reached) return false;
  if (stats.groundOnly && isAirborne(state, e)) return false;
  return true;
}

// 射程内の敵をゴールに近い順に最大 n 体
function findTargets(state, stats, cx, cy, n) {
  const cands = [];
  for (const e of state.enemies) {
    if (!canTarget(state, stats, e)) continue;
    if (Math.hypot(e.x - cx, e.y - cy) > stats.range) continue;
    cands.push({ e, rem: remainingDistance(state, e) });
  }
  cands.sort((a, b) => a.rem - b.rem || a.e.id - b.e.id);
  return cands.slice(0, n).map((c) => c.e);
}

// ---- タワー ----
function updateTowers(state) {
  for (const t of state.towers) {
    if (t.cooldown > 0) t.cooldown -= 1;
    if (t.cooldown > 0) continue;
    const stats = effectiveStats(state, t);
    if (stats.attack === 'none') continue;
    const cx = t.x + 0.5;
    const cy = t.y + 0.5;

    if (stats.attack === 'aura') {
      // 射程内の全敵に即時ダメージ＋状態異常
      let hitAny = false;
      for (const e of state.enemies) {
        if (!canTarget(state, stats, e)) continue;
        if (Math.hypot(e.x - cx, e.y - cy) > stats.range) continue;
        applyHit(state, e, stats, t);
        hitAny = true;
      }
      if (hitAny) {
        t.cooldown = Math.round(stats.cooldown * TICK_RATE);
        state.effects.push({ kind: 'aura', x: cx, y: cy, r: stats.range, ttl: EFFECT_TTL.aura, towerType: t.type });
      }
      continue;
    }

    const targets = findTargets(state, stats, cx, cy, stats.multishot);
    if (targets.length === 0) continue;
    t.cooldown = Math.round(stats.cooldown * TICK_RATE);

    if (stats.attack === 'chain') {
      fireChain(state, t, stats, targets[0]);
      continue;
    }
    if (stats.attack === 'line') {
      fireLine(state, t, stats, targets[0]);
      continue;
    }

    for (const target of targets) {
      // 範囲弾は着弾予測: 目標の進行方向 × 速度 × 飛行時間 ぶん先を狙う
      let tx = target.x;
      let ty = target.y;
      if (stats.leadTarget && !isAirborne(state, target) && state.waveTick >= target.stunUntil) {
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
        towerId: t.id,
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
        bossMul: stats.bossMul,
        executeBelow: stats.executeBelow,
        undeadExecuteChance: stats.undeadExecuteChance || 0,
        crit: stats.crit,
        ramp: stats.ramp,
        stun: stats.stun,
        knockback: stats.knockback,
        fire: stats.fire,
        shatter: stats.shatter,
        holy: stats.holy,
        ground: stats.ground,
        statusDurationMul: stats.statusDurationMul || 1,
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
}

// 連鎖: 最初の敵に当て、近くの未命中の敵へ順に跳ねる（威力は減衰）
function fireChain(state, tower, stats, first) {
  const hit = new Set();
  const pts = [[tower.x + 0.5, tower.y + 0.5]];
  let cur = first;
  let dmg = stats.damage;
  for (let j = 0; j <= stats.chain.jumps && cur; j++) {
    applyHit(state, cur, { ...stats, damage: Math.round(dmg) }, tower);
    hit.add(cur.id);
    pts.push([cur.x, cur.y]);
    dmg *= stats.chain.decay;
    // 次の跳躍先: 直前の命中敵から chain.range 内で最も近い未命中の敵
    let next = null;
    let bestD = Infinity;
    for (const e of state.enemies) {
      if (hit.has(e.id) || !canTarget(state, stats, e)) continue;
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
    if (!canTarget(state, stats, e)) continue;
    const ex = e.x - ox;
    const ey = e.y - oy;
    const along = ex * dx + ey * dy;                 // 射線方向の距離
    if (along < 0 || along > stats.range) continue;
    const side = Math.abs(ex * dy - ey * dx);        // 射線からの垂直距離
    if (side > stats.lineWidth) continue;
    applyHit(state, e, stats, tower);
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
        const tower = p.towerId ? state.towers.find((t) => t.id === p.towerId) : null;
        applyHit(state, target, p, tower);
        // 追尾弾に範囲があれば周囲へも（本体より弱い半分のダメージ＋状態異常）
        if (p.splashRadius > 0) {
          for (const e of state.enemies) {
            if (e === target || e.hp <= 0 || e.reached) continue;
            if (p.groundOnly && isAirborne(state, e)) continue;
            if (Math.hypot(e.x - target.x, e.y - target.y) <= p.splashRadius) {
              applyHit(state, e, { ...p, damage: p.damage / 2, crit: null, ramp: null }, null);
            }
          }
        }
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
          if (p.groundOnly && isAirborne(state, e)) continue;
          if (Math.hypot(e.x - p.x, e.y - p.y) <= p.splashRadius) applyHit(state, e, p, null);
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
  const air = isAirborne(state, enemy);
  if (air && src.flyingMul && src.flyingMul !== 1) dmg *= src.flyingMul;
  if (!air && src.groundMul && src.groundMul !== 1) dmg *= src.groundMul;
  if (enemy.boss && src.bossMul && src.bossMul !== 1) dmg *= src.bossMul;
  if (cursed) dmg *= enemy.curseMul;
  enemy.hp -= dmg;
  return dmg;
}

// スロウ付与: 効果中はより強い（小さい）倍率を優先し、弱い方で上書きしない
function applySlow(state, enemy, factor, duration) {
  const f = 1 - (1 - factor) * (1 - enemy.slowResist);
  const until = state.waveTick + Math.round(duration * TICK_RATE);
  const active = state.waveTick < enemy.slowUntil;
  if (!active || f <= enemy.slowFactor) {
    enemy.slowFactor = f;
    enemy.slowUntil = Math.max(until, active ? enemy.slowUntil : 0);
  } else if (f > enemy.slowFactor && until > enemy.slowUntil) {
    // 弱い効果は「強い効果が切れた後」に続くよう、期限だけ延ばさない（単純化のため無視）
  }
}

// 命中処理: ダメージ（クリティカル・威力上昇・即死・状態反応）と状態異常（スロウ・毒・呪い・気絶・押し戻し・着地）
// src は弾またはタワーの実効ステータス。tower は威力上昇の記録用（無ければ null）
function applyHit(state, enemy, src, tower) {
  let amount = src.damage || 0;
  // 威力上昇: 同じ敵を撃ち続けると段数が増える
  if (src.ramp && tower) {
    if (tower.rampTarget === enemy.id) tower.rampStacks += 1;
    else { tower.rampTarget = enemy.id; tower.rampStacks = 0; }
    amount *= Math.min(src.ramp.max, 1 + src.ramp.perHit * tower.rampStacks);
  }
  // クリティカル（シード乱数）
  if (src.crit && src.crit.chance > 0 && nextFloat(state.rng) < src.crit.chance) {
    amount *= src.crit.mul;
  }
  if (amount > 0) applyDamage(state, enemy, amount, src);

  // ---- 状態反応 ----
  // 油まみれ + 炎 → 引火爆発（周囲にも）
  if (src.fire && state.waveTick < enemy.oilUntil) {
    enemy.oilUntil = 0;
    const r = REACTIONS.oilFire;
    for (const o of state.enemies) {
      if (o.hp <= 0 || o.reached) continue;
      if (Math.hypot(o.x - enemy.x, o.y - enemy.y) <= r.radius) applyDamage(state, o, r.damage, { damageType: 'magic' });
    }
    state.effects.push({ kind: 'blast', x: enemy.x, y: enemy.y, r: r.radius, ttl: EFFECT_TTL.blast, towerType: 'oil' });
  }
  // 気絶中 + 砕き → 低HPなら砕ける
  if (src.shatter && !enemy.boss && state.waveTick < enemy.stunUntil && enemy.hp > 0 && enemy.hp <= enemy.maxHp * REACTIONS.shatter.hpBelow) {
    enemy.hp = 0;
  }
  // 毒 + 聖 → 浄化（残りの毒ダメージを一括）
  if (src.holy && state.waveTick < enemy.poisonUntil && enemy.hp > 0) {
    const remain = ((enemy.poisonUntil - state.waveTick) / TICK_RATE) * enemy.poisonDps * REACTIONS.purify.poisonBurst;
    enemy.hp -= remain;
    enemy.poisonUntil = 0;
  }

  // 即死: 一定割合以下の HP のボス以外を倒す
  if (src.executeBelow > 0 && !enemy.boss && enemy.hp > 0 && enemy.hp <= enemy.maxHp * src.executeBelow) {
    enemy.hp = 0;
  }
  // 浄化シナジー: アンデッドを確率で即死
  if (src.undeadExecuteChance > 0 && enemy.undead && !enemy.boss && enemy.hp > 0 && nextFloat(state.rng) < src.undeadExecuteChance) {
    enemy.hp = 0;
  }
  const durMul = src.statusDurationMul || 1;
  if (src.slow) applySlow(state, enemy, src.slow.factor, src.slow.duration * durMul);
  if (src.poison) {
    // 毒は強い方を優先する
    if (state.waveTick >= enemy.poisonUntil || src.poison.dps >= enemy.poisonDps) {
      enemy.poisonDps = src.poison.dps;
      enemy.poisonUntil = state.waveTick + Math.round(src.poison.duration * durMul * TICK_RATE);
    }
  }
  if (src.curse) {
    enemy.curseArmor = Math.max(src.curse.armorReduce, state.waveTick < enemy.curseUntil ? enemy.curseArmor : 0);
    enemy.curseMul = Math.max(src.curse.damageTakenMul, state.waveTick < enemy.curseUntil ? enemy.curseMul : 1);
    enemy.curseUntil = state.waveTick + Math.round(src.curse.duration * durMul * TICK_RATE);
  }
  if (src.stun && !enemy.boss && nextFloat(state.rng) < src.stun.chance) {
    const until = state.waveTick + Math.round(src.stun.duration * durMul * TICK_RATE);
    if (until > enemy.stunUntil) enemy.stunUntil = until;
  }
  if (src.ground && enemy.flying && enemy.hp > 0 && !enemy.boss) {
    groundEnemy(state, enemy, src.ground.duration * durMul);
  }
  if (src.knockback && !enemy.boss && enemy.hp > 0 && state.waveTick >= enemy.knockImmuneUntil && nextFloat(state.rng) < src.knockback.chance) {
    knockback(state, enemy, src.knockback.cells);
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

// 賞金首の掲示板: 倒れた位置の近くにある掲示板のうち最大の賞金
function bountyFor(state, x, y) {
  let best = 0;
  for (const t of state.towers) {
    const st = getTowerStats(t.type, t.level, t.branch);
    if (!st.bounty) continue;
    if (Math.hypot(t.x + 0.5 - x, t.y + 0.5 - y) <= st.bounty.range) best = Math.max(best, st.bounty.gold);
  }
  return best;
}

// ネクロマンサー: 近くで倒れたアンデッドを蘇生する（1体につき最大 max 回）
function tryRevive(state, dead, alive) {
  if (!dead.undead) return false;
  for (const n of state.enemies) {
    if (n === dead || n.hp <= 0 || n.reached) continue;
    const def = ENEMIES[n.type];
    if (!def.revive || n.revives >= def.revive.max) continue;
    if (Math.hypot(n.x - dead.x, n.y - dead.y) > def.revive.range) continue;
    n.revives += 1;
    const child = makeEnemy(state, def.revive.type, dead.hpMul, dead.x, dead.y, dead.cx, dead.cy, dead.tx, dead.ty, dead.mutation);
    child.hp = Math.round(child.maxHp * def.revive.hpRatio);
    alive.push(child);
    state.effects.push({ kind: 'summon', x: dead.x, y: dead.y, r: 0.8, ttl: EFFECT_TTL.summon, towerType: 'revive' });
    return true;
  }
  return false;
}

// ---- 撃破・到達の後始末 ----
function cleanupEnemies(state) {
  const alive = [];
  for (const e of state.enemies) {
    if (e.hp <= 0) {
      const gold = e.reward + bountyFor(state, e.x, e.y);
      state.money += gold;
      state.stats.earned += gold;
      state.stats.kills += 1;
      // 分裂: 同じ場所に子を生む（経路情報を引き継ぐ）
      const split = ENEMIES[e.type].splitInto;
      if (split) {
        for (let i = 0; i < split.count; i++) {
          const child = makeEnemy(state, split.type, e.hpMul, e.x, e.y, e.cx, e.cy, e.tx, e.ty, e.mutation);
          alive.push(child);
        }
      }
      tryRevive(state, e, alive);
    } else if (e.reached) {
      if (e.stealGold > 0) {
        // 盗賊: ライフの代わりにお金を奪う
        const stolen = Math.min(state.money, e.stealGold);
        state.money -= stolen;
        state.stats.stolen += stolen;
      }
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
  state.pendingSpells = [];
  const stage = getStage(state.stageId);
  const mod = economyModifiers(state);

  // クリアボーナス（宝物庫で倍率）
  let income = Math.round((ECONOMY.waveClearBonusBase + ECONOMY.waveClearBonusPerWave * state.wave) * mod.bonusMul);
  // 建物ごとの収入・成長収入、利息・錬金・賭博は「最大の1件」だけ有効。ライフ増減は合計
  let bestInterest = null;
  let bestPerTower = null;
  let gamble = null;
  let lives = 0;
  let nonWalls = 0;
  for (const t of state.towers) {
    const st = getTowerStats(t.type, t.level, t.branch);
    income += st.income + st.incomeGrowth * Math.max(0, state.wave - t.builtWave - 1);
    if (st.interest && (!bestInterest || st.interest.rate > bestInterest.rate)) bestInterest = st.interest;
    if (st.perTowerGold && (!bestPerTower || st.perTowerGold.gold > bestPerTower.gold)) bestPerTower = st.perTowerGold;
    if (st.gamble && !gamble) gamble = st.gamble;
    lives += st.livesPerWave;
    if (!isWallType(t.type)) nonWalls += 1;
    t.cooldown = 0;
    t.rampTarget = 0;
    t.rampStacks = 0;
    t.armed = true;
    t.boostUntil = 0;
  }
  if (bestInterest) income += Math.min(bestInterest.cap, Math.floor(state.money * bestInterest.rate));
  if (bestPerTower) income += Math.min(bestPerTower.cap, bestPerTower.gold * nonWalls);
  state.money += income;
  state.stats.earned += income;
  // 賭博場: 所持金の一部を賭ける（シード乱数）
  if (gamble) {
    const bet = Math.floor(state.money * gamble.rate);
    if (bet > 0) {
      if (nextFloat(state.rng) < gamble.winChance) {
        const win = Math.round(bet * (gamble.winMul - 1));
        state.money += win;
        state.stats.earned += win;
        state.lastGamble = { won: true, amount: win };
      } else {
        state.money -= bet;
        state.lastGamble = { won: false, amount: bet };
      }
    }
  }
  if (lives !== 0) state.lives = Math.min(stage.initialLives, state.lives + lives);
  if (mod.manaPerWave > 0) state.mana = Math.min(ECONOMY.manaCap, state.mana + mod.manaPerWave);
  // 兵士は全回復
  for (const u of state.units) { u.hp = u.maxHp; u.deadAt = -1; }

  state.waveTick = 0;
  state.destroyed = [];
  if (state.lives <= 0) {
    state.lives = 0;
    state.phase = PHASE.GAMEOVER; // 禁断の祭壇でライフが尽きた
    return;
  }
  state.phase = state.wave >= stage.waves.length ? PHASE.CLEAR : PHASE.PREPARE;
}
