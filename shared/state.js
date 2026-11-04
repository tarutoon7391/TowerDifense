// ゲーム状態の生成
// 状態はすべてプレーンなオブジェクト/配列/数値/文字列で構成し、JSON.stringify で丸ごと保存できる
import { getStage, CELL_EMPTY, CELL_ROCK, CELL_WATER } from './config.js';
import { createRng } from './rng.js';
import { computeFlowField } from './pathfinding.js';

// フェーズ定数
export const PHASE = {
  PREPARE: 'prepare',    // 準備（建築・売却・強化ができる）
  WAVE: 'wave',          // ウェーブ進行中
  GAMEOVER: 'gameover',  // ライフ0
  CLEAR: 'clear',        // 全ウェーブ撃退
};

// グリッドのインデックス計算
export function cellIndex(map, x, y) {
  return y * map.cols + x;
}

// マスがマップ内か
export function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.cols && y < map.rows;
}

// ステージ定義の障害物（矩形）をグリッドに書き込む
function buildGrid(stage) {
  const { cols, rows } = stage.map;
  const grid = new Array(cols * rows).fill(CELL_EMPTY);
  for (const o of stage.obstacles) {
    const v = o.kind === 'water' ? CELL_WATER : CELL_ROCK;
    for (let y = o.y; y < o.y + o.h; y++) {
      for (let x = o.x; x < o.x + o.w; x++) {
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        grid[y * cols + x] = v;
      }
    }
  }
  // 門と城は必ず空ける
  grid[stage.map.start.y * cols + stage.map.start.x] = CELL_EMPTY;
  grid[stage.map.goal.y * cols + stage.map.goal.x] = CELL_EMPTY;
  return grid;
}

// 初期状態を作る
export function createState({ seed = 1, stageId = 'meadow' } = {}) {
  const stage = getStage(stageId);
  const map = {
    cols: stage.map.cols,
    rows: stage.map.rows,
    start: { x: stage.map.start.x, y: stage.map.start.y },
    goal: { x: stage.map.goal.x, y: stage.map.goal.y },
  };
  const grid = buildGrid(stage);
  const state = {
    seed,
    stageId: stage.id,
    map,
    rng: createRng(seed),
    tick: 0,              // 通算tick
    waveTick: 0,          // 現在ウェーブ内のtick（準備中は0）
    phase: PHASE.PREPARE,
    money: stage.initialMoney,
    lives: stage.initialLives,
    wave: 0,              // 開始済みウェーブ数（1始まり。0はまだ開始していない）
    grid,
    towers: [],           // { id, x, y, type, level, cooldown, invested }
    enemies: [],          // { id, type, x, y, hp, maxHp, ... }
    projectiles: [],      // { id, kind, x, y, speed, damage, targetId, tx, ty, ... }
    effects: [],          // 演出用の一時オブジェクト { kind, ttl, ... }（ロジックには影響しない）
    spawnQueue: [],       // { type, spawnTick, hpMul }（spawnTick昇順）
    nextId: 1,
    flow: [],             // ゴールからの距離マップ（-1は到達不能）
    stats: { kills: 0, leaked: 0, earned: 0 },
  };
  state.flow = computeFlowField(grid, map);
  return state;
}
