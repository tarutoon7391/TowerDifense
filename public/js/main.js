// エントリーポイント: ゲームループ（requestAnimationFrame + 固定タイムステップ）と UI 配線
// ロジックは shared/ に閉じているので、ここでは state を読み、コマンドと step() だけを呼ぶ
import { DT, TOWERS, STAGES, ENEMIES, GENRES, SPELLS, getStage, towersByGenre } from '/shared/config.js';
import { createState, PHASE } from '/shared/state.js';
import {
  startWave, upgradeTower, sellTower, currentUpgradeCost, callNextWave, castSpell, toggleBridge,
  mutationForWave, placeTower, currentSellRate,
} from '/shared/commands.js';
import { step } from '/shared/simulation.js';
import { getTowerStats, needsBranchChoice } from '/shared/towers.js';
import { effectiveStats, economyModifiers } from '/shared/buffs.js';
import { render, layout, TOWER_COLORS, drawMiniMap, genreColor } from './renderer.js';
import { bindInput, refreshHover } from './input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ゲーム本体（state は差し替えるのでオブジェクトに包む）
const game = { state: createState({ seed: 1, stageId: STAGES[0].id }), running: false, paused: false, replay: null };

// 画面側だけの状態（ロジックには含めない）
const ui = {
  tool: 'wall',     // 選択中のツール: タワー種別 or 'sell' or null
  hover: null,      // ホバー中のマス
  hoverOk: false,   // ホバー中マスに設置できるか
  hoverFlow: null,  // 置いた後の距離マップ（経路プレビュー用）
  selected: null,   // 選択中の建物のマス
  spellTarget: null, // 着弾指定中の魔法 { id, name, radius }
  messageTimer: 0,
  speed: 1,
  deck: null,       // ドラフトで選んだ建築の集合（null なら全部使える）
};

// ---- リプレイ記録・アンドゥ ----
// すべてのコマンドを順番に記録する。ウェーブ中のコマンドは tick も記録する
let commandLog = [];
let undoStack = [];           // { snapshot, logLength }
let checkpoint = null;        // ウェーブ開始直前の状態（JSON）
let checkpointLog = 0;

function record(name, args) {
  const s = game.state;
  if (game.replay) return; // リプレイ再生中は記録しない
  if (s.phase === PHASE.PREPARE && name !== 'startWave') {
    undoStack.push({ snapshot: JSON.stringify(s), logLength: commandLog.length });
    if (undoStack.length > 40) undoStack.shift();
  }
  commandLog.push({ c: name, a: args, t: s.phase === PHASE.WAVE ? s.tick : 0 });
}

