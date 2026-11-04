// エントリーポイント: ゲームループ（requestAnimationFrame + 固定タイムステップ）と UI 配線
// ロジックは shared/ に閉じているので、ここでは state を読み、コマンドと step() だけを呼ぶ
import { DT, TOWERS, STAGES, ENEMIES, getStage } from '/shared/config.js';
import { createState, PHASE } from '/shared/state.js';
import { startWave, upgradeTower, sellTower } from '/shared/commands.js';
import { step } from '/shared/simulation.js';
import { getTowerStats, upgradeCost } from '/shared/towers.js';
import { render, layout, TOWER_COLORS, drawMiniMap } from './renderer.js';
import { bindInput, refreshHover } from './input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ゲーム本体（state は差し替えるのでオブジェクトに包む）
const game = { state: createState({ seed: 1, stageId: STAGES[0].id }), running: false };

// 画面側だけの状態（ロジックには含めない）
const ui = {
  tool: 'wall',     // 選択中のツール: タワー種別 or 'sell' or null
  hover: null,      // ホバー中のマス
  hoverOk: false,   // ホバー中マスに設置できるか
  selected: null,   // 選択中の建物のマス
  messageTimer: 0,
  speed: 1,
};

// シードは画面側で決める（ロジック側は Date.now を使わない）
function newSeed() {
  return (Date.now() ^ (Math.floor(Math.random() * 0xffff) << 16)) >>> 0;
}

// ---- 進行状況（クリア記録）は localStorage に保存。UI だけの関心事 ----
const PROGRESS_KEY = 'maze-td-progress';
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || { cleared: {} }; }
  catch { return { cleared: {} }; }
}
function saveProgress(p) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
}
const unlockAll = new URLSearchParams(location.search).has('all');
function isUnlocked(index, progress) {
  if (unlockAll || index === 0) return true;
  return !!progress.cleared[STAGES[index - 1].id];
}

// ---- DOM 要素 ----
const $ = (id) => document.getElementById(id);
const el = {
  stageName: $('stageName'),
  money: $('money'), lives: $('lives'), wave: $('wave'), waveTotal: $('waveTotal'), phase: $('phase'),
  towerButtons: $('towerButtons'), toolDesc: $('toolDesc'), sellBtn: $('sellBtn'),
  towerInfo: $('towerInfo'), tiName: $('tiName'), tiLevel: $('tiLevel'), tiStats: $('tiStats'),
  upgradeBtn: $('upgradeBtn'), sellSelectedBtn: $('sellSelectedBtn'),
  nextWave: $('nextWave'), startWaveBtn: $('startWaveBtn'), speedSeg: $('speedSeg'),
  message: $('message'), backBtn: $('backBtn'),
  stageSelect: $('stageSelect'), stageCards: $('stageCards'),
  overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayBody: $('overlayBody'),
  restartBtn: $('restartBtn'), nextStageBtn: $('nextStageBtn'), toSelectBtn: $('toSelectBtn'),
  retryWaveBtn: $('retryWaveBtn'),
};

// ウェーブ開始直前の状態スナップショット（JSON）。ゲームオーバー時に「このウェーブから」やり直せる
let checkpoint = null;

// ---- タワー選択ボタンを config から生成 ----
const towerButtons = {};
Object.entries(TOWERS).forEach(([type, def], index) => {
  const btn = document.createElement('button');
  btn.className = 'tool';
  btn.title = def.desc;
  const key = index < 9 ? `<span class="key">${index + 1}</span>` : '';
  btn.innerHTML = key +
    `<span class="swatch" style="background:${TOWER_COLORS[type].main}">${def.short}</span>` +
    `<span class="label">${def.name}</span>` +
    `<span class="cost">${def.cost}</span>`;
  btn.addEventListener('click', () => selectTool(type));
  el.towerButtons.appendChild(btn);
  towerButtons[type] = btn;
});
el.sellBtn.addEventListener('click', () => selectTool(ui.tool === 'sell' ? null : 'sell'));

function selectTool(tool) {
  ui.tool = tool;
  for (const [type, btn] of Object.entries(towerButtons)) btn.classList.toggle('active', tool === type);
  el.sellBtn.classList.toggle('active', tool === 'sell');
  el.toolDesc.textContent = tool && TOWERS[tool] ? describeTool(tool) : (tool === 'sell' ? '建物をクリックして売却' : '');
}

// ツール説明（レベル1のステータス）
function describeTool(type) {
  const s = getTowerStats(type, 1);
  const parts = [TOWERS[type].desc];
  if (s.damage) parts.push(`攻撃 ${s.damage} / 射程 ${s.range.toFixed(1)} / 間隔 ${s.cooldown.toFixed(1)}秒`);
  if (s.income) parts.push(`収入 ${s.income} / ウェーブ`);
  return parts.join('\n');
}

