// 迷路に干渉する敵・床と罠・高台と桟橋・分岐強化・シナジー・魔法・早回しのテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, PHASE, cellIndex } from '../shared/state.js';
import { placeTower, startWave, callNextWave, castSpell, upgradeTower, sellTower, canPlaceTower } from '../shared/commands.js';
import { step } from '../shared/simulation.js';
import { TOWERS, ENEMIES, SPELLS, TICK_RATE, ECONOMY, TERRAIN, CELL_EMPTY, CELL_HILL, CELL_WATER, CELL_FLOOR, getStage } from '../shared/config.js';
import { getTowerStats } from '../shared/towers.js';
import { effectiveStats, activeSynergies } from '../shared/buffs.js';
import { computePath } from '../shared/pathfinding.js';

function soloWave(state, type, hpMul = 1, extra = []) {
  state.phase = PHASE.WAVE;
  state.wave = 1;
  state.waveTick = 0;
  state.spawnQueue = [{ type, spawnTick: 1, hpMul }, ...extra, { type, spawnTick: 100000, hpMul }];
}

test('高台は建てられるが通れず、塔の射程が伸びる。売却すると高台に戻る', () => {
  const state = createState({ seed: 1 }); // 草原: (6,1) が高台
  assert.equal(state.grid[cellIndex(state.map, 6, 1)], CELL_HILL);
  assert.equal(placeTower(state, 6, 1, 'archer').ok, true);
  const t = state.towers[0];
  assert.equal(t.onHill, true);
  const eff = effectiveStats(state, t);
  assert.ok(Math.abs(eff.range - (TOWERS.archer.range + TERRAIN.hillRangeAdd)) < 1e-9);
  assert.equal(eff.terrain.hill, true);
  sellTower(state, 6, 1);
  assert.equal(state.grid[cellIndex(state.map, 6, 1)], CELL_HILL);
  // 床は高台には置けない
  assert.equal(placeTower(state, 6, 1, 'mudfloor').ok, false);
});

test('桟橋は水の上にだけ置け、そのマスを陸地にする', () => {
  const state = createState({ seed: 1, stageId: 'lake' });
  state.money = 10000;
  const r = placeTower(state, 10, 6, 'pier');
  assert.equal(r.ok, true);
  assert.equal(state.grid[cellIndex(state.map, 10, 6)], CELL_EMPTY);
  assert.equal(state.towers.length, 0);
  assert.equal(placeTower(state, 10, 6, 'archer').ok, true); // 陸地になったので建てられる
  assert.equal(placeTower(state, 2, 2, 'pier').ok, false);     // 平地には置けない
  // 水辺の氷の塔は減速が強くなる
  assert.equal(placeTower(state, 7, 5, 'ice').ok, true);       // (8,5) が水
  const ice = state.towers.find((t) => t.type === 'ice');
  const eff = effectiveStats(state, ice);
  assert.equal(eff.terrain.shore, true);
  assert.ok(eff.slow.factor < getTowerStats('ice', 1).slow.factor);
});

test('床は敵が通れ、踏んだ敵は減速する。罠はウェーブごとに1回だけ作動する', () => {
  const state = createState({ seed: 1 });
  state.money = 10000;
  // 門の右隣に泥濘の床 → 経路は変わらない
  const before = computePath(state.flow, state.map).length;
  assert.equal(placeTower(state, 1, 5, 'mudfloor').ok, true);
  assert.equal(state.grid[cellIndex(state.map, 1, 5)], CELL_FLOOR);
  assert.equal(computePath(state.flow, state.map).length, before);
  assert.equal(placeTower(state, 2, 5, 'landmine').ok, true);
  soloWave(state, 'orc', 1, [{ type: 'orc', spawnTick: 60, hpMul: 1 }]);
  step(state);
  const orc = state.enemies[0];
  for (let i = 0; i < TICK_RATE * 3 && orc.cx < 1; i++) step(state);
  assert.ok(orc.slowUntil > state.waveTick, '床で減速していない');
  for (let i = 0; i < TICK_RATE * 4 && orc.cx < 2; i++) step(state);
  assert.ok(orc.hp < orc.maxHp, '地雷のダメージが入っていない');
  const mine = state.towers.find((t) => t.type === 'landmine');
  assert.equal(mine.armed, false);
  // 2体目は地雷を踏んでもダメージを受けない
  for (let i = 0; i < TICK_RATE * 8 && state.enemies.length < 2; i++) step(state);
  const second = state.enemies.find((e) => e !== orc);
  assert.ok(second);
  for (let i = 0; i < TICK_RATE * 5 && second.cx < 3; i++) step(state);
  assert.equal(second.hp, second.maxHp);
});

