// Canvas 2D 描画。外部画像は使わず、すべて図形で描く
// 状態（state）は読むだけで、書き換えは一切しない
import { TOWERS, ENEMIES, CELL_ROCK, CELL_WATER, CELL_EMPTY, CELL_HILL, getStage } from '/shared/config.js';
import { PHASE } from '/shared/state.js';
import { computePath } from '/shared/pathfinding.js';
import { getTowerStats } from '/shared/towers.js';
import { effectiveStats, portalsOf } from '/shared/buffs.js';

// 1マスのピクセル数（ステージごとに main.js が設定する）
export const layout = { cell: 40 };

// タワーの表示色（種別ごと）
export const TOWER_COLORS = {
  wall:      { main: '#8d8a80', sub: '#5c5a52', accent: '#b5b1a5' },
  archer:    { main: '#8b5a2b', sub: '#5c3a17', accent: '#d9b382' },
  ice:       { main: '#7fd8f5', sub: '#3aa6c9', accent: '#e6fbff' },
  poison:    { main: '#7bbf3a', sub: '#3f6b1c', accent: '#c9ff7a' },
  ballista:  { main: '#6b4a2e', sub: '#3a2817', accent: '#c0c6cc' },
  catapult:  { main: '#e2552c', sub: '#8a2e12', accent: '#ffb347' },
  lightning: { main: '#f4e04d', sub: '#9a8a1a', accent: '#ffffff' },
  holy:      { main: '#f7e7b0', sub: '#c9a84a', accent: '#ffffff' },
  goldmine:  { main: '#caa03a', sub: '#6a5420', accent: '#ffe48a' },
  wind:      { main: '#9fd9c8', sub: '#3f8a76', accent: '#ffffff' },
  curse:     { main: '#7a3f9a', sub: '#3a1850', accent: '#d98cff' },
  cannon:    { main: '#4a5fb5', sub: '#232d60', accent: '#9fb4ff' },
};

// 敵の表示色
const ENEMY_COLORS = {
  goblin:      { body: '#5aa84a', edge: '#2d5a24' },
  wolf:        { body: '#9a9aa6', edge: '#4a4a55' },
  orc:         { body: '#3f6b3a', edge: '#1e331b' },
  slime:       { body: 'rgba(90, 200, 120, 0.85)', edge: '#2e7a4a' },
  slime_small: { body: 'rgba(120, 220, 140, 0.85)', edge: '#2e7a4a' },
  bat:         { body: '#4a3a5c', edge: '#1e1428' },
  skeleton:    { body: '#ece7d8', edge: '#6e6a5e' },
  gargoyle:    { body: '#7d7f8a', edge: '#3a3b42' },
  troll:       { body: '#7a8a4a', edge: '#3c4522' },
  dark_knight: { body: '#3a2a4a', edge: '#120a1a' },
  demon_lord:  { body: '#8a1a1a', edge: '#2a0505' },
};

// 決定的な擬似ハッシュ（草の模様の配置に使う。乱数は使わない）
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function render(ctx, state, ui) {
  const C = layout.cell;
  const { cols, rows } = state.map;
  ctx.clearRect(0, 0, cols * C, rows * C);

  drawGround(ctx, state.map);
  drawGrid(ctx, state.map);
  drawObstacles(ctx, state);
  // 通れる建築（床・罠・警鐘・転送門・開いた跳ね橋）は地面の一部として先に描く
  for (const t of state.towers) if (isFlat(t)) drawTower(ctx, t.x, t.y, t.type, 1, t.level, t);
  if (state.phase === PHASE.PREPARE) {
    // 現在の最短経路。設置プレビュー中は「置いた後の経路」を上書き表示する
    if (ui.hoverFlow) {
      drawPath(ctx, state, state.flow, 'rgba(255, 240, 180, 0.18)');
      drawPath(ctx, state, ui.hoverFlow, 'rgba(255, 255, 255, 0.7)');
    } else {
      drawPath(ctx, state, state.flow, 'rgba(255, 240, 180, 0.45)');
    }
    drawFlyingRoute(ctx, state);
  }
  drawStartGoal(ctx, state.map);
  for (const t of state.towers) if (!isFlat(t)) drawTower(ctx, t.x, t.y, t.type, 1, t.level, t);
  for (const u of state.units || []) drawUnit(ctx, u);
  for (const fx of state.effects) drawEffect(ctx, fx);
  // 地上の敵 → 弾 → 飛行の敵 の順で重ねる
  const airborne = (e) => e.flying && !(e.groundedUntil > state.waveTick);
  for (const e of state.enemies) if (!airborne(e)) drawEnemy(ctx, e, state.waveTick);
  for (const p of state.projectiles) drawProjectile(ctx, p);
  for (const e of state.enemies) if (airborne(e)) drawEnemy(ctx, e, state.waveTick);
  drawSelection(ctx, state, ui);
  drawHover(ctx, state, ui);
  if (ui.spellTarget) drawSpellTarget(ctx, ui);
}

// 地面扱いで描く建築か（通れる建築、開いた跳ね橋）
function isFlat(t) {
  return !!TOWERS[t.type].passable || (TOWERS[t.type].toggleable && t.open);
}

// 兵士ユニット（兵舎: 小さな兵、騎士団: 大きな盾）
function drawUnit(ctx, u) {
  const C = layout.cell;
  const px = u.x * C + C / 2;
  const py = u.y * C + C / 2;
  ctx.save();
  if (u.hp <= 0) {
    ctx.globalAlpha = 0.35;
  }
  const knight = u.type === 'knights';
  const r = (knight ? 11 : 7) * (C / 40);
  ctx.fillStyle = knight ? '#8ea3c4' : '#c9a86b';
  ctx.strokeStyle = '#2a2a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 盾
  ctx.fillStyle = knight ? '#3b4f7a' : '#7a4f2b';
  ctx.beginPath();
  ctx.moveTo(px + r * 0.2, py - r * 0.9);
  ctx.lineTo(px + r * 1.1, py - r * 0.6);
  ctx.lineTo(px + r * 1.1, py + r * 0.4);
  ctx.lineTo(px + r * 0.6, py + r * 1.0);
  ctx.lineTo(px + r * 0.2, py + r * 0.4);
  ctx.closePath();
  ctx.fill();
  if (u.hp > 0 && u.hp < u.maxHp) {
    const bw = 20 * (C / 40);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(px - bw / 2, py - r - 8, bw, 3);
    ctx.fillStyle = '#9fd0ff';
    ctx.fillRect(px - bw / 2, py - r - 8, bw * (u.hp / u.maxHp), 3);
  }
  ctx.restore();
}

