// 60種の建築と新メカニクス（気絶・押し戻し・クリティカル・即死・威力上昇・多重射撃・支援・経済）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, PHASE } from '../shared/state.js';
import { placeTower, startWave, sellTower, upgradeTower, currentUpgradeCost } from '../shared/commands.js';
import { step } from '../shared/simulation.js';
import { TOWERS, GENRES, TICK_RATE, ECONOMY, UPGRADE, towersByGenre } from '../shared/config.js';
import { getTowerStats, upgradeCost } from '../shared/towers.js';
import { computeBuffFor, effectiveStats, economyModifiers } from '../shared/buffs.js';

test('5ジャンルそれぞれに12種以上あり、全建築の定義が整合している', () => {
  assert.equal(GENRES.length, 5);
  let total = 0;
  for (const g of GENRES) {
    const list = towersByGenre(g.id);
    assert.ok(list.length >= 12, `${g.name} が ${list.length} 種しかない`);
    total += list.length;
  }
  assert.equal(total, Object.keys(TOWERS).length);
  const names = new Set();
  for (const [id, def] of Object.entries(TOWERS)) {
    assert.ok(GENRES.some((g) => g.id === def.genre), `${id}: genre 不正`);
    assert.ok(def.name && def.short && def.desc, `${id}: 名前/略称/説明が無い`);
    assert.ok(!names.has(def.name), `${id}: 名前 ${def.name} が重複`);
    names.add(def.name);
    assert.ok(def.cost > 0, `${id}: cost`);
    if (def.attack !== 'none') {
      assert.ok(def.range > 0 && def.cooldown > 0 && def.damage !== undefined, `${id}: 攻撃パラメータ不足`);
      assert.ok(['physical', 'magic'].includes(def.damageType), `${id}: damageType`);
      if (['homing', 'splash'].includes(def.attack)) assert.ok(def.projectileSpeed > 0, `${id}: projectileSpeed`);
      if (def.attack === 'chain') assert.ok(def.chain, `${id}: chain`);
      if (def.attack === 'line') assert.ok(def.lineWidth > 0, `${id}: lineWidth`);
      if (def.attack === 'splash') assert.ok(def.splashRadius > 0, `${id}: splashRadius`);
    }
    // レベル1〜3のステータスが計算できる
    for (let lv = 1; lv <= UPGRADE.maxLevel; lv++) getTowerStats(id, lv);
  }
});

// 指定の敵1体だけを出現させるヘルパー
function soloWave(state, type, hpMul = 1) {
  state.phase = PHASE.WAVE;
  state.wave = 1;
  state.waveTick = 0;
  state.spawnQueue = [{ type, spawnTick: 1, hpMul }, { type, spawnTick: 100000, hpMul }];
}

// 塔1本と敵1体を向かい合わせ、最初の命中までの HP 減少を返す
function firstHit(towerType, enemyType, prep = null) {
  const state = createState({ seed: 5 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 4, towerType).ok, true);
  if (prep) prep(state);
  soloWave(state, enemyType);
  step(state);
  const e = state.enemies[0];
  // 即時攻撃（連鎖・貫通）が出現直後に倒してしまった場合は「大ダメージ」として扱う
  if (!e) return { lost: Infinity, e: { slowUntil: 0, curseUntil: 0 }, state };
  e.x = 2.5; e.y = 5.5; e.speed = 0;
  const before = e.hp;
  // 攻撃間隔が長い砲台（最長4秒）＋弾の飛行時間を見込んで最大8秒待つ
  for (let i = 0; i < TICK_RATE * 8 && e.hp === before; i++) step(state);
  return { lost: before - e.hp, e, state };
}

