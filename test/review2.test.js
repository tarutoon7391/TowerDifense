// 2回目レビュー対応のテスト: スロウ優先・押し戻し免疫・着地・ウェーブ変異・兵士・状態反応・警鐘・契約・賭博・転送門・跳ね橋・発破
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, PHASE, cellIndex } from '../shared/state.js';
import { placeTower, startWave, toggleBridge, mutationForWave, sellTower } from '../shared/commands.js';
import { step } from '../shared/simulation.js';
import { TOWERS, ENEMIES, TICK_RATE, ECONOMY, MUTATIONS, REACTIONS, CELL_EMPTY, CELL_FLOOR, CELL_TOWER, CELL_ROCK, getStage } from '../shared/config.js';
import { effectiveStats, economyModifiers, portalsOf } from '../shared/buffs.js';
import { computePath } from '../shared/pathfinding.js';

function soloWave(state, type, hpMul = 1, extra = []) {
  state.phase = PHASE.WAVE;
  state.wave = 1;
  state.waveTick = 0;
  state.spawnQueue = [{ type, spawnTick: 1, hpMul }, ...extra, { type, spawnTick: 100000, hpMul }];
}

test('スロウは強い方が優先され、弱いスロウで上書きされない', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 4, 'blizzard').ok, true); // ×0.5
  assert.equal(placeTower(state, 3, 4, 'mire').ok, true);     // ×0.7（安い）
  soloWave(state, 'orc');
  step(state);
  const e = state.enemies[0];
  e.x = 2.5; e.y = 5.5; e.speed = 0;
  for (let i = 0; i < TICK_RATE * 3; i++) step(state);
  assert.ok(Math.abs(e.slowFactor - 0.5) < 1e-9, `slowFactor=${e.slowFactor}`);
});

test('押し戻された敵はしばらく押し戻されない', () => {
  const state = createState({ seed: 2 });
  state.money = 100000;
  assert.equal(placeTower(state, 3, 4, 'chainpull').ok, true); // 100% 押し戻し
  soloWave(state, 'orc');
  step(state);
  const e = state.enemies[0];
  let last = -1;
  for (let i = 0; i < TICK_RATE * 4; i++) {
    step(state);
    if (e.knockImmuneUntil > 0 && last === -1) last = state.waveTick;
  }
  assert.ok(last > 0, '押し戻しが起きていない');
  assert.ok(e.knockImmuneUntil - last >= ECONOMY.knockbackImmunitySec * TICK_RATE - 1);
});

test('重力の塔は飛行する敵を着地させ、迷路に従わせる', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  // 門の右の列を壁で塞ぎ、上に迂回させる
  for (let y = 1; y < state.map.rows; y++) assert.equal(placeTower(state, 3, y, 'wall').ok, true);
  assert.equal(placeTower(state, 1, 4, 'gravity').ok, true);
  soloWave(state, 'bat');
  step(state);
  const bat = state.enemies[0];
  for (let i = 0; i < TICK_RATE * 3 && bat.groundedUntil === 0; i++) step(state);
  assert.ok(bat.groundedUntil > state.waveTick, '着地していない');
  // 着地中は迷路に従う（目標がゴールではない）
  assert.ok(!(bat.tx === state.map.goal.x && bat.ty === state.map.goal.y));
});

test('ウェーブ変異はシードとウェーブ番号から決定的に決まり、敵に反映される', () => {
  const a = mutationForWave(123, 5);
  const b = mutationForWave(123, 5);
  assert.equal(a.id, b.id);
  assert.equal(mutationForWave(1, 0).id, 'none');
  const ids = new Set();
  for (let w = 2; w < 40; w++) ids.add(mutationForWave(42, w).id);
  assert.ok(ids.size >= 3, '変異のバリエーションが少なすぎる');
  // 重装の変異を持つウェーブを見つけて、鎧が増えているか確認
  const state = createState({ seed: 1 });
  state.lives = 1000;
  let found = false;
  for (let seed = 1; seed < 200 && !found; seed++) {
    const m = mutationForWave(seed, 3);
    if (m.id !== 'armored') continue;
    found = true;
    const s = createState({ seed });
    s.lives = 1000;
    s.wave = 3;
    startWave(s);
    step(s);
    for (let i = 0; i < TICK_RATE * 2 && s.enemies.length === 0; i++) step(s);
    const e = s.enemies[0];
    assert.equal(e.armor, (ENEMIES[e.type].armor || 0) + m.armorAdd);
    assert.equal(e.mutation, 'armored');
  }
  assert.ok(found);
  void state;
});