// メテオの着弾指定カーソル
function drawSpellTarget(ctx, ui) {
  if (!ui.hover) return;
  const C = layout.cell;
  const cx = ui.hover.x * C + C / 2;
  const cy = ui.hover.y * C + C / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 120, 60, 0.9)';
  ctx.fillStyle = 'rgba(255, 120, 60, 0.18)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, ui.spellTarget.radius * C, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// 草原の地面
function drawGround(ctx, map) {
  const C = layout.cell;
  const w = map.cols * C;
  const h = map.rows * C;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#4f8f46');
  grad.addColorStop(1, '#3d7636');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(120, 190, 100, 0.55)';
  ctx.lineWidth = 1.5;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const r = hash(x, y);
      if (r < 0.35) continue;
      const px = x * C + C * 0.15 + r * C * 0.65;
      const py = y * C + C * 0.2 + hash(y, x) * C * 0.6;
      ctx.beginPath();
      ctx.moveTo(px, py + 5);
      ctx.lineTo(px + 2, py - 2);
      ctx.moveTo(px + 4, py + 5);
      ctx.lineTo(px + 5, py - 1);
      ctx.stroke();
    }
  }
}

// 石畳風のグリッド線
function drawGrid(ctx, map) {
  const C = layout.cell;
  const w = map.cols * C;
  const h = map.rows * C;
  ctx.strokeStyle = 'rgba(230, 220, 190, 0.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= map.cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * C + 0.5, 0);
    ctx.lineTo(x * C + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y <= map.rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * C + 0.5);
    ctx.lineTo(w, y * C + 0.5);
    ctx.stroke();
  }
}

// 岩と水
function drawObstacles(ctx, state) {
  const C = layout.cell;
  const { cols, rows } = state.map;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = state.grid[y * cols + x];
      if (v === CELL_ROCK) drawRock(ctx, x, y);
      else if (v === CELL_WATER) drawWater(ctx, x, y, state.grid, cols, rows);
      else if (v === CELL_HILL) drawHill(ctx, x, y);
    }
  }
  // 高台の上に建てた建物の足元にも高台を描く
  for (const t of state.towers) if (t.onHill) drawHill(ctx, t.x, t.y);
}

// 高台: 明るい土色の台地
function drawHill(ctx, x, y) {
  const C = layout.cell;
  const px = x * C;
  const py = y * C;
  ctx.fillStyle = '#9a8a5a';
  ctx.fillRect(px, py, C, C);
  ctx.fillStyle = '#b8a46a';
  ctx.fillRect(px + 3, py + 3, C - 6, C - 6);
  ctx.strokeStyle = '#6e6238';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 3.5, py + 3.5, C - 7, C - 7);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(px + 3, py + 3, C - 6, 3);
}

