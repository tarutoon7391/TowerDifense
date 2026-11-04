// Canvas 2D 描画。外部画像は使わず、すべて図形で描く
// 状態（state）は読むだけで、書き換えは一切しない
import { MAP, TOWERS, ENEMIES } from '/shared/config.js';
import { PHASE } from '/shared/state.js';
import { computePath } from '/shared/pathfinding.js';

export const CELL = 40; // 1マスのピクセル数

// タワーの表示色（種別ごと）
export const TOWER_COLORS = {
  archer: { main: '#8b5a2b', sub: '#5c3a17', accent: '#d9b382' },
  ice: { main: '#7fd8f5', sub: '#3aa6c9', accent: '#e6fbff' },
  catapult: { main: '#e2552c', sub: '#8a2e12', accent: '#ffb347' },
};

// 敵の表示色
const ENEMY_COLORS = {
  goblin: { body: '#5aa84a', edge: '#2d5a24' },
  wolf: { body: '#9a9aa6', edge: '#4a4a55' },
  orc: { body: '#3f6b3a', edge: '#1e331b' },
};

// 決定的な擬似ハッシュ（草の模様の配置に使う。乱数は使わない）
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function render(ctx, state, ui) {
  const w = MAP.cols * CELL;
  const h = MAP.rows * CELL;
  ctx.clearRect(0, 0, w, h);

  drawGround(ctx);
  drawGrid(ctx);
  if (state.phase === PHASE.PREPARE) drawPath(ctx, state);
  drawStartGoal(ctx);
  for (const t of state.towers) drawTower(ctx, t.x, t.y, t.type, 1);
  for (const e of state.enemies) drawEnemy(ctx, e);
  for (const p of state.projectiles) drawProjectile(ctx, p);
  drawHover(ctx, state, ui);
}

