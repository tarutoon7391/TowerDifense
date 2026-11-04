// コマンド: プレイヤー操作による状態変更はすべてここを通す
// 各コマンドは { ok: true } または { ok: false, reason: '理由' } を返す
import {
  TOWERS, WAVE_RULES, TICK_RATE, UPGRADE, ECONOMY, SPELLS, MUTATIONS,
  CELL_EMPTY, CELL_TOWER, CELL_WATER, CELL_HILL, CELL_FLOOR, CELL_ROCK, getStage,
} from './config.js';
import { PHASE, cellIndex, inBounds } from './state.js';
import { computeFlowField, isReachable, computePath } from './pathfinding.js';
import { nextInt } from './rng.js';
import { upgradeCost, needsBranchChoice, getTowerStats } from './towers.js';
import { economyModifiers, portalsOf } from './buffs.js';

function fail(reason) {
  return { ok: false, reason };
}

// 指定マスがスタートまたはゴールか
function isStartOrGoal(map, x, y) {
  return (x === map.start.x && y === map.start.y) || (x === map.goal.x && y === map.goal.y);
}

// 現在のグリッドと転送門から距離マップを計算し直す
export function recomputeFlow(state) {
  state.flow = computeFlowField(state.grid, state.map, portalsOf(state));
}

// 壁として数える建物か（錬金炉の集計・商人の宿の返金率に使う）
export function isWallType(type) {
  return type === 'wall' || type === 'ironwall' || type === 'thorn' || type === 'pillar' || type === 'drawbridge';
}

