// 新メカニクスのテスト: ステージ・飛行・分裂・鎧・毒・金鉱・ボス
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, PHASE, cellIndex } from '../shared/state.js';
import { placeTower, startWave } from '../shared/commands.js';
import { step } from '../shared/simulation.js';
import { STAGES, ENEMIES, TOWERS, TICK_RATE, ECONOMY } from '../shared/config.js';
import { isReachable } from '../shared/pathfinding.js';
import { getTowerStats } from '../shared/towers.js';

test('全ステージで初期状態からゴールへ到達でき、ウェーブの敵種別がすべて定義済み', () => {
  for (const stage of STAGES) {
    const state = createState({ seed: 1, stageId: stage.id });
    assert.equal(isReachable(state.flow, state.map), true, `${stage.id}: 到達不能`);
    assert.equal(state.money, stage.initialMoney);
    assert.equal(state.lives, stage.initialLives);
    for (const wave of stage.waves) {
      for (const g of wave.groups) {
        assert.ok(ENEMIES[g.type], `${stage.id}: 不明な敵 ${g.type}`);
      }
    }
  }
  // 分裂先の敵も定義済み
  for (const [type, def] of Object.entries(ENEMIES)) {
    if (def.splitInto) assert.ok(ENEMIES[def.splitInto.type], `${type} の分裂先が未定義`);
  }
});

// 指定の敵1体だけを出現させるヘルパー
function soloWave(state, type, hpMul = 1) {
  state.phase = PHASE.WAVE;
  state.wave = 1;
  state.waveTick = 0;
  state.spawnQueue = [{ type, spawnTick: 1, hpMul }];
}

test('飛行する敵は壁を無視して直進する', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  // 門の右隣の列をほぼ全部塞ぎ、地上の敵は大回りさせる
  for (let y = 0; y < state.map.rows; y++) {
    if (y === 0) continue;
    assert.equal(placeTower(state, 1, y, 'wall').ok, true);
  }
  soloWave(state, 'bat');
  step(state);
  step(state);
  const bat = state.enemies[0];
  assert.equal(bat.flying, true);
  assert.deepEqual({ x: bat.tx, y: bat.ty }, state.map.goal);
  // 数秒進めると壁の列（x=1）を通り越している（y はスタートの行のまま）
  for (let i = 0; i < TICK_RATE * 2; i++) step(state);
  assert.ok(bat.x > 2, `飛行が進んでいない x=${bat.x}`);
  assert.ok(Math.abs(bat.y - (state.map.start.y + 0.5)) < 0.01);
});

test('スライムは倒すと小スライムに分裂し、分裂した分も撃破数に入る', () => {
  const state = createState({ seed: 1 });
  soloWave(state, 'slime');
  step(state);
  const slime = state.enemies[0];
  slime.hp = 0; // 撃破扱いにする
  step(state);
  const small = state.enemies.filter((e) => e.type === 'slime_small');
  assert.equal(small.length, ENEMIES.slime.splitInto.count);
  assert.equal(state.stats.kills, 1);
  assert.equal(state.money, 150 + ENEMIES.slime.reward);
});

test('鎧は物理ダメージを軽減し、貫通と魔法は軽減されない', () => {
  // 塔のすぐ隣に骸骨兵を立たせ、1発分の HP 減少を比べる
  function hitOnce(towerType) {
    const state = createState({ seed: 1 });
    state.money = 100000;
    assert.equal(placeTower(state, 2, 4, towerType).ok, true);
    soloWave(state, 'skeleton');
    step(state);
    const e = state.enemies[0];
    e.x = 2.5; e.y = 5.5; e.speed = 0; // 塔の真下で静止
    const before = e.hp;
    for (let i = 0; i < TICK_RATE * 2 && e.hp === before; i++) step(state);
    return before - e.hp;
  }
  const archer = hitOnce('archer');     // 物理: 12 - 鎧6 = 6
  const ballista = hitOnce('ballista'); // 貫通: 55
  const ice = hitOnce('ice');           // 魔法: 5
  assert.equal(archer, TOWERS.archer.damage - ENEMIES.skeleton.armor);
  assert.equal(ballista, TOWERS.ballista.damage);
  assert.equal(ice, TOWERS.ice.damage);
});

test('投石台は飛行する敵を狙わない', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 4, 'catapult').ok, true);
  soloWave(state, 'gargoyle');
  step(state);
  const e = state.enemies[0];
  e.x = 2.5; e.y = 5.5; e.speed = 0;
  for (let i = 0; i < TICK_RATE * 3; i++) step(state);
  assert.equal(state.projectiles.length, 0);
  assert.equal(e.hp, e.maxHp);
});

