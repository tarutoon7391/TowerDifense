// コマンド: プレイヤー操作による状態変更はすべてここを通す
// 各コマンドは { ok: true } または { ok: false, reason: '理由' } を返す
import { MAP, TOWERS, WAVES, ECONOMY, WAVE_RULES, TICK_RATE } from './config.js';
import { PHASE, cellIndex, inBounds } from './state.js';
import { computeFlowField, isReachable } from './pathfinding.js';
import { nextInt } from './rng.js';

function fail(reason) {
  return { ok: false, reason };
}

// 指定マスがスタートまたはゴールか
function isStartOrGoal(x, y) {
  return (x === MAP.start.x && y === MAP.start.y) || (x === MAP.goal.x && y === MAP.goal.y);
}

// 設置できるかを副作用なしで判定する（UIのプレビューにも使う）
// 戻り値は { ok, reason?, flow? }。ok のとき flow に配置後の距離マップが入る
export function canPlaceTower(state, x, y, type) {
  if (state.phase !== PHASE.PREPARE) return fail('準備フェーズ中のみ建設できます');
  const def = TOWERS[type];
  if (!def) return fail('不明なタワー種別です');
  if (!inBounds(x, y)) return fail('マップの外には建てられません');
  if (isStartOrGoal(x, y)) return fail('門と城の上には建てられません');
  const idx = cellIndex(x, y);
  if (state.grid[idx] !== 0) return fail('すでにタワーがあります');
  if (state.money < def.cost) return fail('お金が足りません（必要: ' + def.cost + '）');

  // グリッドの複製に仮配置して経路が残るか確認（元の状態は触らない）
  const trial = state.grid.slice();
  trial[idx] = 1;
  const flow = computeFlowField(trial);
  if (!isReachable(flow)) return fail('経路を完全に塞ぐ配置はできません');
  return { ok: true, flow };
}

// タワーを設置する（準備フェーズのみ）
export function placeTower(state, x, y, type) {
  const check = canPlaceTower(state, x, y, type);
  if (!check.ok) return check;
  state.grid[cellIndex(x, y)] = 1;
  state.towers.push({ id: state.nextId++, x, y, type, cooldown: 0 });
  state.money -= TOWERS[type].cost;
  state.flow = check.flow;
  return { ok: true };
}

// タワーを売却する（準備フェーズのみ）。建設費の一定割合を返金
export function sellTower(state, x, y) {
  if (state.phase !== PHASE.PREPARE) return fail('準備フェーズ中のみ売却できます');
  const i = state.towers.findIndex((t) => t.x === x && t.y === y);
  if (i < 0) return fail('そのマスにタワーはありません');
  const tower = state.towers[i];
  const refund = Math.floor(TOWERS[tower.type].cost * ECONOMY.sellRefundRate);
  state.towers.splice(i, 1);
  state.grid[cellIndex(x, y)] = 0;
  state.money += refund;
  state.flow = computeFlowField(state.grid);
  return { ok: true, refund };
}

// ウェーブを開始する（準備フェーズ → ウェーブフェーズ）
export function startWave(state) {
  if (state.phase !== PHASE.PREPARE) return fail('いまはウェーブを開始できません');
  if (state.wave >= WAVES.length) return fail('すべてのウェーブが終了しています');
  const def = WAVES[state.wave];
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
