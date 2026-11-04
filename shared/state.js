// ゲーム状態の生成
// 状態はすべてプレーンなオブジェクト/配列/数値/文字列で構成し、JSON.stringify で丸ごと保存できる
import { MAP, ECONOMY } from './config.js';
import { createRng } from './rng.js';
import { computeFlowField } from './pathfinding.js';

// フェーズ定数
export const PHASE = {
  PREPARE: 'prepare',    // 準備（建築・売却ができる）
  WAVE: 'wave',          // ウェーブ進行中
  GAMEOVER: 'gameover',  // ライフ0
  CLEAR: 'clear',        // 全ウェーブ撃退
};

// グリッドのインデックス計算
export function cellIndex(x, y) {
  return y * MAP.cols + x;
}

// マスがマップ内か
export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < MAP.cols && y < MAP.rows;
}

// 初期状態を作る
export function createState({ seed = 1 } = {}) {
  const grid = new Array(MAP.cols * MAP.rows).fill(0); // 0: 空き, 1: タワー
  const state = {
    seed,
    rng: createRng(seed),
    tick: 0,              // 通算tick
    waveTick: 0,          // 現在ウェーブ内のtick（準備中は0）
    phase: PHASE.PREPARE,
    money: ECONOMY.initialMoney,
    lives: ECONOMY.initialLives,
    wave: 0,              // 開始済みウェーブ数（1始まり。0はまだ開始していない）
    grid,
    towers: [],           // { id, x, y, type, cooldown }
    enemies: [],          // { id, type, x, y, hp, maxHp, speed, reward, cx, cy, tx, ty, slowUntil, slowFactor }
    projectiles: [],      // { id, kind, x, y, speed, damage, targetId, tx, ty, slow, splashRadius, towerType }
    spawnQueue: [],       // { type, spawnTick, hpMul }（spawnTick昇順）
    nextId: 1,
    flow: [],             // ゴールからの距離マップ（-1は到達不能）
    stats: { kills: 0, leaked: 0 },
  };
  state.flow = computeFlowField(grid);
  return state;
}