// ---- ステージ選択 ----
function showStageSelect() {
  game.running = false;
  el.overlay.classList.add('hidden');
  el.stageCards.innerHTML = '';
  const progress = loadProgress();
  STAGES.forEach((stage, i) => {
    const card = document.createElement('div');
    const unlocked = isUnlocked(i, progress);
    card.className = 'stage-card' + (unlocked ? '' : ' locked');
    const rec = progress.cleared[stage.id];
    card.innerHTML =
      `<canvas></canvas>` +
      `<h3>${i + 1}. ${stage.name}<small>${stage.map.cols}×${stage.map.rows} / ${stage.waves.length}ウェーブ</small></h3>` +
      `<p class="desc">${stage.desc}</p>` +
      `<div class="meta">` +
      `<span>初期資金 ${stage.initialMoney}</span><span>ライフ ${stage.initialLives}</span>` +
      (rec ? `<span class="badge">クリア済（残ライフ ${rec.lives}）</span>` : '') +
      (unlocked ? '' : `<span class="lock">前のステージをクリアで解放</span>`) +
      `</div>`;
    drawMiniMap(card.querySelector('canvas'), stage);
    if (unlocked) card.addEventListener('click', () => startStage(stage.id));
    el.stageCards.appendChild(card);
  });
  el.stageSelect.classList.remove('hidden');
}

// ---- ステージ開始 ----
let shownEnd = false;
function startStage(stageId) {
  const stage = getStage(stageId);
  game.state = createState({ seed: newSeed(), stageId });
  // マスの大きさは画面に収まるように決める
  layout.cell = Math.max(24, Math.min(40, Math.floor(920 / stage.map.cols), Math.floor(620 / stage.map.rows)));
  canvas.width = stage.map.cols * layout.cell;
  canvas.height = stage.map.rows * layout.cell;
  ui.selected = null;
  ui.hover = null;
  shownEnd = false;
  checkpoint = null;
  el.stageName.textContent = `${stage.name}`;
  el.waveTotal.textContent = stage.waves.length;
  el.stageSelect.classList.add('hidden');
  el.overlay.classList.add('hidden');
  selectTool('wall');
  showMessage({ ok: true, text: `${stage.name} — 門と城の間に迷路を築こう` });
  game.running = true;
}

// ---- ボタン類 ----
el.startWaveBtn.addEventListener('click', () => {
  // 開始前の状態を保存しておき、負けたらここからやり直せるようにする
  const snapshot = JSON.stringify(game.state);
  const r = startWave(game.state);
  if (r.ok) checkpoint = snapshot;
  showMessage(r.ok ? { ok: true, text: `ウェーブ ${r.wave} 開始！` } : r);
});
el.retryWaveBtn.addEventListener('click', () => {
  if (!checkpoint) return;
  game.state = JSON.parse(checkpoint);
  ui.selected = null;
  shownEnd = false;
  el.overlay.classList.add('hidden');
  showMessage({ ok: true, text: `ウェーブ ${game.state.wave + 1} の準備からやり直し` });
});
// ウェーブ中の「ステージ選択へ戻る」は2回押しで確定（誤操作防止）
let backArmedUntil = 0;
el.backBtn.addEventListener('click', () => {
  const inWave = game.state.phase === PHASE.WAVE;
  if (inWave && performance.now() > backArmedUntil) {
    backArmedUntil = performance.now() + 3000;
    el.backBtn.textContent = '本当に戻る？（もう一度押す）';
    setTimeout(() => { el.backBtn.textContent = 'ステージ選択へ戻る'; }, 3000);
    return;
  }
  el.backBtn.textContent = 'ステージ選択へ戻る';
  showStageSelect();
});
el.speedSeg.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    ui.speed = Number(b.dataset.speed);
    el.speedSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  });
});
el.upgradeBtn.addEventListener('click', () => {
  if (!ui.selected) return;
  const r = upgradeTower(game.state, ui.selected.x, ui.selected.y);
  showMessage(r.ok ? { ok: true, text: `強化しました（Lv${r.level}）` } : r);
});
el.sellSelectedBtn.addEventListener('click', () => {
  if (!ui.selected) return;
  const r = sellTower(game.state, ui.selected.x, ui.selected.y);
  if (r.ok) { r.text = `売却しました（+${r.refund}）`; ui.selected = null; }
  showMessage(r);
});
el.toSelectBtn.addEventListener('click', showStageSelect);
el.restartBtn.addEventListener('click', () => startStage(game.state.stageId));
el.nextStageBtn.addEventListener('click', () => {
  const i = STAGES.findIndex((s) => s.id === game.state.stageId);
  if (i >= 0 && i + 1 < STAGES.length) startStage(STAGES[i + 1].id);
  else showStageSelect();
});