test('落とし穴は最初に踏んだ敵を拘束する', () => {
  const state = createState({ seed: 1 });
  state.money = 10000;
  assert.equal(placeTower(state, 1, 5, 'pitfall').ok, true);
  soloWave(state, 'goblin');
  step(state);
  const g = state.enemies[0];
  for (let i = 0; i < TICK_RATE * 3 && g.cx < 1; i++) step(state);
  assert.ok(g.stunUntil > state.waveTick);
  const x = g.x;
  step(state);
  assert.equal(g.x, x);
});

test('破城槌オーガは近くの石壁を壊し、鉄壁は壊せない。壊れた壁は修復魔法で戻る', () => {
  const state = createState({ seed: 1 });
  state.money = 10000;
  assert.equal(placeTower(state, 1, 4, 'wall').ok, true);
  assert.equal(placeTower(state, 1, 6, 'ironwall').ok, true);
  assert.equal(placeTower(state, 2, 2, 'manaforge').ok, true);
  state.mana = 5;
  soloWave(state, 'ogre_ram');
  step(state);
  const ogre = state.enemies[0];
  ogre.speed = 0;
  for (let i = 0; i < TICK_RATE * 6 && state.towers.some((t) => t.type === 'wall'); i++) step(state);
  assert.equal(state.towers.some((t) => t.type === 'wall'), false, '石壁が壊されていない');
  assert.equal(state.towers.some((t) => t.type === 'ironwall'), true, '鉄壁が壊された');
  assert.equal(state.destroyed.length, 1);
  assert.equal(state.stats.wallsBroken, 1);
  // 修復
  const r = castSpell(state, 'repair');
  assert.equal(r.ok, true);
  assert.equal(r.restored, 1);
  assert.equal(state.towers.some((t) => t.type === 'wall'), true);
  assert.equal(state.mana, 5 - SPELLS.repair.cost);
});

test('盗賊は到達するとライフではなくお金を奪う', () => {
  const state = createState({ seed: 1 });
  state.money = 100;
  soloWave(state, 'thief');
  step(state);
  const thief = state.enemies[0];
  const lives = state.lives;
  thief.reached = true;
  step(state);
  assert.equal(state.lives, lives);
  assert.equal(state.money, 100 - ENEMIES.thief.stealGold);
  assert.equal(state.stats.stolen, ENEMIES.thief.stealGold);
});

test('ネクロマンサーは近くで倒れたアンデッドを最大回数まで蘇生する', () => {
  const state = createState({ seed: 1 });
  soloWave(state, 'necromancer', 1, [
    { type: 'skeleton', spawnTick: 1, hpMul: 1 },
    { type: 'skeleton', spawnTick: 1, hpMul: 1 },
  ]);
  step(state);
  const necro = state.enemies.find((e) => e.type === 'necromancer');
  assert.ok(necro);
  for (let round = 0; round < ENEMIES.necromancer.revive.max + 1; round++) {
    const sk = state.enemies.find((e) => e.type === 'skeleton');
    assert.ok(sk, `round ${round}: 骸骨がいない`);
    sk.hp = 0;
    step(state);
  }
  assert.equal(necro.revives, ENEMIES.necromancer.revive.max);
  // 上限に達した後に倒された骸骨は蘇生されない（残りは最初の2体 − 倒した分 + 蘇生分）
  const skeletons = state.enemies.filter((e) => e.type === 'skeleton').length;
  assert.equal(skeletons, 2 - (ENEMIES.necromancer.revive.max + 1) + ENEMIES.necromancer.revive.max);
});

test('魔王は一定時間ごとにコウモリを召喚する', () => {
  const state = createState({ seed: 1, stageId: 'castle' });
  soloWave(state, 'demon_lord');
  step(state);
  const boss = state.enemies[0];
  boss.speed = 0;
  for (let i = 0; i < TICK_RATE * (ENEMIES.demon_lord.summon.every + 1); i++) step(state);
  assert.equal(state.enemies.filter((e) => e.type === 'bat').length, ENEMIES.demon_lord.summon.count);
});

