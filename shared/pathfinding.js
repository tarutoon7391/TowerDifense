// 経路探索: ゴールからの幅優先探索（BFS）で距離マップ（フローフィールド）を作る
// 敵は「距離が1小さい隣接マス」へ進めば必ず最短経路でゴールに着く
// マップサイズはステージごとに違うので map（cols/rows/start/goal）を引数で受け取る
import { CELL_EMPTY } from './config.js';

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

// grid（0:空き, それ以外:障害物）からゴール基準の距離配列を返す。到達不能マスは -1
export function computeFlowField(grid, map) {
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
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (grid[ni] !== CELL_EMPTY || dist[ni] !== -1) continue;
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

// あるマスから次に進むべき候補マス（距離が1小さい隣接マス）をすべて返す
export function nextCells(flow, map, x, y) {
  const here = flow[y * map.cols + x];
  const out = [];
  if (here <= 0) return out;
  for (const d of DIRS) {
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
    if (flow[ny * map.cols + nx] === here - 1) out.push({ x: nx, y: ny });
  }
  return out;
}

// スタート→ゴールの最短経路（表示用）。到達不能なら空配列
export function computePath(flow, map) {
  if (!isReachable(flow, map)) return [];
  const start = map.start;
  const path = [{ x: start.x, y: start.y }];
  let cur = start;
  while (flow[cur.y * map.cols + cur.x] > 0) {
    const nexts = nextCells(flow, map, cur.x, cur.y);
    if (nexts.length === 0) break;
    cur = nexts[0]; // 表示用なので先頭を採用（決定的）
    path.push(cur);
  }
  return path;
}