test('全攻撃建築が実際に敵へダメージを与えられる（オーラ/追尾/範囲/連鎖/貫通）', () => {
  for (const [id, def] of Object.entries(TOWERS)) {
    if (def.attack === 'none') continue;
    const enemy = def.groundOnly ? 'orc' : 'bat';
    const { lost, e } = firstHit(id, enemy);
    const expectDamage = (def.damage || 0) > 0 || def.poison;
    if (expectDamage) assert.ok(lost > 0, `${id}: ダメージが入らない`);
    else assert.ok(e.slowUntil > 0 || e.curseUntil > 0, `${id}: 効果が付与されない`);
  }
});

test('気絶した敵は動かず、押し戻された敵はゴールから遠ざかる', () => {
  // 気絶: 網投げ台（50%）。シードを変えて必ず一度は成立させる
  let stunned = false;
  for (let seed = 1; seed <= 10 && !stunned; seed++) {
    const state = createState({ seed });
    state.money = 100000;
    assert.equal(placeTower(state, 2, 4, 'netter').ok, true);
    soloWave(state, 'goblin');
    step(state);
    const e = state.enemies[0];
    for (let i = 0; i < TICK_RATE * 2 && e.stunUntil === 0; i++) step(state);
    if (e.stunUntil > state.waveTick) {
      stunned = true;
      const x = e.x;
      step(state);
      assert.equal(e.x, x, '気絶中に動いた');
    }
  }
  assert.ok(stunned, '10シード試して一度も気絶しなかった');

  // 押し戻し: 幻惑の鏡（100%）。命中後は現在マスがスタート側に戻る
  const state = createState({ seed: 3 });
  state.money = 100000;
  assert.equal(placeTower(state, 6, 4, 'mirror').ok, true);
  soloWave(state, 'goblin');
  step(state);
  const e = state.enemies[0];
  let maxX = 0;
  let pushed = false;
  for (let i = 0; i < TICK_RATE * 6; i++) {
    step(state);
    if (e.cx < maxX - 1) { pushed = true; break; }
    maxX = Math.max(maxX, e.cx);
  }
  assert.ok(pushed, '押し戻しが起きなかった');
});

test('クリティカルは2倍ダメージをシード乱数で決め、即死は低HPの敵を倒す', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const state = createState({ seed });
    state.money = 100000;
    assert.equal(placeTower(state, 2, 4, 'crossbow').ok, true);
    soloWave(state, 'orc');
    step(state);
    const e = state.enemies[0];
    e.x = 2.5; e.y = 5.5; e.speed = 0;
    const before = e.hp;
    for (let i = 0; i < TICK_RATE * 3 && e.hp === before; i++) step(state);
    seen.add(before - e.hp);
  }
  assert.ok(seen.has(TOWERS.crossbow.damage), '通常ダメージが出ない');
  assert.ok(seen.has(TOWERS.crossbow.damage * 2), 'クリティカルが出ない');

  const { e } = firstHit('guillotine', 'orc', null);
  // 処刑台は60ダメージ。オーク130なので即死ラインに届かないはず → 次に HP を下げて即死を確認
  assert.ok(e.hp > 0);
  e.hp = Math.floor(e.maxHp * 0.2);
  const state = createState({ seed: 5 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 4, 'guillotine').ok, true);
  soloWave(state, 'troll');
  step(state);
  const troll = state.enemies[0];
  troll.x = 2.5; troll.y = 5.5; troll.speed = 0;
  troll.hp = Math.floor(troll.maxHp * 0.2);
  for (let i = 0; i < TICK_RATE * 3 && state.enemies.length > 0; i++) step(state);
  assert.equal(state.enemies.length, 0, '即死しなかった');
});