// 草原の地面
function drawGround(ctx) {
  const w = MAP.cols * CELL;
  const h = MAP.rows * CELL;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#4f8f46');
  grad.addColorStop(1, '#3d7636');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 草の模様（マスごとに決定的な位置）
  ctx.strokeStyle = 'rgba(120, 190, 100, 0.55)';
  ctx.lineWidth = 1.5;
  for (let y = 0; y < MAP.rows; y++) {
    for (let x = 0; x < MAP.cols; x++) {
      const r = hash(x, y);
      if (r < 0.35) continue;
      const px = x * CELL + 6 + r * 26;
      const py = y * CELL + 8 + hash(y, x) * 24;
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
function drawGrid(ctx) {
  const w = MAP.cols * CELL;
  const h = MAP.rows * CELL;
  ctx.strokeStyle = 'rgba(230, 220, 190, 0.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= MAP.cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL + 0.5, 0);
    ctx.lineTo(x * CELL + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y <= MAP.rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL + 0.5);
    ctx.lineTo(w, y * CELL + 0.5);
    ctx.stroke();
  }
}

// 準備フェーズ中: 現在の最短経路を薄く表示
function drawPath(ctx, state) {
  const path = computePath(state.flow);
  if (path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 240, 180, 0.45)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  path.forEach((c, i) => {
    const px = c.x * CELL + CELL / 2;
    const py = c.y * CELL + CELL / 2;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.restore();
}

// スタート（魔物の門）とゴール（城）
function drawStartGoal(ctx) {
  // 門: 紫の石アーチ
  {
    const px = MAP.start.x * CELL;
    const py = MAP.start.y * CELL;
    ctx.fillStyle = '#4a2f5c';
    ctx.fillRect(px + 4, py + 6, CELL - 8, CELL - 8);
    ctx.fillStyle = '#1b0f24';
    ctx.beginPath();
    ctx.arc(px + CELL / 2, py + CELL / 2 + 2, 10, Math.PI, 0);
    ctx.lineTo(px + CELL / 2 + 10, py + CELL - 4);
    ctx.lineTo(px + CELL / 2 - 10, py + CELL - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b86bff';
    ctx.beginPath();
    ctx.arc(px + CELL / 2, py + CELL / 2 + 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 城: 灰色の塔と城壁
  {
    const px = MAP.goal.x * CELL;
    const py = MAP.goal.y * CELL;
    ctx.fillStyle = '#9b9b9b';
    ctx.fillRect(px + 4, py + 12, CELL - 8, CELL - 14);
    ctx.fillStyle = '#c9c9c9';
    for (let i = 0; i < 4; i++) ctx.fillRect(px + 4 + i * 9, py + 6, 6, 8);
    ctx.fillStyle = '#5a3b1e';
    ctx.fillRect(px + CELL / 2 - 5, py + 24, 10, 12);
    ctx.fillStyle = '#d33';
    ctx.beginPath();
    ctx.moveTo(px + CELL / 2, py + 2);
    ctx.lineTo(px + CELL / 2 + 9, py + 5);
    ctx.lineTo(px + CELL / 2, py + 8);
    ctx.closePath();
    ctx.fill();
  }
}

// タワー。alpha はプレビュー用の透明度
export function drawTower(ctx, x, y, type, alpha) {
  const c = TOWER_COLORS[type];
  const px = x * CELL;
  const py = y * CELL;
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  // 石の土台
  ctx.fillStyle = '#6e6a5e';
  ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6);
  ctx.strokeStyle = '#3f3c34';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 3, py + 3, CELL - 6, CELL - 6);

  if (type === 'archer') {
    // 茶色の塔 + 狭間
    ctx.fillStyle = c.main;
    ctx.fillRect(px + 10, py + 12, CELL - 20, CELL - 16);
    ctx.fillStyle = c.sub;
    for (let i = 0; i < 3; i++) ctx.fillRect(px + 10 + i * 7, py + 8, 5, 6);
    ctx.fillStyle = c.accent;
    ctx.fillRect(cx - 2, py + 20, 4, 8);
  } else if (type === 'ice') {
    // 水色の結晶（ひし形）
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(cx, py + 6);
    ctx.lineTo(px + CELL - 10, cy);
    ctx.lineTo(cx, py + CELL - 6);
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
  } else {
    // 赤橙の投石台（円形台座 + 腕）
    ctx.fillStyle = c.sub;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
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
  }
  ctx.restore();
}

// 敵。種類ごとに形と大きさを変え、頭上にHPバー
function drawEnemy(ctx, e) {
  const c = ENEMY_COLORS[e.type];
  const px = e.x * CELL;
  const py = e.y * CELL;
  const slowed = e.slowFactor < 1 && e.slowUntil > 0;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c.edge;
  ctx.fillStyle = c.body;

  if (e.type === 'goblin') {
    ctx.beginPath();
    ctx.arc(px, py, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 耳
    ctx.beginPath();
    ctx.moveTo(px - 8, py - 4); ctx.lineTo(px - 13, py - 9); ctx.lineTo(px - 5, py - 8);
    ctx.moveTo(px + 8, py - 4); ctx.lineTo(px + 13, py - 9); ctx.lineTo(px + 5, py - 8);
    ctx.fill();
  } else if (e.type === 'wolf') {
    // 横長の三角形（進行方向は右向き前提で簡略化）
    ctx.beginPath();
    ctx.moveTo(px + 11, py);
    ctx.lineTo(px - 9, py - 7);
    ctx.lineTo(px - 9, py + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(px, py, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 牙
    ctx.fillStyle = '#eee';
    ctx.fillRect(px - 5, py + 3, 3, 5);
    ctx.fillRect(px + 2, py + 3, 3, 5);
  }

  // スロウ中は青い輪
  if (slowed) {
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 16, 0, Math.PI * 2);
    ctx.stroke();
  }

  // HPバー
  const ratio = Math.max(0, e.hp / e.maxHp);
  const bw = 24;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(px - bw / 2, py - 20, bw, 4);
  ctx.fillStyle = ratio > 0.5 ? '#5ad15a' : ratio > 0.25 ? '#f2c14e' : '#e45c5c';
  ctx.fillRect(px - bw / 2, py - 20, bw * ratio, 4);
  ctx.restore();
}

// 弾
function drawProjectile(ctx, p) {
  const px = p.x * CELL;
  const py = p.y * CELL;
  ctx.save();
  if (p.towerType === 'archer') {
    ctx.strokeStyle = '#f3e3b5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (p.towerType === 'ice') {
    ctx.fillStyle = '#9fe9ff';
    ctx.shadowColor = '#5fd0ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#ff7a2a';
    ctx.shadowColor = '#ffb347';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// マウスオーバー: 設置プレビューと射程円。配置不可なら赤
function drawHover(ctx, state, ui) {
  if (!ui.hover) return;
  const { x, y } = ui.hover;
  const px = x * CELL;
  const py = y * CELL;
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
  ctx.save();

  if (ui.tool === 'sell') {
    const has = state.towers.some((t) => t.x === x && t.y === y);
    ctx.fillStyle = has ? 'rgba(255, 80, 80, 0.35)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(px, py, CELL, CELL);
    if (has) {
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + CELL - 8, py + CELL - 8);
      ctx.moveTo(px + CELL - 8, py + 8); ctx.lineTo(px + 8, py + CELL - 8);
      ctx.stroke();
    }
  } else if (ui.tool && TOWERS[ui.tool]) {
    const ok = ui.hoverOk;
    const def = TOWERS[ui.tool];
    // 射程円
    ctx.fillStyle = ok ? 'rgba(255, 255, 200, 0.12)' : 'rgba(255, 80, 80, 0.12)';
    ctx.strokeStyle = ok ? 'rgba(255, 255, 200, 0.7)' : 'rgba(255, 80, 80, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, def.range * CELL, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 本体プレビュー
    drawTower(ctx, x, y, ui.tool, 0.6);
    if (!ok) {
      ctx.fillStyle = 'rgba(255, 60, 60, 0.45)';
      ctx.fillRect(px, py, CELL, CELL);
    }
  }
  ctx.restore();
}

// 敵の表示名（UI用）
export function enemyName(type) {
  return ENEMIES[type]?.name ?? type;
}