// シードは画面側で決める（ロジック側は Date.now を使わない）
function newSeed() {
  return (Date.now() ^ (Math.floor(Math.random() * 0xffff) << 16)) >>> 0;
}
// 今日の迷宮: 日付からシード
function dailySeed() {
  const d = new Date();
  return (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) >>> 0;
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
function starsFor(lives, initial) {
  const r = lives / initial;
  return r >= 0.9 ? 3 : r >= 0.5 ? 2 : 1;
}
function starText(n) {
  return '★'.repeat(n) + '<span class="dim">' + '★'.repeat(3 - n) + '</span>';
}

// ---- DOM 要素 ----
const $ = (id) => document.getElementById(id);
const el = {
  stageName: $('stageName'),
  money: $('money'), lives: $('lives'), mana: $('mana'), manaStat: $('manaStat'),
  wave: $('wave'), waveTotal: $('waveTotal'), phase: $('phase'),
  towerButtons: $('towerButtons'), toolDesc: $('toolDesc'), sellBtn: $('sellBtn'), sellRateLabel: $('sellRateLabel'),
  undoBtn: $('undoBtn'), pauseBtn: $('pauseBtn'), pausedBadge: $('pausedBadge'),
  towerInfo: $('towerInfo'), tiName: $('tiName'), tiLevel: $('tiLevel'), tiStats: $('tiStats'),
  upgradeBtn: $('upgradeBtn'), branchABtn: $('branchABtn'), branchBBtn: $('branchBBtn'), toggleBtn: $('toggleBtn'),
  sellSelectedBtn: $('sellSelectedBtn'),
  nextWave: $('nextWave'), startWaveBtn: $('startWaveBtn'), callWaveBtn: $('callWaveBtn'), speedSeg: $('speedSeg'),
  spells: $('spells'), spellButtons: $('spellButtons'),
  message: $('message'), backBtn: $('backBtn'),
  stageSelect: $('stageSelect'), stageCards: $('stageCards'), dailyToggle: $('dailyToggle'), deckToggle: $('deckToggle'),
  replayInput: $('replayInput'), replayBtn: $('replayBtn'), replayBadge: $('replayBadge'),
  draft: $('draft'), draftRows: $('draftRows'), draftStartBtn: $('draftStartBtn'), draftCancelBtn: $('draftCancelBtn'),
  overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayStars: $('overlayStars'), overlayBody: $('overlayBody'),
  restartBtn: $('restartBtn'), nextStageBtn: $('nextStageBtn'), toSelectBtn: $('toSelectBtn'),
  retryWaveBtn: $('retryWaveBtn'), shareBtn: $('shareBtn'),
  genreTabs: $('genreTabs'), genreDesc: $('genreDesc'), towerCount: $('towerCount'),
};

// ---- ジャンルタブと建築ボタン ----
const towerButtons = {};
const genreButtons = {};
let currentGenre = GENRES[GENRES.length - 1].id; // 最初は「特殊」（石壁がある）
el.towerCount.textContent = `全${Object.keys(TOWERS).length}種`;

for (const g of GENRES) {
  const b = document.createElement('button');
  b.innerHTML = `${g.name}<span class="n">${towersByGenre(g.id).length}種</span>`;
  b.title = g.desc;
  b.addEventListener('click', () => selectGenre(g.id));
  el.genreTabs.appendChild(b);
  genreButtons[g.id] = b;
}
const KEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Q', 'W', 'E'];
for (const g of GENRES) {
  towersByGenre(g.id).forEach((type, index) => {
    const def = TOWERS[type];
    const btn = document.createElement('button');
    btn.className = 'tool';
    btn.dataset.genre = g.id;
    btn.title = def.desc;
    const color = (TOWER_COLORS[type] || genreColor(g.id)).main;
    const key = index < KEY_LABELS.length ? `<span class="key">${KEY_LABELS[index]}</span>` : '';
    btn.innerHTML = key +
      `<span class="swatch" style="background:${color}">${def.short}</span>` +
      `<span class="label">${def.name}</span>` +
      `<span class="cost">${def.cost}</span>`;
    btn.addEventListener('click', () => selectTool(type));
    el.towerButtons.appendChild(btn);
    towerButtons[type] = btn;
  });
}

function deckAllows(type) {
  return !ui.deck || ui.deck.has(type) || type === 'wall';
}
function visibleTypes(genreId) {
  return towersByGenre(genreId).filter(deckAllows);
}
function selectGenre(id) {
  currentGenre = id;
  for (const [gid, b] of Object.entries(genreButtons)) b.classList.toggle('active', gid === id);
  for (const [type, btn] of Object.entries(towerButtons)) {
    btn.classList.toggle('hidden', TOWERS[type].genre !== id || !deckAllows(type));
  }
  // キー表示はジャンル内の「表示されている順」に振り直す
  visibleTypes(id).forEach((type, i) => {
    const k = towerButtons[type].querySelector('.key');
    if (k) k.textContent = KEY_LABELS[i] || '';
  });
  el.genreDesc.textContent = GENRES.find((g) => g.id === id)?.desc || '';
}
selectGenre(currentGenre);
el.sellBtn.addEventListener('click', () => selectTool(ui.tool === 'sell' ? null : 'sell'));

function selectTool(tool) {
  if (tool && TOWERS[tool] && !deckAllows(tool)) return;
  ui.tool = tool;
  ui.spellTarget = null;
  for (const [type, btn] of Object.entries(towerButtons)) btn.classList.toggle('active', tool === type);
  el.sellBtn.classList.toggle('active', tool === 'sell');
  el.toolDesc.innerHTML = tool && TOWERS[tool] ? describeTool(tool) : (tool === 'sell' ? '建物をクリックして売却' : '');
}

// ツール説明（レベル1のステータス＋DPS の目安）
function describeTool(type) {
  const s = getTowerStats(type, 1);
  const parts = [TOWERS[type].desc];
  if (s.damage && s.cooldown) {
    const dps = (s.damage / s.cooldown) * (s.multishot || 1);
    parts.push(`攻撃 ${s.damage} / 射程 ${s.range.toFixed(1)} / 間隔 ${s.cooldown.toFixed(2)}秒 → <span class="dps">DPS 約${dps.toFixed(0)}</span>（${s.damageType === 'magic' ? '魔法' : '物理'}）`);
  } else if (s.range && s.attack !== 'none') {
    parts.push(`射程 ${s.range.toFixed(1)} / 間隔 ${s.cooldown.toFixed(2)}秒`);
  }
  const fx = [];
  if (s.slow) fx.push(`減速×${s.slow.factor.toFixed(1)}（${s.slow.duration}秒）`);
  if (s.poison) fx.push(`継続${s.poison.dps}/秒（${s.poison.duration}秒）`);
  if (s.curse) fx.push(`呪い 鎧-${s.curse.armorReduce}・被ダメ×${s.curse.damageTakenMul}`);
  if (s.stun) fx.push(`気絶${Math.round(s.stun.chance * 100)}%`);
  if (s.knockback) fx.push(`押し戻し${Math.round(s.knockback.chance * 100)}%`);
  if (s.crit) fx.push(`クリ${Math.round(s.crit.chance * 100)}%`);
  if (s.income) fx.push(`収入${s.income}/波`);
  if (s.buff) fx.push(`支援範囲${s.buff.range}`);
  if (fx.length) parts.push(fx.join(' / '));
  return parts.join('<br>');
}

// ---- ステージ選択 ----
function showStageSelect() {
  game.running = false;
  game.replay = null;
  el.replayBadge.classList.add('hidden');
  el.overlay.classList.add('hidden');
  el.draft.classList.add('hidden');
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
      (rec ? `<span class="badge">クリア済 残ライフ ${rec.lives}</span><span class="stars-sm">${starText(rec.stars || starsFor(rec.lives, stage.initialLives))}</span>` : '') +
      (unlocked ? '' : `<span class="lock">前のステージをクリアで解放</span>`) +
      `</div>`;
    drawMiniMap(card.querySelector('canvas'), stage);
    if (unlocked) card.addEventListener('click', () => beginStage(stage.id));
    el.stageCards.appendChild(card);
  });
  el.stageSelect.classList.remove('hidden');
}

