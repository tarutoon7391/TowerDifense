// コマンドの制約テスト（node --test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, PHASE, cellIndex } from '../shared/state.js';
import { placeTower, sellTower, startWave, upgradeTower } from '../shared/commands.js';
import { step } from '../shared/simulation.js';
import { TOWERS, ECONOMY, UPGRADE, CELL_EMPTY, CELL_TOWER, CELL_ROCK } from '../shared/config.js';

// 列 col を1マス（leaveY）だけ残して壁で埋める
function wallColumnExceptOne(state, col, leaveY) {
  for (let y = 0; y < state.map.rows; y++) {
    if (y === leaveY) continue;
    const r = placeTower(state, col, y, 'wall');
    assert.equal(r.ok, true, `(${col},${y}) の配置に失敗: ${r.reason}`);
  }
}

test('経路を完全に塞ぐ配置は拒否される', () => {
  const state = createState({ seed: 1 });
  state.money = 100000; // お金の制約を外す
  wallColumnExceptOne(state, 1, 0);
  const before = state.towers.length;
  const r = placeTower(state, 1, 0, 'wall');
  assert.equal(r.ok, false);
  assert.match(r.reason, /塞ぐ/);
  // 取り消されてグリッド・タワー数が変わっていない
  assert.equal(state.grid[cellIndex(state.map, 1, 0)], CELL_EMPTY);
  assert.equal(state.towers.length, before);
});

test('スタート・ゴールの上には建てられない', () => {
  const state = createState({ seed: 1 });
  const { start, goal } = state.map;
  assert.equal(placeTower(state, start.x, start.y, 'archer').ok, false);
  assert.equal(placeTower(state, goal.x, goal.y, 'archer').ok, false);
});

test('岩・水の上には建てられない', () => {
  const state = createState({ seed: 1, stageId: 'canyon' });
  // 渓谷ステージは最上段が岩
  assert.equal(state.grid[cellIndex(state.map, 3, 0)], CELL_ROCK);
  const r = placeTower(state, 3, 0, 'wall');
  assert.equal(r.ok, false);
  assert.match(r.reason, /岩や水/);
  const lake = createState({ seed: 1, stageId: 'lake' });
  assert.equal(placeTower(lake, 10, 6, 'wall').ok, false); // 湖の中
});

test('ウェーブ中は配置・売却・強化が拒否される', () => {
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
  const u = upgradeTower(state, 3, 3);
  assert.equal(u.ok, false);
  assert.match(u.reason, /準備フェーズ/);
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
  assert.equal(state.grid[cellIndex(state.map, 5, 5)], CELL_EMPTY);
  // 何もないマスの売却は失敗
  assert.equal(sellTower(state, 5, 5).ok, false);
});

test('同じマスに二重には建てられない', () => {
  const state = createState({ seed: 1 });
  assert.equal(placeTower(state, 2, 2, 'archer').ok, true);
  assert.equal(state.grid[cellIndex(state.map, 2, 2)], CELL_TOWER);
  const r = placeTower(state, 2, 2, 'wall');
  assert.equal(r.ok, false);
  assert.match(r.reason, /すでに/);
});

test('強化は費用を払ってレベルが上がり、最大レベルで止まる。売却は投資額の半額', () => {
  const state = createState({ seed: 1 });
  state.money = 10000;
  assert.equal(placeTower(state, 2, 2, 'archer').ok, true);
  const base = TOWERS.archer.cost;
  let money = state.money;
  const u1 = upgradeTower(state, 2, 2);
  assert.equal(u1.ok, true);
  assert.equal(u1.level, 2);
  assert.equal(state.money, money - Math.round(base * UPGRADE.costMul[1]));
  money = state.money;
  // アーチャーは Lv3 で分岐があるので、分岐を指定しないと失敗する
  const noBranch = upgradeTower(state, 2, 2);
  assert.equal(noBranch.ok, false);
  assert.match(noBranch.reason, /分岐/);
  const u2 = upgradeTower(state, 2, 2, 'b');
  assert.equal(u2.ok, true);
  assert.equal(u2.level, 3);
  assert.equal(u2.branch, 'b');
  assert.equal(state.money, money - Math.round(base * UPGRADE.costMul[2]));
  const u3 = upgradeTower(state, 2, 2);
  assert.equal(u3.ok, false);
  assert.match(u3.reason, /最大レベル/);
  const invested = base + Math.round(base * UPGRADE.costMul[1]) + Math.round(base * UPGRADE.costMul[2]);
  assert.equal(state.towers[0].invested, invested);
  const s = sellTower(state, 2, 2);
  assert.equal(s.refund, Math.floor(invested * ECONOMY.sellRefundRate));
});

test('石壁は強化できない。お金不足でも強化できない', () => {
  const state = createState({ seed: 1 });
  assert.equal(placeTower(state, 2, 2, 'wall').ok, true);
  assert.match(upgradeTower(state, 2, 2).reason, /壁/);
  assert.equal(placeTower(state, 3, 3, 'archer').ok, true);
  state.money = 0;
  assert.match(upgradeTower(state, 3, 3).reason, /お金/);
});

test('ウェーブ中に敵が出現し、最終的に準備フェーズへ戻る', () => {
  const state = createState({ seed: 7 });
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
  const state = createState({ seed: 3, stageId: 'castle' });
  placeTower(state, 2, 7, 'lightning');
  startWave(state);
  for (let i = 0; i < 120; i++) step(state);
  const copy = JSON.parse(JSON.stringify(state));
  assert.deepEqual(copy, state);
});