// ---- ウェーブ変異（シードとウェーブ番号から決定的に決まる。rng を消費しない） ----
export function mutationForWave(seed, waveIndex) {
  // 2ウェーブ目までは変異なし（チュートリアル）
  if (waveIndex < 2) return MUTATIONS[0];
  let h = (seed ^ (waveIndex * 2654435761)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  const total = MUTATIONS.reduce((s, m) => s + m.weight, 0);
  let r = h % total;
  for (const m of MUTATIONS) {
    if (r < m.weight) return m;
    r -= m.weight;
  }
  return MUTATIONS[0];
}

// 設置できるかを副作用なしで判定する（UIのプレビューにも使う）
// 戻り値は { ok, reason?, flow? }。ok のとき flow に配置後の距離マップが入る
export function canPlaceTower(state, x, y, type) {
  if (state.phase !== PHASE.PREPARE) return fail('準備フェーズ中のみ建設できます');
  const def = TOWERS[type];
  if (!def) return fail('不明なタワー種別です');
  const map = state.map;
  if (!inBounds(map, x, y)) return fail('マップの外には建てられません');
  if (isStartOrGoal(map, x, y)) return fail('門と城の上には建てられません');
  const idx = cellIndex(map, x, y);
  const cell = state.grid[idx];
  if (cell === CELL_TOWER || cell === CELL_FLOOR) return fail('すでに建物があります');
  if (def.placeOn === 'water') {
    if (cell !== CELL_WATER) return fail(`${def.name}は水の上にだけ置けます`);
  } else if (def.placeOn === 'rock') {
    if (cell !== CELL_ROCK) return fail(`${def.name}は岩の上にだけ使えます`);
  } else if (def.passable) {
    if (cell !== CELL_EMPTY) return fail('床や罠は平地にだけ置けます');
  } else if (cell !== CELL_EMPTY && cell !== CELL_HILL) {
    return fail('岩や水の上には建てられません');
  }
  if (def.limit && state.towers.filter((t) => t.type === type).length >= def.limit) {
    return fail(`${def.name}は1ステージに${def.limit}基までです`);
  }
  if (state.money < def.cost) return fail('お金が足りません（必要: ' + def.cost + '）');

  // グリッドの複製に仮配置して経路が残るか確認（元の状態は触らない）
  const trial = state.grid.slice();
  trial[idx] = def.convertsToLand ? CELL_EMPTY : def.passable ? CELL_FLOOR : CELL_TOWER;
  let portals = portalsOf(state);
  if (def.portal) {
    // 2基目を置くときは組になる（経路計算に反映）
    const ps = state.towers.filter((t) => t.type === 'portal');
    if (ps.length % 2 === 1) {
      const last = ps[ps.length - 1];
      portals = [...portals, { a: { x: last.x, y: last.y }, b: { x, y } }];
    }
  }
  const flow = computeFlowField(trial, map, portals);
  if (!isReachable(flow, map)) return fail('経路を完全に塞ぐ配置はできません');
  return { ok: true, flow };
}

// タワーを設置する（準備フェーズのみ）
export function placeTower(state, x, y, type) {
  const check = canPlaceTower(state, x, y, type);
  if (!check.ok) return check;
  const def = TOWERS[type];
  const cost = def.cost;
  const idx = cellIndex(state.map, x, y);
  const wasHill = state.grid[idx] === CELL_HILL;
  state.money -= cost;
  if (def.convertsToLand) {
    // 桟橋・発破: そのマスを陸地にするだけで、建物としては残らない
    state.grid[idx] = CELL_EMPTY;
    state.flow = check.flow;
    return { ok: true, converted: true };
  }
  state.grid[idx] = def.passable ? CELL_FLOOR : CELL_TOWER;
  state.towers.push({
    id: state.nextId++, x, y, type, level: 1, branch: null, cooldown: 0, invested: cost,
    builtWave: state.wave,   // 建てた時点のウェーブ数（成長収入の計算に使う）
    onHill: wasHill,         // 高台の上か（射程ボーナス・売却時に高台へ戻す）
    armed: true,             // 罠・警鐘が作動可能か
    open: false,             // 跳ね橋が開いているか（開くと通れる）
    boostUntil: 0,           // 警鐘のブースト期限（waveTick）
    boostMul: 1,
    rampTarget: 0,           // 威力上昇の対象敵ID
    rampStacks: 0,           // 威力上昇の段数
  });
  state.flow = check.flow;
  return { ok: true };
}

// 建物を取り除き、グリッドを元に戻す（売却・破壊の共通処理）
export function removeTowerAt(state, index) {
  const tower = state.towers[index];
  state.towers.splice(index, 1);
  state.grid[cellIndex(state.map, tower.x, tower.y)] = tower.onHill ? CELL_HILL : CELL_EMPTY;
  state.units = state.units.filter((u) => u.ownerId !== tower.id);
  recomputeFlow(state);
  return tower;
}

// 現在の売却返金率（商人の宿があれば上がる）
export function currentSellRate(state, tower = null) {
  const mod = economyModifiers(state);
  return tower && isWallType(tower.type) ? mod.wallSellRate : mod.sellRate;
}

// 現在の強化費用（練兵場があれば割引）。最大レベルなら null
export function currentUpgradeCost(state, tower) {
  const base = upgradeCost(tower.type, tower.level);
  if (base === null) return null;
  return Math.round(base * economyModifiers(state).upgradeDiscount);
}

// タワーを売却する（準備フェーズのみ）。投資額（建設費＋強化費）の一定割合を返金
export function sellTower(state, x, y) {
  if (state.phase !== PHASE.PREPARE) return fail('準備フェーズ中のみ売却できます');
  const i = state.towers.findIndex((t) => t.x === x && t.y === y);
  if (i < 0) return fail('そのマスに建物はありません');
  const tower = state.towers[i];
  // 返金率は売る建物自身を除いて計算する（商人の宿を売るときに自分の効果は乗らない）
  const others = { towers: state.towers.filter((t) => t !== tower) };
  const mod = economyModifiers(others);
  const rate = isWallType(tower.type) ? mod.wallSellRate : mod.sellRate;
  const refund = Math.floor(tower.invested * rate);
  removeTowerAt(state, i);
  state.money += refund;
  return { ok: true, refund };
}

// タワーを強化する（準備フェーズのみ）。Lv3 に分岐がある建物は branch（'a'|'b'）の指定が必要
export function upgradeTower(state, x, y, branch = null) {
  if (state.phase !== PHASE.PREPARE) return fail('準備フェーズ中のみ強化できます');
  const tower = state.towers.find((t) => t.x === x && t.y === y);
  if (!tower) return fail('そのマスに建物はありません');
  if (isWallType(tower.type) && !TOWERS[tower.type].buff && TOWERS[tower.type].attack === 'none') return fail('壁は強化できません');
  const cost = currentUpgradeCost(state, tower);
  if (cost === null) return fail('すでに最大レベル（' + UPGRADE.maxLevel + '）です');
  if (needsBranchChoice(tower.type, tower.level)) {
    if (!branch || !TOWERS[tower.type].branches[branch]) return fail('強化の方向（分岐）を選んでください');
  }
  if (state.money < cost) return fail('お金が足りません（必要: ' + cost + '）');
  tower.level += 1;
  tower.invested += cost;
  if (needsBranchChoice(tower.type, tower.level - 1)) tower.branch = branch;
  state.money -= cost;
  return { ok: true, level: tower.level, branch: tower.branch };
}

// 跳ね橋の開閉（準備フェーズのみ）。閉じる＝壁、開く＝通れる床
export function toggleBridge(state, x, y) {
  if (state.phase !== PHASE.PREPARE) return fail('準備フェーズ中のみ開閉できます');
  const tower = state.towers.find((t) => t.x === x && t.y === y);
  if (!tower || !TOWERS[tower.type].toggleable) return fail('そのマスに跳ね橋はありません');
  const idx = cellIndex(state.map, x, y);
  const trial = state.grid.slice();
  trial[idx] = tower.open ? CELL_TOWER : CELL_FLOOR;
  const flow = computeFlowField(trial, state.map, portalsOf(state));
  if (!isReachable(flow, state.map)) return fail('閉じると経路を完全に塞いでしまいます');
  tower.open = !tower.open;
  state.grid[idx] = trial[idx];
  state.flow = flow;
  return { ok: true, open: tower.open };
}

// 兵舎・騎士団の兵士を、建物の周囲の「経路上のマス」に配置する（ウェーブ開始時）
function deployUnits(state) {
  // 最優先は「現在の最短経路の上」。無ければ到達可能な通れるマス
  const mainPath = new Set(computePath(state.flow, state.map, portalsOf(state)).map((c) => `${c.x},${c.y}`));
  const passable = new Set();
  for (let y = 0; y < state.map.rows; y++) {
    for (let x = 0; x < state.map.cols; x++) {
      const v = state.grid[cellIndex(state.map, x, y)];
      if ((v === CELL_EMPTY || v === CELL_FLOOR) && state.flow[cellIndex(state.map, x, y)] >= 0) passable.add(`${x},${y}`);
    }
  }
  const taken = new Set();
  for (const t of state.towers) {
    const st = getTowerStats(t.type, t.level, t.branch);
    if (!st.units) continue;
    const existing = state.units.filter((u) => u.ownerId === t.id);
    // 候補: 範囲内のマスを「経路上を優先・近い順」に
    const cands = [];
    for (const key of passable) {
      const [x, y] = key.split(',').map(Number);
      if (x === state.map.start.x && y === state.map.start.y) continue;
      if (x === state.map.goal.x && y === state.map.goal.y) continue;
      const d = Math.hypot(x - t.x, y - t.y);
      if (d <= st.units.range) cands.push({ x, y, d, onPath: mainPath.has(key) ? 0 : 1 });
    }
    cands.sort((a, b) => a.onPath - b.onPath || a.d - b.d || a.y - b.y || a.x - b.x);
    let placed = existing.length;
    for (const c of cands) {
      if (placed >= st.units.count) break;
      const key = `${c.x},${c.y}`;
      if (taken.has(key) || existing.some((u) => u.x === c.x && u.y === c.y)) continue;
      taken.add(key);
      state.units.push({ id: state.nextId++, ownerId: t.id, type: t.type, x: c.x, y: c.y, hp: st.units.hp, maxHp: st.units.hp, deadAt: -1 });
      placed += 1;
    }
    for (const u of existing) { u.hp = u.maxHp; u.deadAt = -1; taken.add(`${u.x},${u.y}`); }
  }
}

// ウェーブの出現予定を組み立ててキューに積む（offsetTick 以降に出現）
function enqueueWave(state, def, waveIndex, offsetTick) {
  const mut = mutationForWave(state.seed, waveIndex);
  let first = true;
  for (const g of def.groups) {
    const count = Math.round(g.count * (mut.countMul || 1));
    for (let i = 0; i < count; i++) {
      const sec = g.startDelay + g.interval * i;
      const jitter = nextInt(state.rng, 0, WAVE_RULES.spawnJitterTicks);
      state.spawnQueue.push({
        type: g.type,
        spawnTick: offsetTick + Math.round(sec * TICK_RATE) + jitter,
        hpMul: def.hpMul * (mut.hpMulMul || 1),
        mutation: mut.id,
        giant: first && !!mut.giantHpMul,
      });
      first = false;
    }
  }
  // 安定ソート（同tickは定義順）
  state.spawnQueue.sort((a, b) => a.spawnTick - b.spawnTick);
}

// ウェーブを開始する（準備フェーズ → ウェーブフェーズ）
export function startWave(state) {
  if (state.phase !== PHASE.PREPARE) return fail('いまはウェーブを開始できません');
  const waves = getStage(state.stageId).waves;
  if (state.wave >= waves.length) return fail('すべてのウェーブが終了しています');
  const def = waves[state.wave];
  const waveIndex = state.wave;
  state.wave += 1;
  state.phase = PHASE.WAVE;
  state.waveTick = 0;
  state.spawnQueue = [];
  state.destroyed = [];
  for (const t of state.towers) { t.armed = true; t.boostUntil = 0; }
  deployUnits(state);
  enqueueWave(state, def, waveIndex, 0);
  return { ok: true, wave: state.wave };
}

// 早回しコール: ウェーブ中に次のウェーブを前倒しで呼ぶ。残っている敵の数だけボーナス
export function callNextWave(state) {
  if (state.phase !== PHASE.WAVE) return fail('ウェーブ中にだけ呼べます');
  const waves = getStage(state.stageId).waves;
  if (state.wave >= waves.length) return fail('これが最終ウェーブです');
  if (state.spawnQueue.length > 0) return fail('現在のウェーブの敵がまだ出きっていません');
  const remaining = state.enemies.length;
  const bonus = remaining * ECONOMY.earlyCallGold;
  state.money += bonus;
  state.stats.earned += bonus;
  state.stats.earlyCalls += 1;
  const def = waves[state.wave];
  const waveIndex = state.wave;
  state.wave += 1;
  enqueueWave(state, def, waveIndex, state.waveTick);
  return { ok: true, wave: state.wave, bonus };
}

// アクティブ魔法を使う（魔力炉で貯めた魔力を消費）
export function castSpell(state, spellId, x = 0, y = 0) {
  const spell = SPELLS[spellId];
  if (!spell) return fail('不明な魔法です');
  if (state.mana < spell.cost) return fail(`魔力が足りません（必要: ${spell.cost}）`);
  if (spellId === 'repair') {
    if (state.destroyed.length === 0) return fail('このウェーブで壊された壁はありません');
    let restored = 0;
    for (const d of state.destroyed) {
      const idx = cellIndex(state.map, d.x, d.y);
      if (state.grid[idx] !== CELL_EMPTY && state.grid[idx] !== CELL_HILL) continue;
      if (state.enemies.some((e) => !e.flying && e.cx === d.x && e.cy === d.y)) continue; // 敵が乗っている
      const wasHill = state.grid[idx] === CELL_HILL;
      const trial = state.grid.slice();
      trial[idx] = CELL_TOWER;
      const flow = computeFlowField(trial, state.map, portalsOf(state));
      if (!isReachable(flow, state.map)) continue;
      state.grid[idx] = CELL_TOWER;
      state.towers.push({
        id: state.nextId++, x: d.x, y: d.y, type: d.type, level: 1, branch: null, cooldown: 0,
        invested: TOWERS[d.type].cost, builtWave: state.wave, onHill: wasHill,
        armed: true, open: false, boostUntil: 0, boostMul: 1, rampTarget: 0, rampStacks: 0,
      });
      state.flow = flow;
      restored += 1;
    }
    state.destroyed = [];
    if (restored === 0) return fail('修復できる壁がありません');
    state.mana -= spell.cost;
    return { ok: true, restored };
  }
  if (state.phase !== PHASE.WAVE) return fail('攻撃魔法はウェーブ中にだけ使えます');
  if (spellId === 'meteor' && !inBounds(state.map, Math.floor(x), Math.floor(y))) return fail('マップの中を指定してください');
  state.mana -= spell.cost;
  // 実際の効果は simulation 側で処理するため、保留リストに積む
  state.pendingSpells.push({ id: spellId, x, y });
  return { ok: true };
}