// ステージ開始前: ドラフトが有効なら候補を出す
function beginStage(stageId) {
  const seed = el.dailyToggle.checked ? dailySeed() : newSeed();
  if (!el.deckToggle.checked) { startStage(stageId, seed, null); return; }
  showDraft(stageId, seed);
}

// ドラフト: 各ジャンルから3候補（シードで決まる）→1つ選ぶ
function showDraft(stageId, seed) {
  el.stageSelect.classList.add('hidden');
  el.draftRows.innerHTML = '';
  const picks = {};
  let h = seed >>> 0;
  const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 2246822519) ^ Math.imul(h ^ (h >>> 13), 3266489917)) >>> 0; return h / 4294967296; };
  for (const g of GENRES) {
    const pool = towersByGenre(g.id).filter((t) => t !== 'wall');
    const cands = [];
    while (cands.length < 3 && pool.length) {
      const i = Math.floor(rnd() * pool.length);
      cands.push(pool.splice(i, 1)[0]);
    }
    const row = document.createElement('div');
    row.className = 'draft-row';
    row.innerHTML = `<span class="gname">${g.name}</span>`;
    cands.forEach((type, i) => {
      const b = document.createElement('button');
      b.innerHTML = `${TOWERS[type].name}<small>${TOWERS[type].cost}G ・ ${TOWERS[type].desc}</small>`;
      b.addEventListener('click', () => {
        picks[g.id] = type;
        row.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      });
      if (i === 0) { picks[g.id] = type; b.classList.add('active'); }
      row.appendChild(b);
    });
    el.draftRows.appendChild(row);
  }
  el.draftStartBtn.onclick = () => {
    const deck = new Set(Object.values(picks));
    deck.add('wall');
    startStage(stageId, seed, deck);
  };
  el.draftCancelBtn.onclick = showStageSelect;
  el.draft.classList.remove('hidden');
}

// ---- ステージ開始 ----
let shownEnd = false;
let lastWaveSeen = 0;
function startStage(stageId, seed = newSeed(), deck = null, replay = null) {
  const stage = getStage(stageId);
  game.state = createState({ seed, stageId });
  game.paused = false;
  game.replay = replay;
  ui.deck = deck;
  // マスの大きさは画面に収まるように決める
  layout.cell = Math.max(24, Math.min(40, Math.floor(920 / stage.map.cols), Math.floor(620 / stage.map.rows)));
  canvas.width = stage.map.cols * layout.cell;
  canvas.height = stage.map.rows * layout.cell;
  ui.selected = null;
  ui.hover = null;
  ui.spellTarget = null;
  shownEnd = false;
  lastWaveSeen = 0;
  checkpoint = null;
  checkpointLog = 0;
  commandLog = [];
  undoStack = [];
  el.stageName.textContent = `${stage.name}${deck ? '（ドラフト）' : ''}${seed === dailySeed() ? '・今日の迷宮' : ''}`;
  el.waveTotal.textContent = stage.waves.length;
  el.stageSelect.classList.add('hidden');
  el.draft.classList.add('hidden');
  el.overlay.classList.add('hidden');
  el.pausedBadge.classList.add('hidden');
  el.replayBadge.classList.toggle('hidden', !replay);
  selectGenre(GENRES[GENRES.length - 1].id);
  selectTool('wall');
  showMessage({ ok: true, text: replay ? 'リプレイを再生します' : `${stage.name} — 門と城の間に迷路を築こう` });
  game.running = true;
}

// ---- コマンドのラッパー（記録してから実行） ----
function doStartWave() {
  const snapshot = JSON.stringify(game.state);
  record('startWave', []);
  const r = startWave(game.state);
  if (r.ok) { checkpoint = snapshot; checkpointLog = commandLog.length - 1; undoStack = []; }
  else commandLog.pop();
  showMessage(r.ok ? { ok: true, text: `ウェーブ ${r.wave} 開始！` } : r);
}
el.startWaveBtn.addEventListener('click', doStartWave);
el.callWaveBtn.addEventListener('click', () => {
  record('callNextWave', []);
  const r = callNextWave(game.state);
  if (!r.ok) commandLog.pop();
  showMessage(r.ok ? { ok: true, text: `ウェーブ ${r.wave} を前倒し！ ボーナス +${r.bonus}` } : r);
});
el.retryWaveBtn.addEventListener('click', () => {
  if (!checkpoint) return;
  game.state = JSON.parse(checkpoint);
  commandLog = commandLog.slice(0, checkpointLog);
  undoStack = [];
  ui.selected = null;
  shownEnd = false;
  el.overlay.classList.add('hidden');
  showMessage({ ok: true, text: `ウェーブ ${game.state.wave + 1} の準備からやり直し` });
});
function doUndo() {
  if (game.replay) return;
  if (game.state.phase !== PHASE.PREPARE) { showMessage({ ok: false, reason: '元に戻せるのは準備中だけです' }); return; }
  const u = undoStack.pop();
  if (!u) { showMessage({ ok: false, reason: '戻せる操作がありません' }); return; }
  game.state = JSON.parse(u.snapshot);
  commandLog = commandLog.slice(0, u.logLength);
  ui.selected = null;
  showMessage({ ok: true, text: '1手戻しました' });
}
el.undoBtn.addEventListener('click', doUndo);
function togglePause() {
  if (!game.running) return;
  game.paused = !game.paused;
  el.pausedBadge.classList.toggle('hidden', !game.paused);
  el.pauseBtn.textContent = game.paused ? '再開' : '一時停止';
}
el.pauseBtn.addEventListener('click', togglePause);

