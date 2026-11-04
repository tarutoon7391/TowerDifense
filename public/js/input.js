// マウス入力。状態は直接書き換えず、必ず shared/commands.js のコマンドを呼ぶ
import { MAP } from '/shared/config.js';
import { placeTower, sellTower, canPlaceTower } from '/shared/commands.js';
import { CELL } from './renderer.js';

// キャンバス座標 → マス座標（範囲外なら null）
function toCell(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor(((ev.clientX - rect.left) * scaleX) / CELL);
  const y = Math.floor(((ev.clientY - rect.top) * scaleY) / CELL);
  if (x < 0 || y < 0 || x >= MAP.cols || y >= MAP.rows) return null;
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
    ui.hover = toCell(canvas, ev);
  });
  canvas.addEventListener('mouseleave', () => {
    ui.hover = null;
  });
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ui.tool = null; // 右クリックで選択解除
    onResult(null);
  });
  canvas.addEventListener('click', (ev) => {
    const cell = toCell(canvas, ev);
    if (!cell || !ui.tool) return;
    let result;
    if (ui.tool === 'sell') {
      result = sellTower(game.state, cell.x, cell.y);
      if (result.ok) result.text = `売却しました（+${result.refund}）`;
    } else {
      result = placeTower(game.state, cell.x, cell.y, ui.tool);
      if (result.ok) result.text = '建設しました';
    }
    onResult(result);
  });
}
