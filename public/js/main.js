// エントリーポイント: ゲームループ（requestAnimationFrame + 固定タイムステップ）と UI 配線
// ロジックは shared/ に閉じているので、ここでは state を読み、コマンドと step() だけを呼ぶ
import { DT, TOWERS, WAVES, ECONOMY } from '/shared/config.js';
import { createState, PHASE } from '/shared/state.js';
import { startWave } from '/shared/commands.js';
import { step } from '/shared/simulation.js';
import { render, TOWER_COLORS } from './renderer.js';
import { bindInput, refreshHover } from './input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ゲーム本体（state は差し替えるのでオブジェクトに包む）
const game = { state: createState({ seed: newSeed() }) };

// 画面側だけの状態（ロジックには含めない）
const ui = {
  tool: 'archer',   // 選択中のツール: タワー種別 or 'sell' or null
  hover: null,      // ホバー中のマス
  hoverOk: false,   // ホバー中マスに設置できるか
  messageTimer: 0,
  speed: 1,
};

// シードは画面側で決める（ロジック側は Date.now を使わない）
function newSeed() {
  return (Date.now() ^ (Math.floor(Math.random() * 0xffff) << 16)) >>> 0;
}

// ---- DOM 要素 ----
const el = {
  money: document.getElementById('money'),
  lives: document.getElementById('lives'),
  wave: document.getElementById('wave'),
  waveTotal: document.getElementById('waveTotal'),
  phase: document.getElementById('phase'),
  towerButtons: document.getElementById('towerButtons'),
  sellBtn: document.getElementById('sellBtn'),
  startWaveBtn: document.getElementById('startWaveBtn'),
  speedToggle: document.getElementById('speedToggle'),
  message: document.getElementById('message'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlayTitle'),
  overlayBody: document.getElementById('overlayBody'),
  restartBtn: document.getElementById('restartBtn'),
};

el.waveTotal.textContent = WAVES.length;

// ---- タワー選択ボタンを config から生成 ----
const towerButtons = {};
for (const [type, def] of Object.entries(TOWERS)) {
  const btn = document.createElement('button');
  btn.className = 'tool';
  btn.dataset.type = type;
  const desc =
    type === 'archer' ? '射程中・単体攻撃' :
    type === 'ice' ? '命中した敵を減速' :
    '着弾地点に範囲ダメージ';
  btn.innerHTML =
    `<span class="swatch" style="background:${TOWER_COLORS[type].main}"></span>` +
    `<span class="label">${def.name}<small>${desc}</small></span>` +
    `<span class="cost">${def.cost}</span>`;
  btn.addEventListener('click', () => selectTool(type));
  el.towerButtons.appendChild(btn);
  towerButtons[type] = btn;
}
el.sellBtn.addEventListener('click', () => selectTool(ui.tool === 'sell' ? null : 'sell'));

function selectTool(tool) {
  ui.tool = tool;
  for (const [type, btn] of Object.entries(towerButtons)) btn.classList.toggle('active', tool === type);
  el.sellBtn.classList.toggle('active', tool === 'sell');
}
selectTool('archer');

// ---- ウェーブ開始・倍速・リスタート ----
el.startWaveBtn.addEventListener('click', () => {
  const r = startWave(game.state);
  showMessage(r.ok ? { ok: true, text: `ウェーブ ${r.wave} 開始！` } : r);
});
el.speedToggle.addEventListener('change', () => {
  ui.speed = el.speedToggle.checked ? 2 : 1;
});
el.restartBtn.addEventListener('click', () => {
  game.state = createState({ seed: newSeed() });
  el.overlay.classList.add('hidden');
  selectTool('archer');
  showMessage({ ok: true, text: '新しいゲームを開始しました' });
});

// キーボードショートカット（1〜3: タワー, S: 売却, Space: ウェーブ開始）
window.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') return;
  const types = Object.keys(TOWERS);
  if (ev.key >= '1' && ev.key <= String(types.length)) selectTool(types[Number(ev.key) - 1]);
  else if (ev.key === 's' || ev.key === 'S') selectTool('sell');
  else if (ev.key === ' ') { ev.preventDefault(); el.startWaveBtn.click(); }
  else if (ev.key === 'Escape') selectTool(null);
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
let shownEnd = false;
function updateHud() {
  const s = game.state;
  el.money.textContent = s.money;
  el.lives.textContent = s.lives;
  el.wave.textContent = s.wave;
  const isWave = s.phase === PHASE.WAVE;
  el.phase.textContent =
    s.phase === PHASE.PREPARE ? '準備中' :
    isWave ? `ウェーブ進行中（敵 ${s.enemies.length + s.spawnQueue.length}）` :
    s.phase === PHASE.CLEAR ? 'クリア！' : 'ゲームオーバー';
  el.phase.classList.toggle('wave', isWave);
  el.startWaveBtn.disabled = s.phase !== PHASE.PREPARE;
  el.startWaveBtn.textContent =
    s.phase === PHASE.PREPARE ? `ウェーブ ${s.wave + 1} を開始` : 'ウェーブ開始';
  for (const [type, btn] of Object.entries(towerButtons)) {
    btn.disabled = s.phase !== PHASE.PREPARE || s.money < TOWERS[type].cost;
  }
  el.sellBtn.disabled = s.phase !== PHASE.PREPARE;

  // 終了画面
  const ended = s.phase === PHASE.GAMEOVER || s.phase === PHASE.CLEAR;
  if (ended && !shownEnd) {
    shownEnd = true;
    el.overlayTitle.textContent = s.phase === PHASE.CLEAR ? '城は守られた！' : '城は陥落した…';
    el.overlayBody.textContent =
      `到達ウェーブ: ${s.wave} / ${WAVES.length}\n撃破数: ${s.stats.kills}　侵入数: ${s.stats.leaked}\n` +
      `残りライフ: ${s.lives} / ${ECONOMY.initialLives}`;
    el.overlay.classList.remove('hidden');
  }
  if (!ended) shownEnd = false;
}

// ---- メインループ ----
let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.25; // タブ復帰時などの巨大な経過時間を抑える

function frame(now) {
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
