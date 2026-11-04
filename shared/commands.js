// コマンド: プレイヤー操作による状態変更はすべてここを通す
// 各コマンドは { ok: true } または { ok: false, reason: '理由' } を返す
import { TOWERS, WAVE_RULES, TICK_RATE, UPGRADE, CELL_EMPTY, CELL_TOWER, getStage } from './config.js';
import { PHASE, cellIndex, inBounds } from './state.js';
import { computeFlowField, isReachable } from './pathfinding.js';
import { nextInt } from './rng.js';
import { upgradeCost } from './towers.js';
import { economyModifiers } from './buffs.js';

function fail(reason) {
  return { ok: false, reason };
}

// 指定マスがスタートまたはゴールか
function isStartOrGoal(map, x, y) {
  return (x === map.start.x && y === map.start.y) || (x === map.goal.x && y === map.goal.y);
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
  if (state.grid[idx] === CELL_TOWER) return fail('すでに建物があります');
  if (state.grid[idx] !== CELL_EMPTY) return fail('岩や水の上には建てられません');
  if (state.money < def.cost) return fail('お金が足りません（必要: ' + def.cost + '）');

  // グリッドの複製に仮配置して経路が残るか確認（元の状態は触らない）
  const trial = state.grid.slice();
  trial[idx] = CELL_TOWER;
  const flow = computeFlowField(trial, map);
  if (!isReachable(flow, map)) return fail('経路を完全に塞ぐ配置はできません');
  return { ok: true, flow };
}

// タワーを設置する（準備フェーズのみ）
export function placeTower(state, x, y, type) {
  const check = canPlaceTower(state, x, y, type);
  if (!check.ok) return check;
  const cost = TOWERS[type].cost;
  state.grid[cellIndex(state.map, x, y)] = CELL_TOWER;
  state.towers.push({
    id: state.nextId++, x, y, type, level: 1, cooldown: 0, invested: cost,
    builtWave: state.wave,   // 建てた時点のウェーブ数（成長収入の計算に使う）
    rampTarget: 0,           // 威力上昇の対象敵ID
    rampStacks: 0,           // 威力上昇の段数
  });
  state.money -= cost;
  state.flow = check.flow;
  return { ok: true };
}

// 現在の売却返金率（商人の宿があれば上がる）
export function currentSellRate(state) {
  return economyModifiers(state).sellRate;
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
  const refund = Math.floor(tower.invested * economyModifiers(others).sellRate);
  state.towers.splice(i, 1);
  state.grid[cellIndex(state.map, x, y)] = CELL_EMPTY;
  state.money += refund;
  state.flow = computeFlowField(state.grid, state.map);
  return { ok: true, refund };
}

// タワーを強化する（準備フェーズのみ）
export function upgradeTower(state, x, y) {
  if (state.phase !== PHASE.PREPARE) return fail('準備フェーズ中のみ強化できます');
  const tower = state.towers.find((t) => t.x === x && t.y === y);
  if (!tower) return fail('そのマスに建物はありません');
  if (tower.type === 'wall') return fail('石壁は強化できません');
  const cost = currentUpgradeCost(state, tower);
  if (cost === null) return fail('すでに最大レベル（' + UPGRADE.maxLevel + '）です');
  if (state.money < cost) return fail('お金が足りません（必要: ' + cost + '）');
  tower.level += 1;
  tower.invested += cost;
  state.money -= cost;
  return { ok: true, level: tower.level };
}

// ウェーブを開始する（準備フェーズ → ウェーブフェーズ）
export function startWave(state) {
  if (state.phase !== PHASE.PREPARE) return fail('いまはウェーブを開始できません');
  const waves = getStage(state.stageId).waves;
  if (state.wave >= waves.length) return fail('すべてのウェーブが終了しています');
  const def = waves[state.wave];
  state.wave += 1;
  state.phase = PHASE.WAVE;
  state.waveTick = 0;

  // 出現予定を tick 単位で組み立てる（ゆらぎはシード乱数）
  const queue = [];
  for (const g of def.groups) {
    for (let i = 0; i < g.count; i++) {
      const sec = g.startDelay + g.interval * i;
      const jitter = nextInt(state.rng, 0, WAVE_RULES.spawnJitterTicks);
      queue.push({ type: g.type, spawnTick: Math.round(sec * TICK_RATE) + jitter, hpMul: def.hpMul });
    }
  }
  // 安定ソート（同tickは定義順）
  queue.sort((a, b) => a.spawnTick - b.spawnTick);
  state.spawnQueue = queue;
  return { ok: true, wave: state.wave };
}
