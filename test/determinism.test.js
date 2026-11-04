// 決定性テスト: 同じシード・同じコマンド列なら同じ結果になる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, PHASE } from '../shared/state.js';
import { placeTower, sellTower, startWave, upgradeTower } from '../shared/commands.js';
import { step } from '../shared/simulation.js';
import { STAGES } from '../shared/config.js';

// コマンド列を再生する。{ tick, cmd } を tick 順に適用しつつ step を回す
function replay(seed, stageId, script, totalTicks) {
  const state = createState({ seed, stageId });
  let si = 0;
  for (let t = 0; t <= totalTicks; t++) {
    while (si < script.length && script[si].tick === t) {
      script[si].cmd(state);
      si++;
    }
    step(state);
  }
  return state;
}

const SCRIPT = [
  { tick: 0, cmd: (s) => placeTower(s, 3, 4, 'archer') },
  { tick: 0, cmd: (s) => placeTower(s, 3, 6, 'ice') },
  { tick: 0, cmd: (s) => placeTower(s, 6, 5, 'wall') },
  { tick: 0, cmd: (s) => sellTower(s, 6, 5) },
  { tick: 1, cmd: (s) => startWave(s) },
  // 1ウェーブ目が終わっている頃に増築・強化して2ウェーブ目へ
  { tick: 30 * 40, cmd: (s) => placeTower(s, 8, 4, 'catapult') },
  { tick: 30 * 40, cmd: (s) => upgradeTower(s, 3, 4) },
  { tick: 30 * 40 + 1, cmd: (s) => startWave(s) },
];

test('同じシード・同じコマンド列なら状態が完全に一致する', () => {
  const a = replay(12345, 'meadow', SCRIPT, 30 * 80);
  const b = replay(12345, 'meadow', SCRIPT, 30 * 80);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  // 実際にゲームが進んでいること（空振りの一致ではない）
  assert.ok(a.wave >= 2);
  assert.ok(a.stats.kills > 0);
});

test('全ステージで決定性が保たれる（雷・毒・聖光・分裂・飛行を含む）', () => {
  for (const stage of STAGES) {
    const { start } = stage.map;
    const script = [
      { tick: 0, cmd: (s) => { s.money = 5000; } },
      { tick: 0, cmd: (s) => placeTower(s, start.x + 2, start.y - 1, 'lightning') },
      { tick: 0, cmd: (s) => placeTower(s, start.x + 2, start.y + 1, 'poison') },
      { tick: 0, cmd: (s) => placeTower(s, start.x + 3, start.y - 1, 'holy') },
      { tick: 0, cmd: (s) => placeTower(s, start.x + 3, start.y + 1, 'ballista') },
      { tick: 1, cmd: (s) => startWave(s) },
      { tick: 30 * 60, cmd: (s) => startWave(s) },
      { tick: 30 * 120, cmd: (s) => startWave(s) },
    ];
    const a = replay(99, stage.id, script, 30 * 150);
    const b = replay(99, stage.id, script, 30 * 150);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), stage.id);
    assert.ok(a.stats.kills > 0, `${stage.id}: 撃破が発生していない`);
  }
});

test('シードが違えば乱数系列が変わる（出現タイミング）', () => {
  const a = createState({ seed: 1 });
  const b = createState({ seed: 2 });
  startWave(a);
  startWave(b);
  const ta = a.spawnQueue.map((q) => q.spawnTick).join(',');
  const tb = b.spawnQueue.map((q) => q.spawnTick).join(',');
  assert.notEqual(ta, tb);
});

test('step は準備フェーズでは何もしない', () => {
  const state = createState({ seed: 1 });
  const snapshot = JSON.stringify(state);
  step(state);
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(state.phase, PHASE.PREPARE);
});
