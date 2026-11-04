// マウス入力。状態は直接書き換えず、必ず shared/commands.js のコマンドを呼ぶ
import { placeTower, sellTower, canPlaceTower } from '/shared/commands.js';
import { layout } from './renderer.js';

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

// ホバー中マスの配置可否を更新する（毎フレーム呼ぶ。状態は読むだけ）
export function refreshHover(game, ui) {
  if (!ui.hover || !ui.tool || ui.tool === 'sell') {
    ui.hoverOk = false;
    return;
  }
  ui.hoverOk = canPlaceTower(game.state, ui.hover.x, ui.hover.y, ui.tool).ok;
}

// イベント登録。game.state を参照し、onResult(result) で結果を UI に通知する
export function bindInput(canvas, game, ui, onResult) {
  canvas.addEventListener('mousemove', (ev) => {
    ui.hover = toCell(canvas, game.state.map, ev);
  });
  canvas.addEventListener('mouseleave', () => {
    ui.hover = null;
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
    const has = state.towers.some((t) => t.x === cell.x && t.y === cell.y);

    if (ui.tool === 'sell') {
      const result = sellTower(state, cell.x, cell.y);
      if (result.ok) result.text = `売却しました（+${result.refund}）`;
      ui.selected = null;
      onResult(result);
      return;
    }
    if (has) {
      // 既存の建物をクリック → 選択（強化・売却パネルに表示）
      ui.selected = { x: cell.x, y: cell.y };
      onResult(null);
      return;
    }
    if (!ui.tool) {
      ui.selected = null;
      return;
    }
    const result = placeTower(state, cell.x, cell.y, ui.tool);
    if (result.ok) {
      result.text = '建設しました';
      ui.selected = null;
    }
    onResult(result);
  });
}