test('毒は継続ダメージを与え、トロルは再生する', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 4, 'poison').ok, true);
  soloWave(state, 'orc');
  step(state);
  const e = state.enemies[0];
  e.x = 2.5; e.y = 5.5; e.speed = 0;
  for (let i = 0; i < TICK_RATE * 2; i++) step(state);
  assert.ok(e.poisonUntil > state.waveTick, '毒が付与されていない');
  const lost = e.maxHp - e.hp;
  assert.ok(lost > TOWERS.poison.damage * 2, `毒の継続ダメージが入っていない lost=${lost}`);

  const t = createState({ seed: 1 });
  soloWave(t, 'troll');
  step(t);
  const troll = t.enemies[0];
  troll.hp = 100;
  step(t);
  assert.ok(troll.hp > 100 && troll.hp < troll.maxHp);
});

test('金鉱はウェーブ終了時に収入を生み、レベルで増える', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 2, 'goldmine').ok, true);
  const mine = state.towers[0];
  mine.level = 3;
  const money = state.money;
  // 敵のいないウェーブを即終了させる
  state.phase = PHASE.WAVE;
  state.wave = 1;
  state.spawnQueue = [];
  step(state);
  assert.equal(state.phase, PHASE.PREPARE);
  const bonus = ECONOMY.waveClearBonusBase + ECONOMY.waveClearBonusPerWave * 1;
  assert.equal(state.money, money + bonus + getTowerStats('goldmine', 3).income);
  assert.ok(getTowerStats('goldmine', 3).income > getTowerStats('goldmine', 1).income);
});

test('強化でダメージ・射程が上がりクールダウンが縮む', () => {
  const l1 = getTowerStats('archer', 1);
  const l3 = getTowerStats('archer', 3);
  assert.ok(l3.damage > l1.damage);
  assert.ok(l3.range > l1.range);
  assert.ok(l3.cooldown < l1.cooldown);
  assert.ok(getTowerStats('ice', 3).slow.factor < getTowerStats('ice', 1).slow.factor);
});

test('ボスが到達するとライフを大きく失う', () => {
  const state = createState({ seed: 1, stageId: 'castle' });
  soloWave(state, 'demon_lord');
  step(state);
  const boss = state.enemies[0];
  assert.equal(boss.boss, true);
  boss.reached = true;
  step(state);
  assert.equal(state.lives, 25 - ENEMIES.demon_lord.livesCost);
});

test('撃破報酬は HP 倍率に応じて増える', () => {
  const state = createState({ seed: 1 });
  soloWave(state, 'goblin', 3.0);
  // ウェーブが終わってボーナスが混ざらないよう、2体目を遠い未来に予約しておく
  state.spawnQueue.push({ type: 'goblin', spawnTick: 100000, hpMul: 3.0 });
  step(state);
  const e = state.enemies[0];
  assert.equal(e.reward, Math.round(ENEMIES.goblin.reward * (1 + ECONOMY.rewardHpScale * 2.0)));
  e.hp = 0;
  const money = state.money;
  step(state);
  assert.equal(state.money - money, e.reward);
});

test('毒の継続ダメージは強化で伸び、ボスはスロウ耐性で減速が弱まる', () => {
  assert.ok(getTowerStats('poison', 3).poison.dps > getTowerStats('poison', 1).poison.dps);
  const state = createState({ seed: 1, stageId: 'castle' });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 7, 'ice').ok, true);
  soloWave(state, 'demon_lord');
  step(state);
  const boss = state.enemies[0];
  boss.x = 2.5; boss.y = 8.5; boss.speed = 0;
  for (let i = 0; i < TICK_RATE * 2 && boss.slowUntil === 0; i++) step(state);
  assert.ok(boss.slowUntil > 0, 'スロウが付与されていない');
  const base = getTowerStats('ice', 1).slow.factor;
  const expected = 1 - (1 - base) * (1 - ENEMIES.demon_lord.slowResist);
  assert.ok(Math.abs(boss.slowFactor - expected) < 1e-9);
  assert.ok(boss.slowFactor > base);
});