// キーボードショートカット（1〜9: タワー, S: 売却, Space: ウェーブ開始, U: 強化）
window.addEventListener('keydown', (ev) => {
  if (!game.running || ev.target.tagName === 'INPUT') return;
  const types = Object.keys(TOWERS);
  if (ev.key >= '1' && ev.key <= '9' && Number(ev.key) <= types.length) selectTool(types[Number(ev.key) - 1]);
  else if (ev.key === 's' || ev.key === 'S') selectTool('sell');
  else if (ev.key === 'u' || ev.key === 'U') el.upgradeBtn.click();
  else if (ev.key === ' ') { ev.preventDefault(); el.startWaveBtn.click(); }
  else if (ev.key === 'Escape') { selectTool(null); ui.selected = null; }
});

// ---- メッセージ表示 ----
function showMessage(result) {
  if (!result) {
    el.message.textContent = '';
    el.message.className = 'message';
    return;
  }
  el.message.textContent = result.ok ? result.text : result.reason;
  el.message.className = 'message ' + (result.ok ? 'ok' : 'error');
  ui.messageTimer = 3.0; // 秒
}

bindInput(canvas, game, ui, showMessage);

// ---- HUD 更新 ----
let lastInfoKey = '';
let lastNextWaveKey = '';
function updateHud() {
  const s = game.state;
  const stage = getStage(s.stageId);
  el.money.textContent = s.money;
  el.lives.textContent = s.lives;
  el.wave.textContent = s.wave;
  const isWave = s.phase === PHASE.WAVE;
  const prepare = s.phase === PHASE.PREPARE;
  el.phase.textContent =
    prepare ? '準備中' :
    isWave ? `ウェーブ進行中（敵 ${s.enemies.length + s.spawnQueue.length}）` :
    s.phase === PHASE.CLEAR ? 'クリア！' : 'ゲームオーバー';
  el.phase.classList.toggle('wave', isWave);
  el.startWaveBtn.disabled = !prepare;
  el.startWaveBtn.textContent = prepare ? `ウェーブ ${s.wave + 1} を開始` : 'ウェーブ開始';
  for (const [type, btn] of Object.entries(towerButtons)) {
    btn.disabled = !prepare || s.money < TOWERS[type].cost;
  }
  el.sellBtn.disabled = !prepare;

  // 次のウェーブの構成
  const nextKey = `${s.stageId}:${s.wave}:${s.phase}`;
  if (nextKey !== lastNextWaveKey) {
    lastNextWaveKey = nextKey;
    const def = stage.waves[s.wave];
    if (prepare && def) {
      const counts = {};
      for (const g of def.groups) counts[g.type] = (counts[g.type] || 0) + g.count;
      const parts = Object.entries(counts).map(([t, n]) => {
        const e = ENEMIES[t];
        const tags = [];
        if (e.flying) tags.push('飛');
        if (e.armor) tags.push('鎧');
        if (e.regen) tags.push('再生');
        if (e.undead) tags.push('不死');
        const label = `${e.name}×${n}${tags.length ? `(${tags.join('・')})` : ''}`;
        // ツールチップに数値を出す（HP はこのウェーブの倍率込み）
        const tip = [
          `HP ${Math.round(e.hp * def.hpMul)}`, `速度 ${e.speed}`,
          e.armor ? `鎧 ${e.armor}（物理-${e.armor}）` : null,
          e.regen ? `再生 ${e.regen}/秒` : null,
          e.flying ? '飛行: 迷路を無視して直進' : null,
          e.undead ? 'アンデッド: 聖光に弱い' : null,
          e.splitInto ? `倒すと${ENEMIES[e.splitInto.type].name}×${e.splitInto.count}に分裂` : null,
          e.slowResist ? `スロウ耐性 ${Math.round(e.slowResist * 100)}%` : null,
          `到達でライフ-${e.livesCost ?? 1}`, `報酬 ${e.reward}〜`,
        ].filter(Boolean).join(' / ');
        return `<span class="enemy${e.boss ? ' boss' : ''}" title="${tip}">${label}</span>`;
      });
      el.nextWave.innerHTML = `次のウェーブ: <b>${parts.join('、')}</b>　HP倍率 ×${def.hpMul}`;
    } else {
      el.nextWave.textContent = '';
    }
  }

  // 選択中の建物パネル
  const t = ui.selected ? s.towers.find((tw) => tw.x === ui.selected.x && tw.y === ui.selected.y) : null;
  if (!t) {
    if (ui.selected) ui.selected = null;
    el.towerInfo.classList.add('hidden');
    lastInfoKey = '';
  } else {
    const key = `${t.id}:${t.level}:${s.money}:${s.phase}`;
    if (key !== lastInfoKey) {
      lastInfoKey = key;
      const st = getTowerStats(t.type, t.level);
      const cost = upgradeCost(t.type, t.level);
      el.tiName.textContent = st.name;
      el.tiLevel.textContent = `Lv${t.level}`;
      const lines = [];
      if (st.damage) lines.push(`攻撃 ${st.damage}（${st.damageType === 'magic' ? '魔法' : '物理'}）/ 射程 ${st.range.toFixed(1)} / 間隔 ${st.cooldown.toFixed(2)}秒`);
      if (st.slow) lines.push(`減速 ×${st.slow.factor.toFixed(1)}（${st.slow.duration}秒）`);
      if (st.poison) lines.push(`毒 ${st.poison.dps}/秒（${st.poison.duration}秒）`);
      if (st.chain) lines.push(`連鎖 ${st.chain.jumps}回`);
      if (st.curse) lines.push(`呪い 鎧-${st.curse.armorReduce} / 被ダメ×${st.curse.damageTakenMul}（${st.curse.duration}秒）`);
      if (st.income) lines.push(`収入 ${st.income} / ウェーブ`);
      if (t.type === 'wall') lines.push('攻撃しない');
      lines.push(`投資額 ${t.invested} → 売却 ${Math.floor(t.invested * 0.5)}`);
      // 強化後の数値プレビュー
      if (cost !== null && t.type !== 'wall') {
        const nx = getTowerStats(t.type, t.level + 1);
        const diff = [];
        if (nx.damage) diff.push(`攻撃 ${st.damage}→${nx.damage}`);
        if (nx.range) diff.push(`射程 ${st.range.toFixed(1)}→${nx.range.toFixed(1)}`);
        if (nx.cooldown) diff.push(`間隔 ${st.cooldown.toFixed(2)}→${nx.cooldown.toFixed(2)}`);
        if (nx.poison) diff.push(`毒 ${st.poison.dps}→${nx.poison.dps}`);
        if (nx.slow) diff.push(`減速 ×${st.slow.factor.toFixed(1)}→×${nx.slow.factor.toFixed(1)}`);
        if (nx.income) diff.push(`収入 ${st.income}→${nx.income}`);
        lines.push(`Lv${t.level + 1}: ${diff.join(' / ')}`);
      }
      el.tiStats.textContent = lines.join('\n');
      if (t.type === 'wall' || cost === null) {
        el.upgradeBtn.textContent = t.type === 'wall' ? '強化不可' : '最大Lv';
        el.upgradeBtn.disabled = true;
      } else {
        el.upgradeBtn.textContent = `強化（${cost}）`;
        el.upgradeBtn.disabled = !prepare || s.money < cost;
      }
      el.sellSelectedBtn.disabled = !prepare;
      el.towerInfo.classList.remove('hidden');
    }
  }

  // 終了画面
  const ended = s.phase === PHASE.GAMEOVER || s.phase === PHASE.CLEAR;
  if (ended && !shownEnd) {
    shownEnd = true;
    const cleared = s.phase === PHASE.CLEAR;
    if (cleared) {
      const p = loadProgress();
      const prev = p.cleared[s.stageId];
      if (!prev || prev.lives < s.lives) p.cleared[s.stageId] = { lives: s.lives };
      saveProgress(p);
    }
    const idx = STAGES.findIndex((x) => x.id === s.stageId);
    el.overlayTitle.textContent = cleared ? `${stage.name} を守り抜いた！` : '城は陥落した…';
    el.overlayBody.textContent =
      `到達ウェーブ: ${s.wave} / ${stage.waves.length}\n撃破数: ${s.stats.kills}　侵入数: ${s.stats.leaked}\n` +
      `残りライフ: ${s.lives} / ${stage.initialLives}　獲得金額: ${s.stats.earned}`;
    el.nextStageBtn.classList.toggle('hidden', !(cleared && idx + 1 < STAGES.length));
    el.retryWaveBtn.classList.toggle('hidden', cleared || !checkpoint);
    if (!cleared && checkpoint) el.retryWaveBtn.textContent = `ウェーブ ${s.wave} からやり直す`;
    el.overlay.classList.remove('hidden');
  }
}

// ---- メインループ ----
let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.25; // タブ復帰時などの巨大な経過時間を抑える

function frame(now) {
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  if (game.running) {
    acc += dt * ui.speed;
    while (acc >= DT) {
      step(game.state);
      acc -= DT;
    }
    if (ui.messageTimer > 0) {
      ui.messageTimer -= dt;
      if (ui.messageTimer <= 0) showMessage(null);
    }
    refreshHover(game, ui);
    render(ctx, game.state, ui);
    updateHud();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
showStageSelect();