el.speedSeg.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    ui.speed = Number(b.dataset.speed);
    el.speedSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  });
});
function doUpgrade(branch = null) {
  if (!ui.selected) return;
  record('upgradeTower', [ui.selected.x, ui.selected.y, branch]);
  const r = upgradeTower(game.state, ui.selected.x, ui.selected.y, branch);
  if (!r.ok) { commandLog.pop(); undoStack.pop(); }
  showMessage(r.ok ? { ok: true, text: `強化しました（Lv${r.level}${r.branch ? '・' + TOWERS[game.state.towers.find((t) => t.x === ui.selected.x && t.y === ui.selected.y).type].branches[r.branch].name : ''}）` } : r);
}
el.upgradeBtn.addEventListener('click', () => doUpgrade(null));
el.branchABtn.addEventListener('click', () => doUpgrade('a'));
el.branchBBtn.addEventListener('click', () => doUpgrade('b'));
el.toggleBtn.addEventListener('click', () => {
  if (!ui.selected) return;
  record('toggleBridge', [ui.selected.x, ui.selected.y]);
  const r = toggleBridge(game.state, ui.selected.x, ui.selected.y);
  if (!r.ok) { commandLog.pop(); undoStack.pop(); }
  showMessage(r.ok ? { ok: true, text: r.open ? '跳ね橋を開きました（通れる）' : '跳ね橋を閉じました（塞ぐ）' } : r);
});
el.sellSelectedBtn.addEventListener('click', () => {
  if (!ui.selected) return;
  record('sellTower', [ui.selected.x, ui.selected.y]);
  const r = sellTower(game.state, ui.selected.x, ui.selected.y);
  if (r.ok) { r.text = `売却しました（+${r.refund}）`; ui.selected = null; }
  else { commandLog.pop(); undoStack.pop(); }
  showMessage(r);
});

// 魔法ボタン
for (const [id, sp] of Object.entries(SPELLS)) {
  const b = document.createElement('button');
  b.dataset.spell = id;
  b.innerHTML = `${sp.name}<small>魔力${sp.cost} ・ ${sp.desc}</small>`;
  b.addEventListener('click', () => {
    if (id === 'meteor') {
      ui.spellTarget = ui.spellTarget?.id === id ? null : { id, name: sp.name, radius: sp.radius };
      ui.tool = null;
      for (const btn of Object.values(towerButtons)) btn.classList.remove('active');
      showMessage(ui.spellTarget ? { ok: true, text: 'マップをクリックして着弾地点を指定' } : null);
      return;
    }
    record('castSpell', [id, 0, 0]);
    const r = castSpell(game.state, id, 0, 0);
    if (!r.ok) commandLog.pop();
    showMessage(r.ok ? { ok: true, text: id === 'repair' ? `修復しました（${r.restored}か所）` : `${sp.name}！` } : r);
  });
  el.spellButtons.appendChild(b);
}

// ウェーブ中の離脱は2回押しで確定（誤操作防止）
let backArmedUntil = 0;
el.backBtn.addEventListener('click', () => {
  const inWave = game.state.phase === PHASE.WAVE && !game.replay;
  if (inWave && performance.now() > backArmedUntil) {
    backArmedUntil = performance.now() + 3000;
    el.backBtn.textContent = '本当に戻る？（もう一度押す）';
    setTimeout(() => { el.backBtn.textContent = 'ステージ選択へ戻る'; }, 3000);
    return;
  }
  el.backBtn.textContent = 'ステージ選択へ戻る';
  showStageSelect();
});
el.toSelectBtn.addEventListener('click', showStageSelect);
el.restartBtn.addEventListener('click', () => startStage(game.state.stageId, newSeed(), ui.deck));
el.nextStageBtn.addEventListener('click', () => {
  const i = STAGES.findIndex((s) => s.id === game.state.stageId);
  if (i >= 0 && i + 1 < STAGES.length) beginStage(STAGES[i + 1].id);
  else showStageSelect();
});