test('風の弩は飛行に2倍・地上に半減、呪いは鎧を下げて被ダメージを増やす', () => {
  function damageTo(type, towerType) {
    const state = createState({ seed: 1 });
    state.money = 100000;
    assert.equal(placeTower(state, 2, 4, towerType).ok, true);
    soloWave(state, type);
    step(state);
    const e = state.enemies[0];
    e.x = 2.5; e.y = 5.5; e.speed = 0;
    const before = e.hp;
    for (let i = 0; i < TICK_RATE * 2 && e.hp === before; i++) step(state);
    return { lost: before - e.hp, e, state };
  }
  const d = TOWERS.wind.damage;
  assert.equal(damageTo('bat', 'wind').lost, d * TOWERS.wind.flyingMul);
  assert.equal(damageTo('goblin', 'wind').lost, d * TOWERS.wind.groundMul);

  // 呪い: 骸骨兵（鎧6）に呪いが付くと、アーチャーの 12 ダメージがそのまま×1.2 で通る
  const { e, state } = damageTo('skeleton', 'curse');
  assert.ok(e.curseUntil > state.waveTick);
  const hpBefore = e.hp;
  // 同じ状態でアーチャーの弾を直接当てる代わりに applyHit 相当を確認するため、アーチャーを追加して次の命中を待つ
  assert.equal(placeTower({ ...state, phase: PHASE.PREPARE }, 3, 4, 'archer').ok, true);
  state.money = 100000;
  for (let i = 0; i < TICK_RATE * 2 && e.hp === hpBefore; i++) step(state);
  const lost = hpBefore - e.hp;
  // 呪いの弾（4×1.2）かアーチャーの弾（12×1.2）のどちらかが先に当たる
  assert.ok(Math.abs(lost - 4.8) < 1e-9 || Math.abs(lost - 14.4) < 1e-9, `lost=${lost}`);
});

test('魔導砲は射線上の敵をまとめて貫く', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 4, 'cannon').ok, true);
  state.phase = PHASE.WAVE;
  state.wave = 1;
  state.spawnQueue = [1, 2, 3].map(() => ({ type: 'goblin', spawnTick: 1, hpMul: 1 }));
  step(state);
  // 塔の右方向に一直線に並べる（1体だけ射線から外す）
  // 出現直後の1発はすでに当たっている可能性があるので、配置後の HP を基準にする
  state.enemies[0].x = 3.5; state.enemies[0].y = 4.5;
  state.enemies[1].x = 5.5; state.enemies[1].y = 4.5;
  state.enemies[2].x = 4.5; state.enemies[2].y = 6.5;
  state.enemies.forEach((e) => { e.speed = 0; e.hp = 1000; e.maxHp = 1000; }); // 死なないようにする
  const base = state.enemies.map((e) => e.hp);
  const cannon = state.towers[0];
  cannon.cooldown = 0; // すぐ撃てる状態にする
  step(state);
  const hit = state.enemies.map((e, i) => e.hp < base[i]);
  assert.deepEqual(hit, [true, true, false]);
  assert.ok(state.effects.some((fx) => fx.kind === 'beam'));
});

test('投石台は移動中の敵の先を狙う（着弾予測）', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 3, 3, 'catapult').ok, true);
  soloWave(state, 'wolf');
  // 弾が出るまで進める
  for (let i = 0; i < TICK_RATE * 3 && state.projectiles.length === 0; i++) step(state);
  assert.equal(state.projectiles.length, 1);
  const p = state.projectiles[0];
  const target = state.enemies.find((e) => e.id === p.targetId);
  assert.ok(target);
  // 右へ進むウルフなので、狙点は現在位置より右側
  assert.ok(p.tx > target.x, `tx=${p.tx} x=${target.x}`);
});

test('雷は複数の敵に連鎖し、演出オブジェクトが残る', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 4, 'lightning').ok, true);
  state.phase = PHASE.WAVE;
  state.wave = 1;
  state.spawnQueue = [
    { type: 'goblin', spawnTick: 1, hpMul: 1 },
    { type: 'goblin', spawnTick: 1, hpMul: 1 },
    { type: 'goblin', spawnTick: 1, hpMul: 1 },
  ];
  step(state);
  state.enemies.forEach((e, i) => { e.x = 2.5 + i * 0.5; e.y = 5.5; e.speed = 0; });
  step(state);
  const damaged = state.enemies.filter((e) => e.hp < e.maxHp).length;
  assert.equal(damaged, 3);
  assert.ok(state.effects.some((fx) => fx.kind === 'chain'));
  assert.ok(state.grid[cellIndex(state.map, 2, 4)] !== 0);
});