test('Lv3 の分岐で性能が変わり、隣接シナジーが発動する', () => {
  const a = getTowerStats('archer', 3, 'a');
  const b = getTowerStats('archer', 3, 'b');
  const plain = getTowerStats('archer', 3);
  assert.ok(a.cooldown < plain.cooldown);
  assert.ok(b.range > plain.range && b.pierceArmor);
  assert.equal(a.branchName, TOWERS.archer.branches.a.name);

  const state = createState({ seed: 1 });
  state.money = 10000;
  assert.equal(placeTower(state, 4, 2, 'catapult').ok, true);
  assert.equal(placeTower(state, 5, 3, 'ice').ok, true); // 斜め隣
  const cat = state.towers[0];
  assert.equal(activeSynergies(state, cat).length, 1);
  const eff = effectiveStats(state, cat);
  assert.ok(Math.abs(eff.splashRadius - TOWERS.catapult.splashRadius * 1.5) < 1e-9);
  assert.deepEqual(eff.synergies, ['蒸気爆発']);
});

test('竜の巣は1ステージに1基まで', () => {
  const state = createState({ seed: 1 });
  state.money = 10000;
  assert.equal(placeTower(state, 3, 3, 'dragonnest').ok, true);
  const r = canPlaceTower(state, 5, 3, 'dragonnest');
  assert.equal(r.ok, false);
  assert.match(r.reason, /1基/);
});

test('魔力炉で魔力が貯まり、メテオと全体凍結が効く', () => {
  const state = createState({ seed: 1 });
  state.money = 10000;
  assert.equal(placeTower(state, 2, 2, 'manaforge').ok, true);
  assert.equal(castSpell(state, 'meteor', 5, 5).ok, false); // 魔力なし
  state.phase = PHASE.WAVE; state.wave = 1; state.spawnQueue = []; state.enemies = [];
  step(state); // ウェーブ終了 → 魔力+3
  assert.equal(state.mana, TOWERS.manaforge.manaPerWave);
  assert.equal(castSpell(state, 'meteor', 5, 5).ok, false); // 準備中は撃てない
  soloWave(state, 'troll');
  step(state);
  const orc = state.enemies[0];
  orc.x = 5; orc.y = 5; orc.speed = 0; orc.regen = 0;
  assert.equal(castSpell(state, 'meteor', 5, 5).ok, true);
  step(state);
  assert.ok(orc.hp < orc.maxHp - 100 && orc.hp > 0);
  assert.equal(state.mana, TOWERS.manaforge.manaPerWave - SPELLS.meteor.cost);
  state.mana = 5;
  assert.equal(castSpell(state, 'freeze').ok, true);
  step(state);
  assert.ok(orc.slowUntil > state.waveTick);
});

test('早回しコールで次のウェーブが前倒しされ、残り敵数ぶんボーナスが入る', () => {
  const state = createState({ seed: 1 });
  state.money = 10000;
  state.lives = 1000; // 塔を建てないので、ライフ切れで終わらないようにする
  assert.equal(callNextWave(state).ok, false); // 準備中は不可
  assert.equal(startWave(state).ok, true);
  assert.equal(callNextWave(state).ok, false); // まだ出きっていない
  for (let i = 0; i < TICK_RATE * 20 && state.spawnQueue.length > 0; i++) step(state);
  const remaining = state.enemies.length;
  assert.ok(remaining > 0);
  const money = state.money;
  const r = callNextWave(state);
  assert.equal(r.ok, true);
  assert.equal(r.wave, 2);
  assert.equal(state.money - money, remaining * ECONOMY.earlyCallGold);
  assert.ok(state.spawnQueue.length > 0);
  assert.equal(state.stats.earlyCalls, 1);
  // 最後まで回すと準備フェーズへ戻り、ウェーブ数は 2
  for (let i = 0; i < TICK_RATE * 120 && state.phase === PHASE.WAVE; i++) step(state);
  assert.equal(state.phase, PHASE.PREPARE);
  assert.equal(state.wave, 2);
});

test('全ステージの新ウェーブが整合し、到達可能', () => {
  for (const stage of getStage.length ? [] : []) void stage;
  for (const id of ['meadow', 'canyon', 'lake', 'castle']) {
    const s = createState({ seed: 1, stageId: id });
    assert.ok(computePath(s.flow, s.map).length > 0, id);
    for (const w of getStage(id).waves) for (const g of w.groups) assert.ok(ENEMIES[g.type], `${id}: ${g.type}`);
  }
});