test('月光の弓は同じ敵を撃つほど威力が上がり、散弾の櫓は複数の敵を同時に撃つ', () => {
  const state = createState({ seed: 5 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 4, 'moonbow').ok, true);
  soloWave(state, 'troll');
  step(state);
  const e = state.enemies[0];
  e.x = 2.5; e.y = 5.5; e.speed = 0; e.regen = 0;
  const hits = [];
  let last = e.hp;
  for (let i = 0; i < TICK_RATE * 6 && hits.length < 4; i++) {
    step(state);
    if (e.hp < last) { hits.push(last - e.hp); last = e.hp; }
  }
  assert.ok(hits.length >= 3);
  assert.ok(hits[2] > hits[0], `威力が上がっていない ${hits}`);

  const s2 = createState({ seed: 5 });
  s2.money = 100000;
  assert.equal(placeTower(s2, 2, 4, 'scatter').ok, true);
  s2.phase = PHASE.WAVE; s2.wave = 1; s2.waveTick = 0;
  s2.spawnQueue = [1, 2, 3, 4].map(() => ({ type: 'goblin', spawnTick: 1, hpMul: 1 }));
  step(s2);
  s2.enemies.forEach((g, i) => { g.x = 2.5 + i * 0.3; g.y = 5.5; g.speed = 0; });
  step(s2);
  assert.equal(s2.projectiles.length, TOWERS.scatter.multishot);
  assert.equal(new Set(s2.projectiles.map((p) => p.targetId)).size, TOWERS.scatter.multishot);
});

test('支援建築は範囲内の塔を強化し、同じ効果は重複せず最大が有効', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 5, 5, 'archer').ok, true);
  const archer = state.towers[0];
  assert.equal(computeBuffFor(state, archer).sources, 0);
  assert.equal(placeTower(state, 6, 5, 'banner').ok, true);   // +10%
  assert.equal(placeTower(state, 4, 5, 'smithy').ok, true);   // +20%
  assert.equal(placeTower(state, 5, 4, 'watchtower').ok, true); // 射程+0.5
  assert.equal(placeTower(state, 5, 7, 'manawell').ok, true); // 魔法専用 → 弓には効かない（距離2.0ちょうど）
  const b = computeBuffFor(state, archer);
  assert.equal(b.damageMul, getTowerStats('smithy', 1).buff.damageMul);
  assert.equal(b.rangeAdd, getTowerStats('watchtower', 1).buff.rangeAdd);
  const eff = effectiveStats(state, archer);
  assert.equal(eff.damage, Math.round(TOWERS.archer.damage * b.damageMul));
  assert.ok(Math.abs(eff.range - (TOWERS.archer.range + 0.5)) < 1e-9);
  // 支援建築を強化すると上乗せが伸びる
  const smithy = state.towers.find((t) => t.type === 'smithy');
  smithy.level = 3;
  assert.ok(computeBuffFor(state, archer).damageMul > b.damageMul);
  // 遠くの塔には効かない
  assert.equal(placeTower(state, 15, 5, 'archer').ok, true);
  assert.equal(computeBuffFor(state, state.towers[state.towers.length - 1]).sources, 0);
});

test('賢者の塔は状態異常の持続時間を伸ばす', () => {
  const plain = firstHit('ice', 'orc');
  const buffed = firstHit('ice', 'orc', (s) => placeTower(s, 3, 4, 'sage'));
  const dPlain = plain.e.slowUntil - plain.state.waveTick;
  const dBuffed = buffed.e.slowUntil - buffed.state.waveTick;
  assert.ok(dBuffed > dPlain * 1.3, `${dPlain} → ${dBuffed}`);
});

// 敵のいないウェーブを即終了させ、ウェーブ終了処理だけを走らせる
function endWave(state) {
  state.phase = PHASE.WAVE;
  state.wave += 1;
  state.spawnQueue = [];
  state.enemies = [];
  step(state);
}