// ---- リプレイ ----
function replayCode() {
  const data = { v: 1, stage: game.state.stageId, seed: game.state.seed, cmds: commandLog };
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}
function parseReplay(code) {
  try { return JSON.parse(decodeURIComponent(escape(atob(code.trim())))); }
  catch { return null; }
}
el.shareBtn.addEventListener('click', async () => {
  const code = replayCode();
  try {
    await navigator.clipboard.writeText(code);
    showMessage({ ok: true, text: 'リプレイコードをコピーしました（ステージ選択画面で貼り付け）' });
  } catch {
    el.replayInput.value = code;
    showMessage({ ok: true, text: 'リプレイコードをステージ選択画面の入力欄に入れました' });
  }
});
el.replayBtn.addEventListener('click', () => {
  const data = parseReplay(el.replayInput.value);
  if (!data || !getStage(data.stage) || !Array.isArray(data.cmds)) { alertMessage('リプレイコードが読めません'); return; }
  startStage(data.stage, data.seed >>> 0, null, { cmds: data.cmds, index: 0 });
});
function alertMessage(text) {
  el.replayInput.value = '';
  el.replayInput.placeholder = text;
}
// リプレイ再生: 次のコマンドが実行できるタイミングになったら適用する
function replayDrive() {
  const rp = game.replay;
  const s = game.state;
  if (!rp) return;
  while (rp.index < rp.cmds.length) {
    const cmd = rp.cmds[rp.index];
    const waveCmd = cmd.c === 'callNextWave' || cmd.c === 'castSpell';
    if (waveCmd) {
      if (s.phase !== PHASE.WAVE) { rp.index++; continue; } // ずれた場合は捨てる
      if (s.tick < cmd.t) return;
    } else if (s.phase === PHASE.WAVE) {
      return; // 準備フェーズになるまで待つ
    }
    rp.index++;
    const a = cmd.a || [];
    if (cmd.c === 'placeTower') placeTower(s, a[0], a[1], a[2]);
    else if (cmd.c === 'sellTower') sellTower(s, a[0], a[1]);
    else if (cmd.c === 'upgradeTower') upgradeTower(s, a[0], a[1], a[2] || null);
    else if (cmd.c === 'toggleBridge') toggleBridge(s, a[0], a[1]);
    else if (cmd.c === 'startWave') startWave(s);
    else if (cmd.c === 'callNextWave') callNextWave(s);
    else if (cmd.c === 'castSpell') castSpell(s, a[0], a[1], a[2]);
  }
  // コマンドを使い切り、ウェーブも終わったら再生終了
  if (s.phase !== PHASE.WAVE && rp.index >= rp.cmds.length) {
    game.replay = null;
    el.replayBadge.classList.add('hidden');
    showMessage({ ok: true, text: 'リプレイ終了。ここから続けて遊べます' });
  }
}

