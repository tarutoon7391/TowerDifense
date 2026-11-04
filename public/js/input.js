// マウス入力。状態は直接書き換えず、必ず shared/commands.js のコマンドを呼ぶ
import { placeTower, sellTower, canPlaceTower } from '/shared/commands.js';
import { layout } from './renderer.js';

// ドラッグ配置を許可する建物（迷路づくりの連続配置用）
const DRAG_TYPES = new Set(['wall']);
// 売却モードで即売却できる投資額の上限。これを超える建物は選択→売却ボタンで確定させる
const INSTANT_SELL_MAX = 60;

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
  if (!ui.hover || !ui.tool || ui.tool === 'sell') return;
  const r = canPlaceTower(game.state, ui.hover.x, ui.hover.y, ui.tool);
  ui.hoverOk = r.ok;
  if (r.ok) ui.hoverFlow = r.flow;
}

// イベント登録。game.state を参照し、onResult(result) で結果を UI に通知する
export function bindInput(canvas, game, ui, onResult) {
  let dragging = false;       // 左ボタンを押したままか
  let lastDragCell = null;    // ドラッグ中に最後に処理したマス

  function tryPlace(cell) {
    const result = placeTower(game.state, cell.x, cell.y, ui.tool);
    if (result.ok) {
      result.text = '建設しました';
      ui.selected = null;
    }
    return result;
  }

  canvas.addEventListener('mousemove', (ev) => {
    ui.hover = toCell(canvas, game.state.map, ev);
    // 壁のドラッグ配置: 新しいマスに入るたびに設置を試みる（失敗理由は表示しない）
    if (dragging && ui.hover && ui.tool && DRAG_TYPES.has(ui.tool)) {
      if (!lastDragCell || lastDragCell.x !== ui.hover.x || lastDragCell.y !== ui.hover.y) {
        lastDragCell = ui.hover;
        const r = tryPlace(ui.hover);
        if (r.ok) onResult(r);
      }
    }
  });
  canvas.addEventListener('mouseleave', () => {
    ui.hover = null;
  });
  canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    lastDragCell = toCell(canvas, game.state.map, ev);
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    lastDragCell = null;
  });
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ui.tool = null;       // 右クリックで選択解除
    ui.selected = null;
    onResult(null);
  });
  canvas.addEventListener('click', (ev) => {
    const cell = toCell(canvas, game.state.map, ev);
    if (!cell) return;
    const state = game.state;
    const tower = state.towers.find((t) => t.x === cell.x && t.y === cell.y);

    if (ui.tool === 'sell') {
      if (!tower) { onResult(sellTower(state, cell.x, cell.y)); return; }
      if (tower.invested > INSTANT_SELL_MAX) {
        // 高価な建物は誤クリック防止のため、選択して売却ボタンで確定する
        ui.selected = { x: cell.x, y: cell.y };
        onResult({ ok: false, reason: `投資額 ${tower.invested} の建物です。パネルの「売却」ボタンで確定してください` });
        return;
      }
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
