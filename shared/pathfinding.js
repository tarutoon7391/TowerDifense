// 経路探索: ゴールからの幅優先探索（BFS）で距離マップ（フローフィールド）を作る
// 敵は「距離が1小さい隣接マス」へ進めば必ず最短経路でゴールに着く
// マップサイズはステージごとに違うので map（cols/rows/start/goal）を引数で受け取る
// portals: 転送門の組 [{ a:{x,y}, b:{x,y} }]。a に入ると b へ（逆も）飛ぶので、BFS 上は隣接扱い
import { CELL_EMPTY, CELL_FLOOR } from './config.js';

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

// 敵が通れるマスか（空き、または通れる建築＝床・罠・転送門）
export function isPassable(v) {
  return v === CELL_EMPTY || v === CELL_FLOOR;
}

// 転送門の相方（無ければ null）
export function portalPartner(portals, x, y) {
  for (const p of portals || []) {
    if (p.a.x === x && p.a.y === y) return p.b;
    if (p.b.x === x && p.b.y === y) return p.a;
  }
  return null;
}

// grid からゴール基準の距離配列を返す。到達不能マスは -1
export function computeFlowField(grid, map, portals = []) {
  const { cols, rows, goal } = map;
  const dist = new Array(cols * rows).fill(-1);
  const queue = [];
  const gi = goal.y * cols + goal.x;
  dist[gi] = 0;
  queue.push(gi);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    const neighbors = [];
    for (const d of DIRS) neighbors.push({ x: cx + d.dx, y: cy + d.dy });
    // 転送門: 相方のマスも隣接扱い（逆向きにたどるので、相方から来られる）
    const partner = portalPartner(portals, cx, cy);
    if (partner) neighbors.push(partner);
    for (const n of neighbors) {
      if (n.x < 0 || n.y < 0 || n.x >= cols || n.y >= rows) continue;
      const ni = n.y * cols + n.x;
      if (!isPassable(grid[ni]) || dist[ni] !== -1) continue;
      dist[ni] = dist[cur] + 1;
      queue.push(ni);
    }
  }
  return dist;
}

// スタートからゴールへ到達できるか
export function isReachable(flow, map) {
  return flow[map.start.y * map.cols + map.start.x] >= 0;
}

// あるマスから次に進むべき候補マス（距離が1小さい隣接マス。転送門の相方も含む）
export function nextCells(flow, map, x, y, portals = []) {
  const here = flow[y * map.cols + x];
  const out = [];
  if (here <= 0) return out;
  for (const d of DIRS) {
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
    if (flow[ny * map.cols + nx] === here - 1) out.push({ x: nx, y: ny });
  }
  const partner = portalPartner(portals, x, y);
  if (partner && flow[partner.y * map.cols + partner.x] === here - 1) out.push({ x: partner.x, y: partner.y, teleport: true });
  return out;
}

// スタート→ゴールの最短経路（表示用）。到達不能なら空配列
export function computePath(flow, map, portals = []) {
  if (!isReachable(flow, map)) return [];
  const start = map.start;
  const path = [{ x: start.x, y: start.y }];
  let cur = start;
  let guard = 0;
  while (flow[cur.y * map.cols + cur.x] > 0 && guard++ < map.cols * map.rows) {
    const nexts = nextCells(flow, map, cur.x, cur.y, portals);
    if (nexts.length === 0) break;
    cur = nexts[0]; // 表示用なので先頭を採用（決定的）
    path.push(cur);
  }
  return path;
}