function drawRock(ctx, x, y) {
  const C = layout.cell;
  const px = x * C;
  const py = y * C;
  ctx.fillStyle = '#6c665c';
  ctx.fillRect(px, py, C, C);
  // ごつごつした塊
  const r = hash(x + 100, y + 100);
  ctx.fillStyle = '#8a8378';
  ctx.beginPath();
  ctx.moveTo(px + C * 0.15, py + C * 0.75);
  ctx.lineTo(px + C * 0.3, py + C * (0.3 + r * 0.15));
  ctx.lineTo(px + C * 0.55, py + C * 0.2);
  ctx.lineTo(px + C * 0.85, py + C * (0.45 - r * 0.1));
  ctx.lineTo(px + C * 0.9, py + C * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#524d45';
  ctx.beginPath();
  ctx.moveTo(px + C * 0.15, py + C * 0.75);
  ctx.lineTo(px + C * 0.9, py + C * 0.8);
  ctx.lineTo(px + C * 0.85, py + C * 0.9);
  ctx.lineTo(px + C * 0.2, py + C * 0.9);
  ctx.closePath();
  ctx.fill();
}

function drawWater(ctx, x, y, grid, cols, rows) {
  const C = layout.cell;
  const px = x * C;
  const py = y * C;
  ctx.fillStyle = '#3b78b5';
  ctx.fillRect(px, py, C, C);
  // 岸（隣が水でない辺）を明るく
  ctx.fillStyle = 'rgba(190, 230, 255, 0.55)';
  const isWater = (nx, ny) => nx >= 0 && ny >= 0 && nx < cols && ny < rows && grid[ny * cols + nx] === CELL_WATER;
  if (!isWater(x, y - 1)) ctx.fillRect(px, py, C, 3);
  if (!isWater(x, y + 1)) ctx.fillRect(px, py + C - 3, C, 3);
  if (!isWater(x - 1, y)) ctx.fillRect(px, py, 3, C);
  if (!isWater(x + 1, y)) ctx.fillRect(px + C - 3, py, 3, C);
  // さざ波
  if (hash(x + 7, y + 3) > 0.5) {
    ctx.strokeStyle = 'rgba(220, 240, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px + C * 0.25, py + C * 0.5);
    ctx.quadraticCurveTo(px + C * 0.4, py + C * 0.4, px + C * 0.55, py + C * 0.5);
    ctx.quadraticCurveTo(px + C * 0.7, py + C * 0.6, px + C * 0.8, py + C * 0.5);
    ctx.stroke();
  }
}

// 準備フェーズ中: 距離マップ flow に沿った最短経路を表示
function drawPath(ctx, state, flow, color) {
  const C = layout.cell;
  const path = computePath(flow, state.map, portalsOf(state));
  if (path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  path.forEach((c, i) => {
    const px = c.x * C + C / 2;
    const py = c.y * C + C / 2;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.restore();
}

// 次のウェーブに飛行する敵がいるとき、門→城の直線ルートを破線で示す
function drawFlyingRoute(ctx, state) {
  const def = getStage(state.stageId).waves[state.wave];
  if (!def || !def.groups.some((g) => ENEMIES[g.type]?.flying)) return;
  const C = layout.cell;
  const { start, goal } = state.map;
  ctx.save();
  ctx.strokeStyle = 'rgba(200, 180, 255, 0.55)';
  ctx.lineWidth = 3;
  ctx.setLineDash([4, 10]);
  ctx.beginPath();
  ctx.moveTo(start.x * C + C / 2, start.y * C + C / 2);
  ctx.lineTo(goal.x * C + C / 2, goal.y * C + C / 2);
  ctx.stroke();
  // 小さな翼マークをルート中央に
  const mx = ((start.x + goal.x) / 2 + 0.5) * C;
  const my = ((start.y + goal.y) / 2 + 0.5) * C;
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(200, 180, 255, 0.7)';
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx - 10, my - 6); ctx.lineTo(mx - 7, my + 1); ctx.lineTo(mx, my + 4);
  ctx.lineTo(mx + 7, my + 1); ctx.lineTo(mx + 10, my - 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// スタート（魔物の門）とゴール（城）
function drawStartGoal(ctx, map) {
  const C = layout.cell;
  {
    const px = map.start.x * C;
    const py = map.start.y * C;
    ctx.fillStyle = '#4a2f5c';
    ctx.fillRect(px + 4, py + 6, C - 8, C - 8);
    ctx.fillStyle = '#1b0f24';
    ctx.beginPath();
    ctx.arc(px + C / 2, py + C / 2 + 2, C * 0.25, Math.PI, 0);
    ctx.lineTo(px + C / 2 + C * 0.25, py + C - 4);
    ctx.lineTo(px + C / 2 - C * 0.25, py + C - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b86bff';
    ctx.beginPath();
    ctx.arc(px + C / 2, py + C / 2 + 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  {
    const px = map.goal.x * C;
    const py = map.goal.y * C;
    ctx.fillStyle = '#9b9b9b';
    ctx.fillRect(px + 4, py + C * 0.3, C - 8, C * 0.65);
    ctx.fillStyle = '#c9c9c9';
    for (let i = 0; i < 4; i++) ctx.fillRect(px + 4 + i * (C - 8) / 4 + 1, py + 6, (C - 8) / 4 - 3, 8);
    ctx.fillStyle = '#5a3b1e';
    ctx.fillRect(px + C / 2 - 5, py + C * 0.6, 10, C * 0.35);
    ctx.fillStyle = '#d33';
    ctx.beginPath();
    ctx.moveTo(px + C / 2, py + 2);
    ctx.lineTo(px + C / 2 + 9, py + 5);
    ctx.lineTo(px + C / 2, py + 8);
    ctx.closePath();
    ctx.fill();
  }
}

// タワー。alpha はプレビュー用の透明度、level でレベル表示
export function drawTower(ctx, x, y, type, alpha, level = 1, tower = null) {
  const C = layout.cell;
  const c = TOWER_COLORS[type];
  const px = x * C;
  const py = y * C;
  const cx = px + C / 2;
  const cy = py + C / 2;
  const def = TOWERS[type];
  ctx.save();
  ctx.globalAlpha = alpha;

  // 通れる建築（床・罠・警鐘・転送門）と開いた跳ね橋は平らなタイルとして描く
  if (def.passable || (def.toggleable && tower && tower.open)) {
    drawFlatTile(ctx, type, px, py, cx, cy, tower);
    ctx.restore();
    return;
  }

  if (type === 'wall' || type === 'ironwall' || type === 'drawbridge') {
    // 石積みの壁（鉄壁は暗い金属色、跳ね橋は木色）
    const wc = type === 'ironwall' ? { main: '#6f7682', sub: '#2f343c' }
      : type === 'drawbridge' ? { main: '#8a6a3a', sub: '#4a3618' } : c;
    ctx.fillStyle = wc.main;
    ctx.fillRect(px + 2, py + 2, C - 4, C - 4);
    ctx.strokeStyle = wc.sub;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, C - 4, C - 4);
    ctx.beginPath();
    ctx.moveTo(px + 2, cy); ctx.lineTo(px + C - 2, cy);
    ctx.moveTo(cx, py + 2); ctx.lineTo(cx, cy);
    ctx.moveTo(px + C * 0.25, cy); ctx.lineTo(px + C * 0.25, py + C - 2);
    ctx.moveTo(px + C * 0.75, cy); ctx.lineTo(px + C * 0.75, py + C - 2);
    ctx.stroke();
    if (type === 'ironwall') {
      ctx.fillStyle = '#c9ced6';
      for (const [ox, oy] of [[6, 6], [C - 8, 6], [6, C - 8], [C - 8, C - 8]]) ctx.fillRect(px + ox, py + oy, 3, 3);
    }
    if (type === 'drawbridge') {
      ctx.strokeStyle = '#2a2a3a';
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 4); ctx.lineTo(px + C - 4, py + C - 4);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (false) {
    // 石積みの壁
    ctx.fillStyle = c.main;
    ctx.fillRect(px + 2, py + 2, C - 4, C - 4);
    ctx.strokeStyle = c.sub;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, C - 4, C - 4);
    ctx.beginPath();
    ctx.moveTo(px + 2, cy); ctx.lineTo(px + C - 2, cy);
    ctx.moveTo(cx, py + 2); ctx.lineTo(cx, cy);
    ctx.moveTo(px + C * 0.25, cy); ctx.lineTo(px + C * 0.25, py + C - 2);
    ctx.moveTo(px + C * 0.75, cy); ctx.lineTo(px + C * 0.75, py + C - 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // 石の土台
  ctx.fillStyle = '#6e6a5e';
  ctx.fillRect(px + 3, py + 3, C - 6, C - 6);
  ctx.strokeStyle = '#3f3c34';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 3, py + 3, C - 6, C - 6);

  if (type === 'archer') {
    ctx.fillStyle = c.main;
    ctx.fillRect(px + C * 0.25, py + C * 0.3, C * 0.5, C * 0.6);
    ctx.fillStyle = c.sub;
    for (let i = 0; i < 3; i++) ctx.fillRect(px + C * 0.25 + i * C * 0.18, py + C * 0.2, C * 0.12, C * 0.15);
    ctx.fillStyle = c.accent;
    ctx.fillRect(cx - 2, py + C * 0.5, 4, C * 0.2);
  } else if (type === 'ice') {
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(cx, py + 6);
    ctx.lineTo(px + C - 10, cy);
    ctx.lineTo(cx, py + C - 6);
    ctx.lineTo(px + 10, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = c.sub;
    ctx.stroke();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(cx, py + 12);
    ctx.lineTo(cx + 5, cy);
    ctx.lineTo(cx, cy + 2);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'poison') {
    // 緑の壺と泡
    ctx.fillStyle = c.sub;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, C * 0.3, C * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, C * 0.26, C * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(cx - 6, cy - 8, 3, 0, Math.PI * 2);
    ctx.arc(cx + 5, cy - 11, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'ballista') {
    // 木の台座と鋼の弓
    ctx.fillStyle = c.main;
    ctx.fillRect(px + C * 0.2, cy - 3, C * 0.6, 6);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, C * 0.3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + C * 0.25);
    ctx.lineTo(cx, cy - C * 0.3);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(cx, cy - C * 0.38);
    ctx.lineTo(cx - 4, cy - C * 0.26);
    ctx.lineTo(cx + 4, cy - C * 0.26);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'catapult') {
    ctx.fillStyle = c.sub;
    ctx.beginPath();
    ctx.arc(cx, cy, C * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.arc(cx, cy, C * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3b2a1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 8);
    ctx.lineTo(cx + 8, cy - 8);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(cx + 8, cy - 8, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'lightning') {
    // 尖塔と稲妻マーク
    ctx.fillStyle = '#4a4a6a';
    ctx.beginPath();
    ctx.moveTo(cx, py + 5);
    ctx.lineTo(px + C - 10, py + C - 6);
    ctx.lineTo(px + 10, py + C - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(cx + 3, py + C * 0.3);
    ctx.lineTo(cx - 4, cy + 2);
    ctx.lineTo(cx + 1, cy + 2);
    ctx.lineTo(cx - 3, py + C * 0.8);
    ctx.lineTo(cx + 5, cy - 3);
    ctx.lineTo(cx, cy - 3);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'holy') {
    // 光の柱と星
    ctx.fillStyle = c.sub;
    ctx.fillRect(px + C * 0.3, py + C * 0.45, C * 0.4, C * 0.45);
    ctx.fillStyle = c.main;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 === 0 ? C * 0.3 : C * 0.12;
      const sx = cx + Math.cos(a) * r;
      const sy = py + C * 0.36 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(cx, py + C * 0.36, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'goldmine') {
    // 坑道の入口と金塊
    ctx.fillStyle = c.sub;
    ctx.beginPath();
    ctx.arc(cx, cy + 4, C * 0.3, Math.PI, 0);
    ctx.lineTo(cx + C * 0.3, py + C - 6);
    ctx.lineTo(cx - C * 0.3, py + C - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a140a';
    ctx.beginPath();
    ctx.arc(cx, cy + 6, C * 0.17, Math.PI, 0);
    ctx.lineTo(cx + C * 0.17, py + C - 6);
    ctx.lineTo(cx - C * 0.17, py + C - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.main;
    ctx.fillRect(cx - 9, py + 7, 6, 5);
    ctx.fillRect(cx + 3, py + 9, 6, 5);
    ctx.fillStyle = c.accent;
    ctx.fillRect(cx - 8, py + 8, 2, 2);
    ctx.fillRect(cx + 4, py + 10, 2, 2);
  }

  else if (type === 'wind') {
    // 風車のような三枚羽の弩
    ctx.strokeStyle = c.sub;
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * C * 0.32, cy + Math.sin(a) * C * 0.32);
      ctx.stroke();
      ctx.fillStyle = c.main;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * C * 0.22, cy + Math.sin(a) * C * 0.22, C * 0.12, C * 0.06, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'curse') {
    // 紫の塔と目玉
    ctx.fillStyle = c.sub;
    ctx.fillRect(px + C * 0.28, py + C * 0.25, C * 0.44, C * 0.65);
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(cx, py + 4);
    ctx.lineTo(px + C * 0.78, py + C * 0.3);
    ctx.lineTo(px + C * 0.22, py + C * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 3, C * 0.14, C * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0a24';
    ctx.beginPath();
    ctx.arc(cx, cy + 3, C * 0.05, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'cannon') {
    // 青い砲身と魔法陣
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, C * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = c.sub;
    ctx.beginPath();
    ctx.arc(cx, cy, C * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.main;
    ctx.fillRect(cx - 4, py + 5, 8, C * 0.45);
    ctx.fillStyle = c.accent;
    ctx.fillRect(cx - 2, py + 5, 4, 6);
  }

  else {
    drawGenericTower(ctx, type, px, py, cx, cy, c || genreColor(TOWERS[type].genre));
  }

  // レベル表示（金の点）
  if (level > 1) {
    ctx.fillStyle = '#f2c14e';
    for (let i = 0; i < level; i++) {
      ctx.beginPath();
      ctx.arc(px + C * 0.22 + i * 7, py + C - 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ジャンルごとの基本色（個別の色が無い建築に使う）
const GENRE_COLORS = {
  melee:   { main: '#c0623a', sub: '#6e3018', accent: '#ffd2b0' },
  ranged:  { main: '#5e8f5a', sub: '#2f4f2c', accent: '#d8f5c8' },
  support: { main: '#d9b34a', sub: '#7a5f1a', accent: '#fff2c0' },
  debuff:  { main: '#7f5fb8', sub: '#3d2a62', accent: '#e4d2ff' },
  special: { main: '#8d8a80', sub: '#5c5a52', accent: '#f0ede4' },
};
export function genreColor(genre) {
  return GENRE_COLORS[genre] || GENRE_COLORS.special;
}

// 個別の形を持たない建築の汎用描画: ジャンルで輪郭を変え、中央に略称を書く
function drawGenericTower(ctx, type, px, py, cx, cy, c) {
  const C = layout.cell;
  const def = TOWERS[type];
  ctx.fillStyle = c.main;
  ctx.strokeStyle = c.sub;
  ctx.lineWidth = 2;
  switch (def.genre) {
    case 'melee': {
      // 角ばった砦
      ctx.fillRect(px + C * 0.22, py + C * 0.28, C * 0.56, C * 0.6);
      ctx.strokeRect(px + C * 0.22, py + C * 0.28, C * 0.56, C * 0.6);
      ctx.fillStyle = c.sub;
      for (let i = 0; i < 3; i++) ctx.fillRect(px + C * 0.22 + i * C * 0.2, py + C * 0.2, C * 0.14, C * 0.12);
      break;
    }
    case 'ranged': {
      // 丸い台座と砲身
      ctx.beginPath();
      ctx.arc(cx, cy + C * 0.1, C * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.sub;
      ctx.fillRect(cx - 3, py + C * 0.12, 6, C * 0.4);
      break;
    }
    case 'support': {
      // 旗と竿
      ctx.fillStyle = c.sub;
      ctx.fillRect(cx - 2, py + C * 0.15, 4, C * 0.72);
      ctx.fillStyle = c.main;
      ctx.beginPath();
      ctx.moveTo(cx + 2, py + C * 0.18);
      ctx.lineTo(cx + C * 0.36, py + C * 0.3);
      ctx.lineTo(cx + 2, py + C * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'debuff': {
      // 逆三角の祭壇と煙
      ctx.beginPath();
      ctx.moveTo(px + C * 0.2, py + C * 0.3);
      ctx.lineTo(px + C * 0.8, py + C * 0.3);
      ctx.lineTo(cx, py + C * 0.88);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(cx - 5, py + C * 0.2, 3, 0, Math.PI * 2);
      ctx.arc(cx + 4, py + C * 0.15, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // 家（屋根と壁）
      ctx.fillRect(px + C * 0.24, cy, C * 0.52, C * 0.4);
      ctx.strokeRect(px + C * 0.24, cy, C * 0.52, C * 0.4);
      ctx.fillStyle = c.sub;
      ctx.beginPath();
      ctx.moveTo(px + C * 0.16, cy);
      ctx.lineTo(cx, py + C * 0.18);
      ctx.lineTo(px + C * 0.84, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
  // 略称
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  ctx.font = `bold ${Math.round(C * 0.38)}px "Yu Gothic UI", "Meiryo", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(def.short, cx, cy + C * 0.12);
  ctx.fillText(def.short, cx, cy + C * 0.12);
}

// 通れる建築の平らなタイル（床・罠・警鐘・転送門・開いた跳ね橋）
function drawFlatTile(ctx, type, px, py, cx, cy, tower) {
  const C = layout.cell;
  const def = TOWERS[type];
  const colors = {
    mudfloor: '#6b5a3a', icefloor: '#bfe8ff', holyfloor: '#f3e6b5', oilfloor: '#2d2a28',
    pitfall: '#3a2f22', landmine: '#5a5a4a', alarm: '#c9a84a', portal: '#5a2d8a', drawbridge: '#8a6a3a',
  };
  ctx.fillStyle = colors[type] || '#777';
  ctx.globalAlpha *= 0.9;
  ctx.fillRect(px + 2, py + 2, C - 4, C - 4);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 2.5, py + 2.5, C - 5, C - 5);
  // 種類ごとの印
  ctx.lineWidth = 2;
  if (type === 'icefloor') {
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px + 8, py + C - 8); ctx.lineTo(px + C - 8, py + 8);
    ctx.moveTo(px + 8, py + 12); ctx.lineTo(px + 14, py + 8);
    ctx.stroke();
  } else if (type === 'mudfloor') {
    ctx.fillStyle = '#4a3b22';
    ctx.beginPath(); ctx.ellipse(cx, cy, C * 0.3, C * 0.18, 0, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'oilfloor') {
    ctx.fillStyle = '#5a4a6a';
    ctx.beginPath(); ctx.ellipse(cx - 3, cy, C * 0.26, C * 0.14, 0.4, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'holyfloor') {
    ctx.strokeStyle = '#d9b34a';
    ctx.beginPath(); ctx.arc(cx, cy, C * 0.26, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - C * 0.3); ctx.lineTo(cx, cy + C * 0.3); ctx.moveTo(cx - C * 0.2, cy - C * 0.1); ctx.lineTo(cx + C * 0.2, cy - C * 0.1); ctx.stroke();
  } else if (type === 'pitfall') {
    ctx.fillStyle = tower && !tower.armed ? '#6a5a44' : '#120d08';
    ctx.beginPath(); ctx.ellipse(cx, cy, C * 0.3, C * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'landmine') {
    ctx.fillStyle = tower && !tower.armed ? '#3a3a2a' : '#c23';
    ctx.beginPath(); ctx.arc(cx, cy, C * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.beginPath(); ctx.arc(cx, cy, C * 0.26, 0, Math.PI * 2); ctx.stroke();
  } else if (type === 'alarm') {
    ctx.fillStyle = '#6a4a1a';
    ctx.beginPath(); ctx.moveTo(cx, cy - C * 0.28); ctx.lineTo(cx + C * 0.2, cy + C * 0.18); ctx.lineTo(cx - C * 0.2, cy + C * 0.18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe48a';
    ctx.beginPath(); ctx.arc(cx, cy + C * 0.22, 3, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'portal') {
    ctx.strokeStyle = '#d98cff';
    ctx.beginPath(); ctx.arc(cx, cy, C * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cx, cy, C * 0.17, 0, Math.PI * 2); ctx.stroke();
  } else if (type === 'drawbridge') {
    ctx.strokeStyle = '#4a3618';
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(px + 4, py + i * C / 4); ctx.lineTo(px + C - 4, py + i * C / 4); ctx.stroke(); }
  }
  void def;
}

// 敵。種類ごとに形と大きさを変え、頭上にHPバー
function drawEnemy(ctx, e, state_waveTick) {
  const C = layout.cell;
  const s = (C / 40) * (e.giant ? 1.6 : 1); // 40px 基準の倍率（巨大化は1.6倍）
  const c = ENEMY_COLORS[e.type] || { body: '#888', edge: '#333' };
  const px = e.x * C;
  let py = e.y * C;
  const grounded = e.flying && e.groundedUntil > state_waveTick;
  // 状態異常は「現在の waveTick が期限より前」のときだけ表示する
  const slowed = state_waveTick < e.slowUntil;
  const poisoned = state_waveTick < e.poisonUntil;
  const cursed = state_waveTick < e.curseUntil;
  ctx.save();

  if (e.flying && !grounded) {
    // 影を落として浮かせる
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(px, py + 6 * s, 9 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    py -= 10 * s;
  }

  ctx.lineWidth = 2;
  ctx.strokeStyle = c.edge;
  ctx.fillStyle = c.body;

  switch (e.type) {
    case 'goblin':
      circle(ctx, px, py, 9 * s);
      ctx.beginPath();
      ctx.moveTo(px - 8 * s, py - 4 * s); ctx.lineTo(px - 13 * s, py - 9 * s); ctx.lineTo(px - 5 * s, py - 8 * s);
      ctx.moveTo(px + 8 * s, py - 4 * s); ctx.lineTo(px + 13 * s, py - 9 * s); ctx.lineTo(px + 5 * s, py - 8 * s);
      ctx.fill();
      break;
    case 'wolf':
      ctx.beginPath();
      ctx.moveTo(px + 11 * s, py);
      ctx.lineTo(px - 9 * s, py - 7 * s);
      ctx.lineTo(px - 9 * s, py + 7 * s);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    case 'orc':
      circle(ctx, px, py, 13 * s);
      ctx.fillStyle = '#eee';
      ctx.fillRect(px - 5 * s, py + 3 * s, 3 * s, 5 * s);
      ctx.fillRect(px + 2 * s, py + 3 * s, 3 * s, 5 * s);
      break;
    case 'slime':
    case 'slime_small': {
      const r = (e.type === 'slime' ? 11 : 7) * s;
      ctx.beginPath();
      ctx.ellipse(px, py + r * 0.2, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(px - r * 0.35, py - r * 0.25, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bat':
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 12 * s, py - 7 * s); ctx.lineTo(px - 9 * s, py + 1 * s); ctx.lineTo(px - 4 * s, py - 2 * s);
      ctx.lineTo(px, py + 4 * s);
      ctx.lineTo(px + 4 * s, py - 2 * s); ctx.lineTo(px + 9 * s, py + 1 * s); ctx.lineTo(px + 12 * s, py - 7 * s);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(px - 3 * s, py - 1 * s, 2, 2);
      ctx.fillRect(px + 1 * s, py - 1 * s, 2, 2);
      break;
    case 'skeleton':
      circle(ctx, px, py - 2 * s, 8 * s);
      ctx.fillStyle = '#333';
      ctx.fillRect(px - 5 * s, py - 4 * s, 3 * s, 3 * s);
      ctx.fillRect(px + 2 * s, py - 4 * s, 3 * s, 3 * s);
      ctx.fillStyle = c.body;
      ctx.fillRect(px - 7 * s, py + 6 * s, 14 * s, 3 * s);
      break;
    case 'gargoyle':
      ctx.beginPath();
      ctx.moveTo(px, py - 11 * s);
      ctx.lineTo(px + 9 * s, py);
      ctx.lineTo(px, py + 9 * s);
      ctx.lineTo(px - 9 * s, py);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 8 * s, py - 2 * s); ctx.lineTo(px - 16 * s, py - 9 * s); ctx.lineTo(px - 10 * s, py + 3 * s);
      ctx.moveTo(px + 8 * s, py - 2 * s); ctx.lineTo(px + 16 * s, py - 9 * s); ctx.lineTo(px + 10 * s, py + 3 * s);
      ctx.fill();
      break;
    case 'troll':
      ctx.beginPath();
      ctx.roundRect(px - 14 * s, py - 13 * s, 28 * s, 26 * s, 8 * s);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b2b1a';
      ctx.fillRect(px - 7 * s, py - 4 * s, 4 * s, 4 * s);
      ctx.fillRect(px + 3 * s, py - 4 * s, 4 * s, 4 * s);
      break;
    case 'dark_knight':
      ctx.beginPath();
      ctx.roundRect(px - 11 * s, py - 12 * s, 22 * s, 24 * s, 4 * s);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(px - 6 * s, py - 5 * s, 4 * s, 2 * s);
      ctx.fillRect(px + 2 * s, py - 5 * s, 4 * s, 2 * s);
      ctx.strokeStyle = '#b0b0c0';
      ctx.beginPath();
      ctx.moveTo(px + 11 * s, py + 8 * s); ctx.lineTo(px + 18 * s, py - 10 * s);
      ctx.stroke();
      break;
    case 'demon_lord':
      circle(ctx, px, py, 18 * s);
      ctx.fillStyle = '#2a0505';
      ctx.beginPath();
      ctx.moveTo(px - 10 * s, py - 12 * s); ctx.lineTo(px - 16 * s, py - 26 * s); ctx.lineTo(px - 3 * s, py - 16 * s);
      ctx.moveTo(px + 10 * s, py - 12 * s); ctx.lineTo(px + 16 * s, py - 26 * s); ctx.lineTo(px + 3 * s, py - 16 * s);
      ctx.fill();
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(px - 8 * s, py - 4 * s, 5 * s, 3 * s);
      ctx.fillRect(px + 3 * s, py - 4 * s, 5 * s, 3 * s);
      break;
    case 'ogre_ram':
      // 破城槌を担いだ大柄なオーガ
      ctx.fillStyle = '#7a6a4a';
      circle(ctx, px, py, 14 * s);
      ctx.fillStyle = '#4a3a2a';
      ctx.fillRect(px - 18 * s, py - 3 * s, 36 * s, 6 * s);
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(px + 14 * s, py - 6 * s, 8 * s, 12 * s);
      break;
    case 'thief':
      // 黒ずくめ＋金袋
      ctx.fillStyle = '#2a2a33';
      circle(ctx, px, py, 8 * s);
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath(); ctx.arc(px + 9 * s, py + 4 * s, 5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(px - 4 * s, py - 2 * s, 2, 2);
      ctx.fillRect(px + 2 * s, py - 2 * s, 2, 2);
      break;
    case 'necromancer':
      // 紫のローブと杖
      ctx.fillStyle = '#4a2a6a';
      ctx.beginPath();
      ctx.moveTo(px, py - 14 * s);
      ctx.lineTo(px + 10 * s, py + 12 * s);
      ctx.lineTo(px - 10 * s, py + 12 * s);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d98cff';
      ctx.beginPath(); ctx.arc(px, py - 4 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9b27a';
      ctx.beginPath(); ctx.moveTo(px + 12 * s, py + 12 * s); ctx.lineTo(px + 12 * s, py - 14 * s); ctx.stroke();
      break;
    default:
      circle(ctx, px, py, 9 * s);
  }

  // 巨大化・着地中・油まみれの印
  if (e.giant) {
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 24 * s, 0, Math.PI * 2); ctx.stroke();
  }
  if (grounded) {
    ctx.strokeStyle = 'rgba(120, 90, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px - 10 * s, py + 12 * s); ctx.lineTo(px + 10 * s, py + 12 * s); ctx.stroke();
  }
  if (e.oilUntil > state_waveTick) ring(ctx, px, py, 13 * s, 'rgba(60, 40, 80, 0.9)');

  // スロウ中は青い輪、毒中は緑の輪、呪い中は紫の輪
  if (slowed) ring(ctx, px, py, 16 * s, 'rgba(120, 220, 255, 0.9)');
  if (poisoned) ring(ctx, px, py, 19 * s, 'rgba(150, 255, 90, 0.8)');
  if (cursed) ring(ctx, px, py, 22 * s, 'rgba(217, 140, 255, 0.8)');

  // HPバー（ボスは大きく）
  const ratio = Math.max(0, e.hp / e.maxHp);
  const bw = (e.boss ? 60 : e.type === 'troll' || e.type === 'dark_knight' ? 34 : 24) * s;
  const by = py - (e.boss ? 32 : 20) * s;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(px - bw / 2, by, bw, 4);
  ctx.fillStyle = ratio > 0.5 ? '#5ad15a' : ratio > 0.25 ? '#f2c14e' : '#e45c5c';
  ctx.fillRect(px - bw / 2, by, bw * ratio, 4);
  ctx.restore();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function ring(ctx, x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// 弾
function drawProjectile(ctx, p) {
  const C = layout.cell;
  const px = p.x * C;
  const py = p.y * C;
  ctx.save();
  if (p.towerType === 'archer') {
    ctx.strokeStyle = '#f3e3b5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (p.towerType === 'ballista') {
    ctx.strokeStyle = '#e0e6ec';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px - 5, py);
    ctx.lineTo(px + 5, py);
    ctx.stroke();
  } else if (p.towerType === 'ice') {
    glowDot(ctx, px, py, 4, '#9fe9ff', '#5fd0ff');
  } else if (p.towerType === 'poison') {
    glowDot(ctx, px, py, 4, '#b6ff6a', '#6fd13a');
  } else if (p.towerType === 'curse') {
    glowDot(ctx, px, py, 4, '#d98cff', '#7a3f9a');
  } else if (p.towerType === 'wind') {
    ctx.strokeStyle = '#dffaf2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 1.4);
    ctx.stroke();
  } else {
    glowDot(ctx, px, py, 6, '#ff7a2a', '#ffb347');
  }
  ctx.restore();
}

function glowDot(ctx, x, y, r, fill, glow) {
  ctx.fillStyle = fill;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// 演出: 連鎖雷・爆発・聖光
function drawEffect(ctx, fx) {
  const C = layout.cell;
  ctx.save();
  if (fx.kind === 'chain') {
    ctx.strokeStyle = 'rgba(255, 255, 180, 0.95)';
    ctx.shadowColor = '#f4e04d';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 3;
    ctx.beginPath();
    fx.pts.forEach(([x, y], i) => {
      const px = x * C;
      const py = y * C;
      if (i === 0) ctx.moveTo(px, py);
      else {
        // ギザギザ（決定的: 点の index で折り返し方向を決める）
        const [lx, ly] = fx.pts[i - 1];
        const mx = ((lx + x) / 2) * C + (i % 2 === 0 ? 6 : -6);
        const my = ((ly + y) / 2) * C + (i % 2 === 0 ? -6 : 6);
        ctx.lineTo(mx, my);
        ctx.lineTo(px, py);
      }
    });
    ctx.stroke();
  } else if (fx.kind === 'trap') {
    const t = 1 - fx.ttl / 12;
    ctx.strokeStyle = `rgba(255, 220, 120, ${1 - t})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fx.x * C, fx.y * C, fx.r * C * (0.5 + 0.5 * t), 0, Math.PI * 2);
    ctx.stroke();
  } else if (fx.kind === 'summon' || fx.kind === 'teleport') {
    const t = 1 - fx.ttl / 10;
    ctx.strokeStyle = fx.kind === 'summon' ? `rgba(217, 140, 255, ${1 - t})` : `rgba(255, 255, 255, ${1 - t})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(fx.x * C, fx.y * C, fx.r * C * (0.3 + 0.7 * t) * (1 - i * 0.25), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (fx.kind === 'beam') {
    const t = 1 - fx.ttl / 7;
    ctx.strokeStyle = `rgba(159, 180, 255, ${1 - t})`;
    ctx.shadowColor = '#4a5fb5';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 8 * (1 - t) + 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx.x1 * C, fx.y1 * C);
    ctx.lineTo(fx.x2 * C, fx.y2 * C);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${1 - t})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (fx.kind === 'blast') {
    const t = 1 - fx.ttl / 10;
    ctx.strokeStyle = `rgba(255, 150, 60, ${1 - t})`;
    ctx.fillStyle = `rgba(255, 110, 40, ${0.35 * (1 - t)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(fx.x * C, fx.y * C, fx.r * C * (0.4 + 0.6 * t), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (fx.kind === 'aura') {
    const t = 1 - fx.ttl / 6;
    ctx.strokeStyle = `rgba(255, 240, 180, ${1 - t})`;
    ctx.fillStyle = `rgba(255, 240, 180, ${0.2 * (1 - t)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fx.x * C, fx.y * C, fx.r * C, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// 建物の「効果範囲」を描く: 攻撃射程（白）、支援/賞金/兵士/警鐘の範囲（金）。範囲内の塔は枠で強調
function drawRanges(ctx, state, x, y, stats, color) {
  const C = layout.cell;
  const cx = x * C + C / 2;
  const cy = y * C + C / 2;
  ctx.save();
  if (stats.range && stats.attack !== 'none') {
    ctx.fillStyle = color.fill;
    ctx.strokeStyle = color.stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, stats.range * C, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const aux = stats.buff?.range ?? stats.bounty?.range ?? stats.units?.range ?? stats.alarm?.range ?? 0;
  if (aux > 0 && aux < 100) {
    ctx.fillStyle = 'rgba(242, 193, 78, 0.10)';
    ctx.strokeStyle = 'rgba(242, 193, 78, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, aux * C, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    // 範囲内の塔を強調（支援の対象が分かる）
    if (stats.buff || stats.alarm) {
      for (const o of state.towers) {
        if (o.x === x && o.y === y) continue;
        if (TOWERS[o.type].attack === 'none') continue;
        if (stats.buff?.only && stats.buff.only !== TOWERS[o.type].damageType) continue;
        if (Math.hypot(o.x - x, o.y - y) > aux) continue;
        ctx.strokeStyle = 'rgba(242, 193, 78, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x * C + 3, o.y * C + 3, C - 6, C - 6);
      }
    }
  }
  ctx.restore();
}

// 選択中の建物: 実効射程（支援込み）と枠
function drawSelection(ctx, state, ui) {
  if (!ui.selected) return;
  const C = layout.cell;
  const t = state.towers.find((tw) => tw.x === ui.selected.x && tw.y === ui.selected.y);
  if (!t) return;
  const stats = effectiveStats(state, t);
  drawRanges(ctx, state, t.x, t.y, stats, { fill: 'rgba(255, 255, 255, 0.08)', stroke: 'rgba(255, 255, 255, 0.6)' });
  ctx.save();
  ctx.strokeStyle = '#f2c14e';
  ctx.lineWidth = 3;
  ctx.strokeRect(t.x * C + 1.5, t.y * C + 1.5, C - 3, C - 3);
  // 支援を受けている塔なら、支援元を線で示す
  for (const s of state.towers) {
    const b = getTowerStats(s.type, s.level, s.branch).buff;
    if (!b || s === t || b.range > 100) continue;
    if (Math.hypot(s.x - t.x, s.y - t.y) > b.range) continue;
    ctx.strokeStyle = 'rgba(242, 193, 78, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(s.x * C + C / 2, s.y * C + C / 2);
    ctx.lineTo(t.x * C + C / 2, t.y * C + C / 2);
    ctx.stroke();
  }
  ctx.restore();
}

// マウスオーバー: 設置プレビューと射程円。配置不可なら赤
function drawHover(ctx, state, ui) {
  if (!ui.hover) return;
  const C = layout.cell;
  const { x, y } = ui.hover;
  const px = x * C;
  const py = y * C;
  const cx = px + C / 2;
  const cy = py + C / 2;
  const hasTower = state.towers.some((t) => t.x === x && t.y === y);
  ctx.save();

  if (ui.tool === 'sell') {
    ctx.fillStyle = hasTower ? 'rgba(255, 80, 80, 0.35)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(px, py, C, C);
    if (hasTower) {
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + C - 8, py + C - 8);
      ctx.moveTo(px + C - 8, py + 8); ctx.lineTo(px + 8, py + C - 8);
      ctx.stroke();
    }
  } else if (hasTower) {
    // 既存の建物の上: 選択できることを示す
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, C - 4, C - 4);
  } else if (ui.tool && TOWERS[ui.tool]) {
    const ok = ui.hoverOk;
    const stats = getTowerStats(ui.tool, 1);
    // 攻撃射程と、支援/賞金/兵士/警鐘の効果範囲（範囲内の塔は強調）
    drawRanges(ctx, state, x, y, stats, ok
      ? { fill: 'rgba(255, 255, 200, 0.12)', stroke: 'rgba(255, 255, 200, 0.7)' }
      : { fill: 'rgba(255, 80, 80, 0.12)', stroke: 'rgba(255, 80, 80, 0.8)' });
    drawTower(ctx, x, y, ui.tool, 0.6);
    void cx; void cy;
    if (!ok) {
      ctx.fillStyle = 'rgba(255, 60, 60, 0.45)';
      ctx.fillRect(px, py, C, C);
    }
  }
  ctx.restore();
}

// ステージ選択用のミニマップ（障害物と門・城だけ）
export function drawMiniMap(canvas, stage) {
  const { cols, rows, start, goal } = stage.map;
  const cell = 6;
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a8a42';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const o of stage.obstacles) {
    ctx.fillStyle = o.kind === 'water' ? '#3b78b5' : '#6c665c';
    ctx.fillRect(o.x * cell, o.y * cell, o.w * cell, o.h * cell);
  }
  ctx.fillStyle = '#b86bff';
  ctx.fillRect(start.x * cell, start.y * cell, cell, cell);
  ctx.fillStyle = '#eee';
  ctx.fillRect(goal.x * cell, goal.y * cell, cell, cell);
}

// 敵の表示名（UI用）
export function enemyName(type) {
  return ENEMIES[type]?.name ?? type;
}

export { CELL_EMPTY };