test('兵舎の兵士は通路に配置され、敵を足止めし、倒されると再出撃する', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  state.lives = 1000;
  assert.equal(placeTower(state, 2, 4, 'garrison').ok, true);
  assert.equal(startWave(state).ok, true);
  assert.equal(state.units.length, TOWERS.garrison.units.count);
  for (const u of state.units) assert.ok(state.flow[cellIndex(state.map, u.x, u.y)] >= 0, '兵士が経路上にいない');
  let stunned = false;
  for (let i = 0; i < TICK_RATE * 10 && !stunned; i++) {
    step(state);
    stunned = state.enemies.some((e) => e.stunUntil > state.waveTick);
  }
  assert.ok(stunned, '足止めが起きていない');
  // 兵士を倒して再出撃を確認
  const u = state.units[0];
  u.hp = 0; u.deadAt = state.waveTick;
  for (let i = 0; i < ECONOMY.unitRespawnSec * TICK_RATE + 2 && state.phase === PHASE.WAVE; i++) step(state);
  if (state.phase === PHASE.WAVE) assert.equal(u.hp, u.maxHp);
  else assert.equal(u.hp, u.maxHp); // ウェーブ終了時も全回復
});

test('状態反応: 油＋炎で引火爆発、気絶＋砕きで砕け、毒＋聖で浄化', () => {
  // 引火
  const s1 = createState({ seed: 1 });
  s1.money = 100000;
  assert.equal(placeTower(s1, 2, 4, 'flamer').ok, true);
  soloWave(s1, 'orc', 1, [{ type: 'orc', spawnTick: 1, hpMul: 1 }]);
  step(s1);
  const [a, b] = s1.enemies;
  a.x = 2.5; a.y = 5.5; a.speed = 0; a.oilUntil = 10000;
  b.x = 3.2; b.y = 5.5; b.speed = 0; // 爆発半径1.0の中、火炎放射の射程(1.6)の外ではない
  b.oilUntil = 0;
  const hb = b.hp;
  step(s1);
  assert.equal(a.oilUntil, 0, '油が消えていない');
  assert.ok(hb - b.hp >= REACTIONS.oilFire.damage, `爆発ダメージが隣に入っていない lost=${hb - b.hp}`);

  // 砕け
  const s2 = createState({ seed: 1 });
  s2.money = 100000;
  assert.equal(placeTower(s2, 2, 4, 'hammer').ok, true);
  soloWave(s2, 'troll');
  step(s2);
  const t = s2.enemies[0];
  t.x = 2.5; t.y = 5.5; t.speed = 0; t.regen = 0;
  t.hp = Math.floor(t.maxHp * 0.2);
  t.stunUntil = 10000;
  for (let i = 0; i < TICK_RATE * 3 && s2.enemies.length > 0; i++) step(s2);
  assert.equal(s2.enemies.length, 0, '砕けていない');

  // 浄化
  const s3 = createState({ seed: 1 });
  s3.money = 100000;
  assert.equal(placeTower(s3, 2, 4, 'holy').ok, true);
  soloWave(s3, 'troll');
  step(s3);
  const p = s3.enemies[0];
  p.x = 2.5; p.y = 5.5; p.speed = 0; p.regen = 0;
  p.poisonDps = 10; p.poisonUntil = s3.waveTick + TICK_RATE * 5; // 残り約50ダメージ
  const hp0 = p.hp;
  step(s3);
  assert.ok(hp0 - p.hp >= 50, `浄化の一括ダメージが入っていない lost=${hp0 - p.hp}`);
  assert.equal(p.poisonUntil, 0);
});

test('警鐘を踏むと周囲の塔が一時的に強化される', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 1, 5, 'alarm').ok, true);
  assert.equal(placeTower(state, 2, 4, 'archer').ok, true);
  const archer = state.towers.find((t) => t.type === 'archer');
  soloWave(state, 'orc');
  step(state);
  const e = state.enemies[0];
  for (let i = 0; i < TICK_RATE * 3 && e.cx < 1; i++) step(state);
  assert.ok(archer.boostUntil > state.waveTick, 'ブーストが付いていない');
  const eff = effectiveStats(state, archer);
  assert.equal(eff.damage, Math.round(TOWERS.archer.damage * TOWERS.alarm.alarm.damageMul));
  assert.equal(eff.applied.boosted, true);
});

