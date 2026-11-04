// ゲームバランス・マップ・タワー・敵・ウェーブの全パラメータ
// ロジック内に数値をハードコードせず、必ずここを参照する

// ---- 時間 ----
export const TICK_RATE = 30;          // 1秒あたりのtick数
export const DT = 1 / TICK_RATE;      // 1tickの秒数

// ---- マップ ----
// 座標はマス単位。左端中央がスタート（魔物の門）、右端中央がゴール（城）
export const MAP = {
  cols: 20,
  rows: 12,
  start: { x: 0, y: 5 },
  goal: { x: 19, y: 5 },
};

// ---- 経済 ----
export const ECONOMY = {
  initialMoney: 150,
  initialLives: 20,
  sellRefundRate: 0.5,              // 売却時の返金率（建設費に対する割合）
  waveClearBonusBase: 30,           // ウェーブクリアボーナス = base + perWave * ウェーブ番号
  waveClearBonusPerWave: 10,
};

// ---- タワー ----
// range: 射程（マス）, damage: 1発のダメージ, cooldown: 攻撃間隔（秒）
// projectileSpeed: 弾速（マス/秒）
export const TOWERS = {
  archer: {
    name: 'アーチャー塔',
    cost: 50,
    range: 2.6,
    damage: 12,
    cooldown: 0.6,
    projectileSpeed: 10,
    kind: 'homing',                 // 追尾弾・単体攻撃
  },
  ice: {
    name: '氷の魔導塔',
    cost: 70,
    range: 2.3,
    damage: 5,
    cooldown: 0.9,
    projectileSpeed: 8,
    kind: 'homing',
    slow: { factor: 0.5, duration: 2.0 },  // 命中した敵の速度倍率と持続秒
  },
  catapult: {
    name: '爆炎の投石台',
    cost: 140,
    range: 3.6,
    damage: 45,
    cooldown: 2.4,
    projectileSpeed: 5,
    kind: 'splash',                 // 着弾地点に範囲ダメージ
    splashRadius: 1.1,
  },
};

// ---- 敵 ----
// hp: 基礎HP, speed: 移動速度（マス/秒）, reward: 撃破報酬
export const ENEMIES = {
  goblin: { name: 'ゴブリン', hp: 40,  speed: 2.0, reward: 4 },
  wolf:   { name: 'ウルフ',   hp: 26,  speed: 3.4, reward: 5 },
  orc:    { name: 'オーク',   hp: 130, speed: 1.1, reward: 12 },
};

// ---- ウェーブ ----
// groups: 出現グループ。startDelay 秒後から interval 秒間隔で count 体出す
// hpMul: このウェーブの敵HP倍率
// spawnJitterTicks: 出現タイミングのゆらぎ（tick, シード乱数で決定）
export const WAVE_RULES = {
  spawnJitterTicks: 4,
};

export const WAVES = [
  { hpMul: 1.0, groups: [{ type: 'goblin', count: 8,  interval: 1.0, startDelay: 0 }] },
  { hpMul: 1.1, groups: [{ type: 'goblin', count: 12, interval: 0.8, startDelay: 0 }] },
  { hpMul: 1.2, groups: [
      { type: 'goblin', count: 10, interval: 0.8, startDelay: 0 },
      { type: 'wolf',   count: 6,  interval: 0.5, startDelay: 6 } ] },
  { hpMul: 1.3, groups: [
      { type: 'goblin', count: 14, interval: 0.7, startDelay: 0 },
      { type: 'orc',    count: 3,  interval: 2.0, startDelay: 4 } ] },
  { hpMul: 1.4, groups: [{ type: 'wolf', count: 16, interval: 0.45, startDelay: 0 }] },
  { hpMul: 1.5, groups: [
      { type: 'goblin', count: 18, interval: 0.6, startDelay: 0 },
      { type: 'orc',    count: 6,  interval: 1.8, startDelay: 3 } ] },
  { hpMul: 1.6, groups: [
      { type: 'wolf',   count: 20, interval: 0.4, startDelay: 0 },
      { type: 'goblin', count: 10, interval: 0.6, startDelay: 5 } ] },
  { hpMul: 2.2, groups: [
      { type: 'orc',    count: 10, interval: 1.5, startDelay: 0 },
      { type: 'goblin', count: 16, interval: 0.5, startDelay: 2 } ] },
  { hpMul: 2.6, groups: [
      { type: 'wolf',   count: 24, interval: 0.35, startDelay: 0 },
      { type: 'orc',    count: 12, interval: 1.2, startDelay: 4 } ] },
  // 最終ウェーブ: オークの大群
  { hpMul: 3.2, groups: [
      { type: 'orc',    count: 30, interval: 0.9, startDelay: 0 },
      { type: 'wolf',   count: 10, interval: 0.5, startDelay: 10 } ] },
];