// キーボードショートカット
window.addEventListener('keydown', (ev) => {
  if (!game.running || ev.target.tagName === 'INPUT') return;
  const types = visibleTypes(currentGenre);
  const k = ev.key.toUpperCase();
  const idx = KEY_LABELS.indexOf(k);
  if (idx >= 0 && idx < types.length && !ev.ctrlKey) selectTool(types[idx]);
  else if (ev.key === 'Tab') {
    ev.preventDefault();
    const i = GENRES.findIndex((g) => g.id === currentGenre);
    const n = (i + (ev.shiftKey ? GENRES.length - 1 : 1)) % GENRES.length;
    selectGenre(GENRES[n].id);
  }
  else if (k === 'S') selectTool('sell');
  else if (k === 'U') el.upgradeBtn.click();
  else if (k === 'P') togglePause();
  else if (k === 'Z') doUndo();
  else if (ev.key === ' ') { ev.preventDefault(); if (game.state.phase === PHASE.PREPARE) doStartWave(); else el.callWaveBtn.click(); }
  else if (ev.key === 'Escape') {
    if (game.replay) { game.replay = null; el.replayBadge.classList.add('hidden'); }
    selectTool(null); ui.selected = null; ui.spellTarget = null;
  }
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
  ui.messageTimer = 3.5; // 秒
}

bindInput(canvas, game, ui, showMessage, (name, args) => record(name, args));

// ---- HUD 更新 ----
let lastInfoKey = '';
let lastNextWaveKey = '';
function buffText(b) {
  const parts = [];
  if (b.damageMul > 1) parts.push(`攻撃×${b.damageMul.toFixed(2)}`);
  if (b.rangeAdd > 0) parts.push(`射程+${b.rangeAdd.toFixed(1)}`);
  if (b.cooldownMul < 1) parts.push(`間隔×${b.cooldownMul.toFixed(2)}`);
  if (b.critAdd > 0) parts.push(`クリ+${Math.round(b.critAdd * 100)}%`);
  if (b.flyingMul > 1) parts.push(`対空×${b.flyingMul.toFixed(2)}`);
  if (b.statusDurationMul > 1) parts.push(`状態異常×${b.statusDurationMul.toFixed(1)}`);
  return parts.join(' ');
}
function updateHud() {
  const s = game.state;
  const stage = getStage(s.stageId);
  const mod = economyModifiers(s);
  el.money.textContent = s.money;
  el.lives.textContent = s.lives;
  el.mana.textContent = s.mana;
  el.manaStat.classList.toggle('hidden', s.mana === 0 && mod.manaPerWave === 0);
  el.wave.textContent = s.wave;
  const isWave = s.phase === PHASE.WAVE;
  const prepare = s.phase === PHASE.PREPARE;
  el.phase.textContent =
    prepare ? '準備中' :
    isWave ? `ウェーブ進行中（敵 ${s.enemies.length + s.spawnQueue.length}）` :
    s.phase === PHASE.CLEAR ? 'クリア！' : 'ゲームオーバー';
  el.phase.classList.toggle('wave', isWave);
  el.startWaveBtn.classList.toggle('hidden', !prepare);
  el.startWaveBtn.textContent = prepare ? `ウェーブ ${s.wave + 1} を開始` : 'ウェーブ開始';
  const canCall = isWave && s.spawnQueue.length === 0 && s.wave < stage.waves.length;
  el.callWaveBtn.classList.toggle('hidden', !isWave || s.wave >= stage.waves.length);
  el.callWaveBtn.disabled = !canCall;
  el.callWaveBtn.textContent = canCall
    ? `次のウェーブを呼ぶ（早回し +${s.enemies.length * 3}）`
    : '次のウェーブを呼ぶ（出きるまで待機）';
  // 建築ボタン: 買えなくても選択はできる（設置時に拒否）。色だけ変える
  for (const [type, btn] of Object.entries(towerButtons)) {
    btn.classList.toggle('unaffordable', s.money < TOWERS[type].cost);
  }
  el.sellRateLabel.textContent = `投資額の${Math.round(mod.sellRate * 100)}%返金${mod.wallSellRate > mod.sellRate ? `・壁${Math.round(mod.wallSellRate * 100)}%` : ''}`;
  el.undoBtn.disabled = !prepare || undoStack.length === 0;
  // 魔法
  const showSpells = s.mana > 0 || mod.manaPerWave > 0;
  el.spells.classList.toggle('hidden', !showSpells);
  if (showSpells) {
    el.spellButtons.querySelectorAll('button').forEach((b) => {
      const sp = SPELLS[b.dataset.spell];
      b.disabled = s.mana < sp.cost || (b.dataset.spell !== 'repair' && !isWave);
      b.classList.toggle('active', ui.spellTarget?.id === b.dataset.spell);
    });
  }
  // 賭博の結果はウェーブが終わったときに知らせる
  if (prepare && s.wave !== lastWaveSeen) {
    lastWaveSeen = s.wave;
    if (s.lastGamble) {
      showMessage(s.lastGamble.won
        ? { ok: true, text: `賭博場: 勝ち！ +${s.lastGamble.amount}` }
        : { ok: false, reason: `賭博場: 負け… −${s.lastGamble.amount}` });
    }
  }

  // 次のウェーブの構成（偵察気球があると先まで見え、変異も分かる）
  const preview = mod.previewWaves;
  const nextKey = `${s.stageId}:${s.wave}:${s.phase}:${preview}`;
  if (nextKey !== lastNextWaveKey) {
    lastNextWaveKey = nextKey;
    const html = [];
    for (let k = 0; k <= preview; k++) {
      const def = stage.waves[s.wave + k];
      if (!prepare || !def) break;
      const counts = {};
      for (const g of def.groups) counts[g.type] = (counts[g.type] || 0) + g.count;
      const parts = Object.entries(counts).map(([t, n]) => {
        const e = ENEMIES[t];
        const tags = [];
        if (e.flying) tags.push('飛');
        if (e.armor) tags.push('鎧');
        if (e.regen) tags.push('再生');
        if (e.undead) tags.push('不死');
        if (e.breakWalls) tags.push('壁壊し');
        if (e.stealGold) tags.push('盗み');
        if (e.revive) tags.push('蘇生');
        const label = `${e.name}×${n}${tags.length ? `(${tags.join('・')})` : ''}`;
        const tip = [
          `HP ${Math.round(e.hp * def.hpMul)}`, `速度 ${e.speed}`,
          e.armor ? `鎧 ${e.armor}（物理-${e.armor}）` : null,
          e.regen ? `再生 ${e.regen}/秒` : null,
          e.flying ? '飛行: 迷路を無視して直進' : null,
          e.undead ? 'アンデッド: 聖光に弱い' : null,
          e.splitInto ? `倒すと${ENEMIES[e.splitInto.type].name}×${e.splitInto.count}に分裂` : null,
          e.slowResist ? `スロウ耐性 ${Math.round(e.slowResist * 100)}%` : null,
          e.breakWalls ? `${e.breakWalls.cooldown}秒ごとに近くの壁を壊す` : null,
          e.stealGold ? `到達でお金−${e.stealGold}` : null,
          e.revive ? `近くのアンデッドを${e.revive.max}回まで蘇生` : null,
          e.summon ? `${e.summon.every}秒ごとに${ENEMIES[e.summon.type].name}を召喚` : null,
          `到達でライフ-${e.livesCost ?? 1}`, `報酬 ${e.reward}〜`,
        ].filter(Boolean).join(' / ');
        return `<span class="enemy${e.boss ? ' boss' : ''}" title="${tip}">${label}</span>`;
      });
      const mut = mutationForWave(s.seed, s.wave + k);
      const mutText = preview > 0
        ? (mut.id === 'none' ? '' : `　<span class="mut" title="${mut.desc}">変異: ${mut.name}</span>`)
        : (s.wave + k >= 2 ? '　<span class="mut" title="偵察気球があると事前に分かる">変異: ？</span>' : '');
      const label = k === 0 ? '次のウェーブ' : `ウェーブ${s.wave + k + 1}`;
      html.push(`${label}: <b>${parts.join('、')}</b>　HP倍率 ×${def.hpMul}${mutText}`);
    }
    el.nextWave.innerHTML = html.join('<br>');
  }

  // 選択中の建物パネル
  const t = ui.selected ? s.towers.find((tw) => tw.x === ui.selected.x && tw.y === ui.selected.y) : null;
  if (!t) {
    if (ui.selected) ui.selected = null;
    el.towerInfo.classList.add('hidden');
    lastInfoKey = '';
  } else {
    const key = `${t.id}:${t.level}:${t.branch}:${t.open}:${s.money}:${s.phase}:${s.towers.length}:${t.boostUntil > s.waveTick}`;
    if (key !== lastInfoKey) {
      lastInfoKey = key;
      const st = effectiveStats(s, t);   // 支援効果込みの実効値
      const cost = currentUpgradeCost(s, t);
      const def = TOWERS[t.type];
      el.tiName.textContent = st.name + (st.branchName ? `（${st.branchName}）` : '');
      el.tiLevel.textContent = `Lv${t.level}`;
      const lines = [];
      if (st.damage !== undefined && st.attack !== 'none') {
        const dps = (st.damage / st.cooldown) * (st.multishot || 1);
        lines.push(`攻撃 ${st.damage}（${st.damageType === 'magic' ? '魔法' : '物理'}）/ 射程 ${st.range.toFixed(1)} / 間隔 ${st.cooldown.toFixed(2)}秒 / DPS約${dps.toFixed(0)}`);
      }
      if (st.applied && (st.applied.sources > 0 || st.applied.boosted)) lines.push(`支援効果: ${buffText(st.applied)}${st.applied.boosted ? '（警鐘ブースト中）' : ''}`);
      if (st.synergies?.length) lines.push(`隣接シナジー: ${st.synergies.join('・')}`);
      if (st.terrain?.hill) lines.push('高台: 射程+1.0');
      if (st.terrain?.shore && st.slow) lines.push('水辺: 減速強化');
      if (st.slow) lines.push(`減速 ×${st.slow.factor.toFixed(1)}（${st.slow.duration}秒）`);
      if (st.poison) lines.push(`継続ダメージ ${st.poison.dps}/秒（${st.poison.duration}秒）`);
      if (st.chain) lines.push(`連鎖 ${st.chain.jumps}回`);
      if (st.curse) lines.push(`呪い 鎧-${st.curse.armorReduce} / 被ダメ×${st.curse.damageTakenMul}（${st.curse.duration}秒）`);
      if (st.stun) lines.push(`気絶 ${Math.round(st.stun.chance * 100)}%（${st.stun.duration}秒）`);
      if (st.knockback) lines.push(`押し戻し ${Math.round(st.knockback.chance * 100)}%（${st.knockback.cells}マス）`);
      if (st.ground) lines.push(`飛行を${st.ground.duration}秒着地させる`);
      if (st.crit) lines.push(`クリティカル ${Math.round(st.crit.chance * 100)}%（×${st.crit.mul}）`);
      if (st.executeBelow) lines.push(`HP${Math.round(st.executeBelow * 100)}%以下を即死`);
      if (st.ramp) lines.push(`同一目標で威力+${Math.round(st.ramp.perHit * 100)}%/発（最大×${st.ramp.max}）`);
      if (st.multishot > 1) lines.push(`同時に${st.multishot}体を攻撃`);
      if (st.splashRadius && st.attack === 'homing') lines.push(`着弾時に周囲${st.splashRadius.toFixed(1)}マスへ半減ダメージ`);
      if (st.fire) lines.push('炎属性（油まみれの敵に引火爆発）');
      if (st.shatter) lines.push('砕き属性（気絶中のHP30%以下を砕く）');
      if (st.holy) lines.push('聖属性（毒を浄化して一括ダメージ）');
      if (st.buff) lines.push(`支援（範囲${st.buff.range >= 100 ? '全体' : st.buff.range}${st.buff.only ? '・' + (st.buff.only === 'magic' ? '魔法塔のみ' : '物理塔のみ') : ''}）: ${buffText(st.buff)}`);
      if (st.units) lines.push(`兵士 ${st.units.count}体（HP ${st.units.hp}）を周囲${st.units.range}マスの通路に配置`);
      if (st.alarm) lines.push(`踏まれると周囲${st.alarm.range}マスの塔が${st.alarm.duration}秒間 攻撃×${st.alarm.damageMul}`);
      if (st.floor) lines.push('敵が通れる床' + (st.floor.slow ? `（減速×${st.floor.slow.factor}）` : '') + (st.floor.oil ? '（油まみれ）' : '') + (st.floor.curse ? '（アンデッドの被ダメ増）' : ''));
      if (st.trap) lines.push(`罠（${t.armed ? '作動可能' : 'このウェーブは使用済み'}）`);
      if (st.portal) lines.push('転送門（2基で1組。設置順に組になる）');
      if (st.toggleable) lines.push(t.open ? '跳ね橋: 開いている（通れる）' : '跳ね橋: 閉じている（塞ぐ）');
      if (st.income) lines.push(`収入 ${st.income} / ウェーブ${st.incomeGrowth ? `（毎ウェーブ+${st.incomeGrowth}）` : ''}`);
      if (st.interest) lines.push(`利息 残金の${Math.round(st.interest.rate * 100)}%`);
      if (st.livesPerWave) lines.push(`ウェーブ終了ごとにライフ${st.livesPerWave > 0 ? '+' : ''}${st.livesPerWave}`);
      if (st.bonusMul > 1) lines.push(`クリアボーナス×${st.bonusMul}`);
      if (st.sellRate) lines.push(`売却返金率 ${Math.round(st.sellRate * 100)}%${st.wallSellRate ? `（壁${Math.round(st.wallSellRate * 100)}%）` : ''}`);
      if (st.upgradeDiscount < 1) lines.push(`強化費用 ${Math.round(st.upgradeDiscount * 100)}%`);
      if (st.bounty) lines.push(`周囲${st.bounty.range}マスでの撃破+${st.bounty.gold}ゴールド`);
      if (st.perTowerGold) lines.push(`壁以外の建物1つにつき+${st.perTowerGold.gold}（上限${st.perTowerGold.cap}）`);
      if (st.previewWaves) lines.push(`先の${st.previewWaves}ウェーブと変異を表示`);
      if (st.manaPerWave) lines.push(`ウェーブ終了ごとに魔力+${st.manaPerWave}`);
      if (st.pact) lines.push(`敵HP×${st.pact.enemyHpMul} / 報酬×${st.pact.rewardMul}`);
      if (st.gamble) lines.push(`ウェーブ終了時に所持金の${Math.round(st.gamble.rate * 100)}%を賭ける`);
      if (st.breakable) lines.push('破城槌オーガに壊される');
      lines.push(`投資額 ${t.invested} → 売却 ${Math.floor(t.invested * currentSellRate(s, t))}`);
      // 強化後の数値プレビュー
      const branching = needsBranchChoice(t.type, t.level);
      if (cost !== null && def.attack !== 'none' || (cost !== null && (def.buff || def.income || def.units || def.manaPerWave || def.bounty))) {
        if (!branching) {
          const nx = getTowerStats(t.type, t.level + 1, t.branch);
          const diff = [];
          if (nx.damage) diff.push(`攻撃 ${getTowerStats(t.type, t.level, t.branch).damage}→${nx.damage}`);
          if (nx.range) diff.push(`射程 ${getTowerStats(t.type, t.level, t.branch).range.toFixed(1)}→${nx.range.toFixed(1)}`);
          if (nx.cooldown) diff.push(`間隔 ${getTowerStats(t.type, t.level, t.branch).cooldown.toFixed(2)}→${nx.cooldown.toFixed(2)}`);
          if (nx.poison) diff.push(`継続 →${nx.poison.dps}`);
          if (nx.slow) diff.push(`減速 →×${nx.slow.factor.toFixed(1)}`);
          if (nx.income) diff.push(`収入 →${nx.income}`);
          if (nx.buff) diff.push(`支援 →${buffText(nx.buff)}`);
          if (nx.units) diff.push(`兵士HP →${nx.units.hp}`);
          if (diff.length) lines.push(`Lv${t.level + 1}: ${diff.join(' / ')}`);
        } else {
          const ba = def.branches.a;
          const bb = def.branches.b;
          lines.push(`Lv3 分岐 A「${ba.name}」: ${ba.desc}`);
          lines.push(`Lv3 分岐 B「${bb.name}」: ${bb.desc}`);
        }
      }
      el.tiStats.textContent = lines.join('\n');
      const noUpgrade = cost === null || t.type === 'wall' || t.type === 'ironwall';
      el.upgradeBtn.classList.toggle('hidden', branching && !noUpgrade);
      el.branchABtn.classList.toggle('hidden', !(branching && !noUpgrade));
      el.branchBBtn.classList.toggle('hidden', !(branching && !noUpgrade));
      if (noUpgrade) {
        el.upgradeBtn.textContent = cost === null && t.level > 1 ? '最大Lv' : '強化不可';
        el.upgradeBtn.disabled = true;
      } else if (branching) {
        el.branchABtn.textContent = `A ${def.branches.a.name}（${cost}）`;
        el.branchBBtn.textContent = `B ${def.branches.b.name}（${cost}）`;
        el.branchABtn.disabled = el.branchBBtn.disabled = !prepare || s.money < cost;
      } else {
        el.upgradeBtn.textContent = `強化（${cost}）`;
        el.upgradeBtn.disabled = !prepare || s.money < cost;
      }
      el.toggleBtn.classList.toggle('hidden', !def.toggleable);
      el.toggleBtn.textContent = t.open ? '閉じる' : '開く';
      el.toggleBtn.disabled = !prepare;
      el.sellSelectedBtn.disabled = !prepare;
      el.towerInfo.classList.remove('hidden');
    }
  }

  // 終了画面
  const ended = s.phase === PHASE.GAMEOVER || s.phase === PHASE.CLEAR;
  if (ended && !shownEnd) {
    shownEnd = true;
    const cleared = s.phase === PHASE.CLEAR;
    const stars = cleared ? starsFor(s.lives, stage.initialLives) : 0;
    if (cleared && !game.replay) {
      const p = loadProgress();
      const prev = p.cleared[s.stageId];
      if (!prev || prev.lives < s.lives) p.cleared[s.stageId] = { lives: s.lives, stars };
      saveProgress(p);
    }
    const idx = STAGES.findIndex((x) => x.id === s.stageId);
    el.overlayTitle.textContent = cleared ? `${stage.name} を守り抜いた！` : '城は陥落した…';
    el.overlayStars.innerHTML = cleared ? starText(stars) : '';
    el.overlayBody.textContent =
      `到達ウェーブ: ${s.wave} / ${stage.waves.length}\n撃破数: ${s.stats.kills}　侵入数: ${s.stats.leaked}　奪われた金: ${s.stats.stolen}\n` +
      `残りライフ: ${s.lives} / ${stage.initialLives}　獲得金額: ${s.stats.earned}　早回し: ${s.stats.earlyCalls}回　壊された壁: ${s.stats.wallsBroken}`;
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
    if (game.replay) replayDrive();
    if (!game.paused) {
      acc += dt * ui.speed;
      while (acc >= DT) {
        step(game.state);
        acc -= DT;
        if (game.replay) replayDrive();
      }
    } else {
      acc = 0;
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