test('悪魔契約は敵HPと報酬を上げ、賭博場は所持金を増減させ、禁断の祭壇はライフを削る', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 2, 'pact').ok, true);
  assert.equal(placeTower(state, 3, 2, 'pact').ok, false); // 1基まで
  const mod = economyModifiers(state);
  assert.equal(mod.enemyHpMul, TOWERS.pact.pact.enemyHpMul);
  soloWave(state, 'goblin');
  step(state);
  const e = state.enemies[0];
  assert.equal(e.maxHp, Math.round(ENEMIES.goblin.hp * TOWERS.pact.pact.enemyHpMul));
  assert.equal(e.reward, Math.round(ENEMIES.goblin.reward * TOWERS.pact.pact.rewardMul));

  const s2 = createState({ seed: 1 });
  s2.money = 100000;
  assert.equal(placeTower(s2, 2, 2, 'casino').ok, true);
  assert.equal(placeTower(s2, 3, 2, 'darkaltar').ok, true);
  s2.money = 1000;
  const lives = s2.lives;
  s2.phase = PHASE.WAVE; s2.wave = 1; s2.spawnQueue = []; s2.enemies = [];
  step(s2);
  assert.ok(s2.lastGamble && (s2.lastGamble.won === true || s2.lastGamble.won === false));
  const bonus = ECONOMY.waveClearBonusBase + ECONOMY.waveClearBonusPerWave;
  const bet = Math.floor((1000 + bonus) * TOWERS.casino.gamble.rate);
  if (s2.lastGamble.won) assert.equal(s2.money, 1000 + bonus + bet);
  else assert.equal(s2.money, 1000 + bonus - bet);
  assert.equal(s2.lives, lives - 1);
});

test('転送門は2基で組になり、経路計算と移動に反映される', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  // 入口を門の近く、出口を城の近くに置くと最短経路が短くなる
  const before = computePath(state.flow, state.map).length;
  assert.equal(placeTower(state, 2, 5, 'portal').ok, true);
  assert.equal(placeTower(state, 17, 5, 'portal').ok, true);
  assert.equal(portalsOf(state).length, 1);
  const after = computePath(state.flow, state.map, portalsOf(state)).length;
  assert.ok(after < before, `${before} → ${after}`);
  assert.equal(placeTower(state, 10, 5, 'portal').ok, false); // 2基まで
  soloWave(state, 'goblin');
  step(state);
  const e = state.enemies[0];
  let jumped = false;
  for (let i = 0; i < TICK_RATE * 5 && !jumped; i++) {
    step(state);
    if (e.cx >= 17) jumped = true;
  }
  assert.ok(jumped, '転送されていない');
});

test('跳ね橋は開閉で壁と床を切り替え、発破は岩を平地にする', () => {
  const state = createState({ seed: 1, stageId: 'canyon' });
  state.money = 100000;
  assert.equal(placeTower(state, 3, 6, 'drawbridge').ok, true);
  const idx = cellIndex(state.map, 3, 6);
  assert.equal(state.grid[idx], CELL_TOWER);
  const r = toggleBridge(state, 3, 6);
  assert.equal(r.ok, true);
  assert.equal(r.open, true);
  assert.equal(state.grid[idx], CELL_FLOOR);
  assert.equal(toggleBridge(state, 3, 6).open, false);
  assert.equal(state.grid[idx], CELL_TOWER);
  sellTower(state, 3, 6);
  assert.equal(state.grid[idx], CELL_EMPTY);

  // 発破: 岩 (5,1) を平地に
  const ri = cellIndex(state.map, 5, 1);
  assert.equal(state.grid[ri], CELL_ROCK);
  assert.equal(placeTower(state, 5, 1, 'blastkit').ok, true);
  assert.equal(state.grid[ri], CELL_EMPTY);
  assert.equal(placeTower(state, 2, 2, 'blastkit').ok, false); // 平地には使えない
});

test('王の玉座は全体を強化し、商人の宿があると壁は全額返金', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 2, 'throne').ok, true);
  assert.equal(placeTower(state, 18, 10, 'archer').ok, true);
  const archer = state.towers.find((t) => t.type === 'archer');
  assert.equal(effectiveStats(state, archer).applied.damageMul, 1.1);
  assert.equal(placeTower(state, 3, 2, 'inn').ok, true);
  assert.equal(placeTower(state, 5, 5, 'wall').ok, true);
  const r = sellTower(state, 5, 5);
  assert.equal(r.refund, TOWERS.wall.cost);
  const r2 = sellTower(state, 18, 10);
  assert.equal(r2.refund, Math.floor(TOWERS.archer.cost * TOWERS.inn.sellRate));
});

test('ボスの到達は即敗北になる', () => {
  const stage = getStage('castle');
  assert.ok(ENEMIES.demon_lord.livesCost >= stage.initialLives);
});
