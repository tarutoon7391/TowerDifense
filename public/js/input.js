// マウス／タッチ入力。状態は直接書き換えず、必ず shared/commands.js のコマンドを呼ぶ
// Pointer Events を使うのでマウスでもタッチペンでも指でも同じ処理で動く
import { TOWERS } from '/shared/config.js';
import { placeTower, sellTower, canPlaceTower, castSpell } from '/shared/commands.js';
import { layout } from './renderer.js';

// 売却モードで即売却できる投資額の上限。これを超える建物は選択→売却ボタンで確定させる
const INSTANT_SELL_MAX = 60;

// ドラッグ配置を許可する建物（壁・床・罠など安いもの）
function dragAllowed(type) {
  const def = TOWERS[type];
  return !!def && (def.cost <= 30 && (def.attack === 'none' || def.breakable));
}

// キャンバス座標 → マス座標（範囲外なら null）
function toCell(canvas, map, ev) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor(((ev.clientX - rect.left) * scaleX) / layout.cell);
  const y = Math.floor(((ev.clientY - rect.top) * scaleY) / layout.cell);
  if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return null;
  return { x, y };
}

// ホバー中マスの配置可否と「置いた後の距離マップ」を更新する（毎フレーム呼ぶ。状態は読むだけ）
export function refreshHover(game, ui) {
  ui.hoverOk = false;
  ui.hoverFlow = null;
  if (!ui.hover || !ui.tool || ui.tool === 'sell' || ui.spellTarget) return;
  const r = canPlaceTower(game.state, ui.hover.x, ui.hover.y, ui.tool);
  ui.hoverOk = r.ok;
  if (r.ok) ui.hoverFlow = r.flow;
}

// イベント登録。game.state を参照し、onResult(result) で結果を UI に通知する
// onCommand(name, args) はコマンド実行前に呼ばれる（アンドゥ用スナップショット・リプレイ記録用）
export function bindInput(canvas, game, ui, onResult, onCommand) {
  let dragging = false;       // 左ボタン／指を押したままか
  let lastDragCell = null;    // ドラッグ中に最後に処理したマス
  let dragPlaced = false;     // ドラッグで1つ以上置いたか（click で二重に置かないため）

  function tryPlace(cell) {
    onCommand('placeTower', [cell.x, cell.y, ui.tool]);
    const result = placeTower(game.state, cell.x, cell.y, ui.tool);
    if (result.ok) {
      result.text = result.converted ? '地形を変えました' : '建設しました';
      ui.selected = null;
    }
    return result;
  }

  canvas.style.touchAction = 'none'; // ブラウザのスクロールに取られないようにする

  canvas.addEventListener('pointermove', (ev) => {
    ui.hover = toCell(canvas, game.state.map, ev);
    // ドラッグ配置: 新しいマスに入るたびに設置を試みる（失敗理由は表示しない）
    if (dragging && ui.hover && ui.tool && dragAllowed(ui.tool) && !ui.spellTarget) {
      if (!lastDragCell || lastDragCell.x !== ui.hover.x || lastDragCell.y !== ui.hover.y) {
        lastDragCell = ui.hover;
        const r = tryPlace(ui.hover);
        if (r.ok) { dragPlaced = true; onResult(r); }
      }
    }
  });
  canvas.addEventListener('pointerleave', () => {
    ui.hover = null;
  });
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    dragPlaced = false;
    lastDragCell = toCell(canvas, game.state.map, ev);
    ui.hover = lastDragCell; // タッチでは move が来ないことがあるので、押した位置をホバー扱いにする
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* 古いブラウザ */ }
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
    lastDragCell = null;
  });
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ui.tool = null;       // 右クリックで選択解除
    ui.selected = null;
    ui.spellTarget = null;
    onResult(null);
  });
  canvas.addEventListener('click', (ev) => {
    const cell = toCell(canvas, game.state.map, ev);
    if (!cell) return;
    if (dragPlaced) { dragPlaced = false; return; } // ドラッグで置いた直後の click は無視
    const state = game.state;

    // 魔法の着弾指定
    if (ui.spellTarget) {
      onCommand('castSpell', [ui.spellTarget.id, cell.x + 0.5, cell.y + 0.5]);
      const r = castSpell(state, ui.spellTarget.id, cell.x + 0.5, cell.y + 0.5);
      if (r.ok) r.text = `${ui.spellTarget.name}！`;
      ui.spellTarget = null;
      onResult(r);
      return;
    }

    const tower = state.towers.find((t) => t.x === cell.x && t.y === cell.y);
    if (ui.tool === 'sell') {
      if (!tower) { onResult(sellTower(state, cell.x, cell.y)); return; }
      if (tower.invested > INSTANT_SELL_MAX) {
        // 高価な建物は誤クリック防止のため、選択して売却ボタンで確定する
        ui.selected = { x: cell.x, y: cell.y };
        onResult({ ok: false, reason: `投資額 ${tower.invested} の建物です。パネルの「売却」ボタンで確定してください` });
        return;
      }
      onCommand('sellTower', [cell.x, cell.y]);
      const result = sellTower(state, cell.x, cell.y);
      if (result.ok) result.text = `売却しました（+${result.refund}）`;
      ui.selected = null;
      onResult(result);
      return;
    }
    if (tower) {
      // 既存の建物をクリック → 選択（強化・売却パネルに表示）
      ui.selected = { x: cell.x, y: cell.y };
      onResult(null);
      return;
    }
    if (!ui.tool) {
      ui.selected = null;
      return;
    }
    onResult(tryPlace(cell));
  });
}