test('経済建築: 市場の利息・宝物庫の倍率・錬金炉・苗木の成長収入・泉のライフ回復', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 2, 'market').ok, true);
  assert.equal(placeTower(state, 3, 2, 'treasury').ok, true);
  assert.equal(placeTower(state, 4, 2, 'alchemy').ok, true);
  assert.equal(placeTower(state, 5, 2, 'seedling').ok, true);
  assert.equal(placeTower(state, 6, 2, 'fountain').ok, true);
  state.lives = 10;
  state.money = 1000;
  endWave(state); // wave 1 終了
  const bonus = Math.round((ECONOMY.waveClearBonusBase + ECONOMY.waveClearBonusPerWave * 1) * TOWERS.treasury.bonusMul);
  const interest = Math.min(TOWERS.market.interest.cap, Math.floor(1000 * TOWERS.market.interest.rate));
  const alchemy = Math.min(TOWERS.alchemy.perTowerGold.cap, TOWERS.alchemy.perTowerGold.gold * 5);
  const seed = TOWERS.seedling.income; // 建てた直後なので成長分は 0
  assert.equal(state.money, 1000 + bonus + interest + alchemy + seed);
  assert.equal(state.lives, 11);
  // 2ウェーブ後は苗木が育つ
  const m = state.money;
  state.money = 0;
  endWave(state);
  endWave(state); // wave 3 終了: 成長 = growth × (3 - 0 - 1) = 2回分
  assert.ok(state.money >= TOWERS.seedling.income * 2 + TOWERS.seedling.incomeGrowth * (1 + 2));
  void m;
});

test('商人の宿で売却率が上がり、練兵場で強化が割引になり、賞金首で撃破金が増える', () => {
  const state = createState({ seed: 1 });
  state.money = 100000;
  assert.equal(placeTower(state, 2, 2, 'archer').ok, true);
  assert.equal(placeTower(state, 3, 2, 'inn').ok, true);
  assert.equal(economyModifiers(state).sellRate, TOWERS.inn.sellRate);
  const r = sellTower(state, 2, 2);
  assert.equal(r.refund, Math.floor(TOWERS.archer.cost * TOWERS.inn.sellRate));
  // 宿自身を売るときは自分の効果は乗らない
  const r2 = sellTower(state, 3, 2);
  assert.equal(r2.refund, Math.floor(TOWERS.inn.cost * ECONOMY.sellRefundRate));

  assert.equal(placeTower(state, 2, 2, 'archer').ok, true);
  const archer = state.towers[0];
  assert.equal(currentUpgradeCost(state, archer), upgradeCost('archer', 1));
  assert.equal(placeTower(state, 4, 2, 'barracks').ok, true);
  assert.equal(currentUpgradeCost(state, archer), Math.round(upgradeCost('archer', 1) * TOWERS.barracks.upgradeDiscount));
  const money = state.money;
  assert.equal(upgradeTower(state, 2, 2).ok, true);
  assert.equal(money - state.money, Math.round(upgradeCost('archer', 1) * TOWERS.barracks.upgradeDiscount));

  // 賞金首: 掲示板の近くで倒すと +gold
  const s2 = createState({ seed: 1 });
  s2.money = 100000;
  assert.equal(placeTower(s2, 2, 4, 'bounty').ok, true);
  soloWave(s2, 'goblin');
  step(s2);
  const e = s2.enemies[0];
  e.hp = 0;
  const before = s2.money;
  step(s2);
  assert.equal(s2.money - before, e.reward + TOWERS.bounty.bounty.gold);
});

test('偵察気球があると先読みウェーブ数が増える', () => {
  const state = createState({ seed: 1 });
  assert.equal(economyModifiers(state).previewWaves, 0);
  state.money = 1000;
  assert.equal(placeTower(state, 2, 2, 'balloon').ok, true);
  assert.equal(economyModifiers(state).previewWaves, TOWERS.balloon.previewWaves);
});

test('60種をランダムに並べても決定性が保たれる', () => {
  function run() {
    const state = createState({ seed: 777, stageId: 'castle' });
    state.money = 100000;
    const types = Object.keys(TOWERS);
    let k = 0;
    for (let y = 0; y < state.map.rows; y += 2) {
      for (let x = 1; x < 12; x += 2) {
        placeTower(state, x, y, types[k++ % types.length]);
      }
    }
    startWave(state);
    for (let i = 0; i < TICK_RATE * 60; i++) step(state);
    return JSON.stringify(state);
  }
  const a = run();
  const b = run();
  assert.equal(a, b);
  assert.ok(JSON.parse(a).stats.kills > 0);
});
