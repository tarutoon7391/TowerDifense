// コマンドの制約テスト（node --test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, PHASE } from '../shared/state.js';
import { placeTower, sellTower, startWave } from '../shared/commands.js';
import { step } from '../shared/simulation.js';
import { MAP, TOWERS, ECONOMY } from '../shared/config.js';

// スタート列の隣（x=1）を縦一列に塞ぐための補助。最後の1マスだけ残して返す
function wallColumnExceptOne(state, col, leaveY) {
  for (let y = 0; y < MAP.rows; y++) {
    if (y === leaveY) continue;
    const r = placeTower(state, col, y, 'archer');
    assert.equal(r.ok, true, `(${col},${y}) の配置に失敗: ${r.reason}`);
  }
}

test('経路を完全に塞ぐ配置は拒否される', () => {
  const state = createState({ seed: 1 });
  state.money = 100000; // お金の制約を外す
  wallColumnExceptOne(state, 1, 0);
  const before = state.towers.length;
  const r = placeTower(state, 1, 0, 'archer');
  assert.equal(r.ok, false);
  assert.match(r.reason, /塞ぐ/);
  // 取り消されてグリッド・タワー数が変わっていない
  assert.equal(state.grid[0 * MAP.cols + 1], 0);
  assert.equal(state.towers.length, before);
});

test('スタート・ゴールの上には建てられない', () => {
  const state = createState({ seed: 1 });
  assert.equal(placeTower(state, MAP.start.x, MAP.start.y, 'archer').ok, false);
  assert.equal(placeTower(state, MAP.goal.x, MAP.goal.y, 'archer').ok, false);
});

test('ウェーブ中は配置も売却も拒否される', () => {
  const state = createState({ seed: 1 });
  assert.equal(placeTower(state, 3, 3, 'archer').ok, true);
  const r = startWave(state);
  assert.equal(r.ok, true);
  assert.equal(state.phase, PHASE.WAVE);
  step(state);
  const p = placeTower(state, 4, 4, 'archer');
  assert.equal(p.ok, false);
  assert.match(p.reason, /準備フェーズ/);
  const s = sellTower(state, 3, 3);
  assert.equal(s.ok, false);
  assert.match(s.reason, /準備フェーズ/);
  // ウェーブ中の二重開始も不可
  assert.equal(startWave(state).ok, false);
});

test('お金不足では配置できない', () => {
  const state = createState({ seed: 1 });
  state.money = TOWERS.catapult.cost - 1;
  const r = placeTower(state, 5, 5, 'catapult');
  assert.equal(r.ok, false);
  assert.match(r.reason, /お金/);
  assert.equal(state.towers.length, 0);
});

test('売却で建設費の半額が返る', () => {
  const state = createState({ seed: 1 });
  const start = state.money;
  assert.equal(placeTower(state, 5, 5, 'ice').ok, true);
  assert.equal(state.money, start - TOWERS.ice.cost);
  const r = sellTower(state, 5, 5);
  assert.equal(r.ok, true);
  assert.equal(r.refund, Math.floor(TOWERS.ice.cost * ECONOMY.sellRefundRate));
  assert.equal(state.money, start - TOWERS.ice.cost + Math.floor(TOWERS.ice.cost * 0.5));
  assert.equal(state.towers.length, 0);
  assert.equal(state.grid[5 * MAP.cols + 5], 0);
  // 何もないマスの売却は失敗
  assert.equal(sellTower(state, 5, 5).ok, false);
});

test('同じマスに二重には建てられない', () => {
  const state = createState({ seed: 1 });
  assert.equal(placeTower(state, 2, 2, 'archer').ok, true);
  const r = placeTower(state, 2, 2, 'archer');
  assert.equal(r.ok, false);
  assert.match(r.reason, /すでに/);
});

test('ウェーブ中に敵が出現し、最終的に準備フェーズへ戻る', () => {
  const state = createState({ seed: 7 });
  // 門のすぐそばに塔を2本建てて1ウェーブ目を処理する
  assert.equal(placeTower(state, 2, 4, 'archer').ok, true);
  assert.equal(placeTower(state, 2, 6, 'archer').ok, true);
  assert.equal(startWave(state).ok, true);
  let spawned = false;
  for (let i = 0; i < 30 * 120 && state.phase === PHASE.WAVE; i++) {
    step(state);
    if (state.enemies.length > 0) spawned = true;
  }
  assert.equal(spawned, true);
  assert.notEqual(state.phase, PHASE.WAVE);
  assert.equal(state.stats.kills + state.stats.leaked, 8);
});

test('状態は JSON で往復できる', () => {
  const state = createState({ seed: 3 });
  placeTower(state, 4, 4, 'catapult');
  startWave(state);
  for (let i = 0; i < 60; i++) step(state);
  const copy = JSON.parse(JSON.stringify(state));
  assert.deepEqual(copy, state);
});
