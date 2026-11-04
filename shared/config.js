// ゲームバランス・ステージ・タワー・敵・ウェーブの全パラメータ
// ロジック内に数値をハードコードせず、必ずここを参照する

// ---- 時間 ----
export const TICK_RATE = 30;          // 1秒あたりのtick数
export const DT = 1 / TICK_RATE;      // 1tickの秒数

// ---- 経済 ----
export const ECONOMY = {
  sellRefundRate: 0.5,              // 売却時の返金率（投資額に対する割合）
  waveClearBonusBase: 30,           // ウェーブクリアボーナス = base + perWave * ウェーブ番号
  waveClearBonusPerWave: 10,
  rewardHpScale: 0.5,               // 撃破報酬 = reward × (1 + rewardHpScale × (hpMul − 1))
};

// ---- アップグレード ----
// level は 1 始まり。costMul[level-1] × 建設費 が「その level にする費用」（level1 は建設費そのもの）
export const UPGRADE = {
  maxLevel: 3,
  costMul: [1, 0.8, 1.4],
  damageMul: [1, 1.5, 2.2],
  rangeAdd: [0, 0.3, 0.6],
  cooldownMul: [1, 0.9, 0.8],
  incomeMul: [1, 1.6, 2.4],
  slowFactorAdd: [0, -0.1, -0.2],   // 氷: 減速がさらに強くなる
};

// ---- グリッドの値 ----
export const CELL_EMPTY = 0;
export const CELL_TOWER = 1;
export const CELL_ROCK = 2;         // 岩: 通れない・建てられない
export const CELL_WATER = 3;        // 水: 通れない・建てられない

// ---- タワー ----
// 共通: cost, range(マス), damage, cooldown(秒), damageType('physical'|'magic')
// attack: 'homing'(追尾弾・単体) | 'splash'(範囲弾) | 'chain'(連鎖雷・即時) | 'aura'(範囲内全体・即時)
//         | 'line'(射線上を貫通・即時) | 'none'
// 敵の特性 slowResist は減速を軽減する（0.5 なら減速効果が半分）
export const TOWERS = {
  wall: {
    name: '石壁', short: '壁',
    desc: '攻撃しない安価な壁。迷路づくりの主役',
    cost: 6, attack: 'none',
  },
  archer: {
    name: 'アーチャー塔', short: '弓',
    desc: '安くて手堅い単体攻撃。物理',
    cost: 50, range: 2.6, damage: 12, cooldown: 0.6, projectileSpeed: 10,
    attack: 'homing', damageType: 'physical',
  },
  ice: {
    name: '氷の魔導塔', short: '氷',
    desc: '命中した敵を減速させる。魔法',
    cost: 70, range: 2.3, damage: 5, cooldown: 0.9, projectileSpeed: 8,
    attack: 'homing', damageType: 'magic',
    slow: { factor: 0.5, duration: 2.0 },
  },
  poison: {
    name: '毒の祭壇', short: '毒',
    desc: '命中した敵に継続ダメージ。魔法',
    cost: 90, range: 2.5, damage: 3, cooldown: 0.8, projectileSpeed: 8,
    attack: 'homing', damageType: 'magic',
    poison: { dps: 9, duration: 4.0 },
  },
  ballista: {
    name: 'バリスタ', short: '弩',
    desc: '長射程・高威力。鎧を貫通する。物理',
    cost: 120, range: 4.5, damage: 55, cooldown: 1.8, projectileSpeed: 14,
    attack: 'homing', damageType: 'physical', pierceArmor: true,
  },
  catapult: {
    name: '爆炎の投石台', short: '炎',
    desc: '着弾地点に範囲ダメージ。飛行には当たらない。物理',
    cost: 140, range: 3.6, damage: 45, cooldown: 2.4, projectileSpeed: 9,
    attack: 'splash', damageType: 'physical', splashRadius: 1.1, groundOnly: true,
    leadTarget: true,               // 目標の移動先を予測して撃つ
  },
  wind: {
    name: '風の弩', short: '風',
    desc: '対空専門。飛行に2倍、地上には半減。物理',
    cost: 110, range: 3.5, damage: 30, cooldown: 1.0, projectileSpeed: 14,
    attack: 'homing', damageType: 'physical', flyingMul: 2, groundMul: 0.5,
  },
  curse: {
    name: '呪いの塔', short: '呪',
    desc: '命中した敵の鎧を下げ、被ダメージを増やす。魔法',
    cost: 120, range: 2.6, damage: 4, cooldown: 1.0, projectileSpeed: 9,
    attack: 'homing', damageType: 'magic',
    curse: { armorReduce: 6, damageTakenMul: 1.2, duration: 3.0 },
  },
  cannon: {
    name: '魔導砲', short: '砲',
    desc: '射線上の敵をまとめて貫く。長い直線通路で真価。魔法',
    cost: 150, range: 4.0, damage: 35, cooldown: 1.5,
    attack: 'line', damageType: 'magic', lineWidth: 0.55,
  },
  lightning: {
    name: '雷の尖塔', short: '雷',
    desc: '雷が敵から敵へ連鎖する。魔法',
    cost: 160, range: 2.8, damage: 22, cooldown: 1.2,
    attack: 'chain', damageType: 'magic',
    chain: { jumps: 4, range: 1.8, decay: 0.75 },
  },
  holy: {
    name: '聖光の祭壇', short: '聖',
    desc: '射程内の全敵に光のダメージ。アンデッドに2倍。魔法',
    cost: 180, range: 2.2, damage: 10, cooldown: 0.7,
    attack: 'aura', damageType: 'magic', undeadMul: 2,
  },
  goldmine: {
    name: '金鉱', short: '金',
    desc: 'ウェーブ終了ごとにお金を産む。攻撃しない',
    cost: 60, attack: 'none', income: 10,
  },
};

// ---- 敵 ----
// hp: 基礎HP, speed: マス/秒, reward: 撃破報酬, livesCost: 到達時に失うライフ
// 特性: armor(物理ダメージを固定値で軽減), flying(迷路を無視して直進), regen(毎秒回復)
//       undead(聖光に弱い), splitInto(死亡時に分裂), boss(ボス表示)
export const ENEMIES = {
  goblin:      { name: 'ゴブリン',     hp: 40,   speed: 2.0, reward: 4,  livesCost: 1 },
  wolf:        { name: 'ウルフ',       hp: 26,   speed: 3.4, reward: 5,  livesCost: 1 },
  orc:         { name: 'オーク',       hp: 130,  speed: 1.1, reward: 12, livesCost: 1 },
  slime:       { name: 'スライム',     hp: 60,   speed: 1.5, reward: 5,  livesCost: 1,
                 splitInto: { type: 'slime_small', count: 2 } },
  slime_small: { name: '小スライム',   hp: 25,   speed: 2.2, reward: 2,  livesCost: 1 },
  bat:         { name: 'コウモリ',     hp: 16,   speed: 2.8, reward: 3,  livesCost: 1, flying: true },
  skeleton:    { name: '骸骨兵',       hp: 70,   speed: 1.6, reward: 7,  livesCost: 1, armor: 6, undead: true },
  gargoyle:    { name: 'ガーゴイル',   hp: 60,   speed: 1.8, reward: 8,  livesCost: 1, flying: true, armor: 3 },
  troll:       { name: 'トロル',       hp: 320,  speed: 0.9, reward: 20, livesCost: 2, regen: 8 },
  dark_knight: { name: '暗黒騎士',     hp: 520,  speed: 1.3, reward: 30, livesCost: 2, armor: 10, undead: true },
  demon_lord:  { name: '魔王',         hp: 3000, speed: 0.75, reward: 200, livesCost: 10,
                 armor: 8, regen: 6, boss: true, slowResist: 0.5 },
};

// 物理ダメージは鎧で軽減されるが、最低でもこの値は通る
export const COMBAT = {
  minDamage: 1,
};

// ---- ウェーブ共通 ----
export const WAVE_RULES = {
  spawnJitterTicks: 4,              // 出現タイミングのゆらぎ（tick, シード乱数）
};

// ウェーブ定義の短縮ヘルパー（データ作成用）
const g = (type, count, interval, startDelay = 0) => ({ type, count, interval, startDelay });
const w = (hpMul, ...groups) => ({ hpMul, groups });

// ---- ステージ ----
// map: cols/rows/start/goal, obstacles: 岩・水の矩形, waves: ウェーブ配列
export const STAGES = [
  {
    id: 'meadow',
    name: '草原の門',
    desc: '開けた草原。壁で迷路を作る基本を学ぼう',
    initialMoney: 150,
    initialLives: 20,
    map: { cols: 20, rows: 12, start: { x: 0, y: 5 }, goal: { x: 19, y: 5 } },
    obstacles: [],
    waves: [
      w(1.0, g('goblin', 8, 1.0)),
      w(1.1, g('goblin', 12, 0.8)),
      w(1.2, g('goblin', 10, 0.8), g('wolf', 6, 0.5, 6)),
      w(1.3, g('goblin', 14, 0.7), g('orc', 3, 2.0, 4)),
      w(1.4, g('wolf', 16, 0.45)),
      w(1.5, g('goblin', 18, 0.6), g('orc', 6, 1.8, 3)),
      w(1.6, g('wolf', 20, 0.4), g('goblin', 10, 0.6, 5)),
      w(2.2, g('orc', 10, 1.5), g('goblin', 16, 0.5, 2)),
      w(2.6, g('wolf', 24, 0.35), g('orc', 12, 1.2, 4)),
      w(3.2, g('orc', 30, 0.9), g('wolf', 10, 0.5, 10)),
    ],
  },
  {
    id: 'canyon',
    name: '渓谷の道',
    desc: '岩に挟まれた細い谷。スライムとコウモリが現れる',
    initialMoney: 180,
    initialLives: 20,
    map: { cols: 22, rows: 13, start: { x: 0, y: 6 }, goal: { x: 21, y: 6 } },
    obstacles: [
      { kind: 'rock', x: 0, y: 0, w: 22, h: 1 },
      { kind: 'rock', x: 0, y: 12, w: 22, h: 1 },
      { kind: 'rock', x: 5, y: 1, w: 2, h: 4 },
      { kind: 'rock', x: 10, y: 8, w: 2, h: 4 },
      { kind: 'rock', x: 15, y: 1, w: 2, h: 5 },
      { kind: 'rock', x: 8, y: 5, w: 1, h: 1 },
      { kind: 'rock', x: 13, y: 7, w: 1, h: 1 },
    ],
    waves: [
      w(1.0, g('goblin', 10, 0.9)),
      w(1.1, g('slime', 6, 1.5), g('goblin', 6, 0.8, 3)),
      w(1.2, g('bat', 10, 0.5), g('wolf', 6, 0.6, 4)),
      w(1.3, g('skeleton', 6, 1.2), g('goblin', 10, 0.6, 2)),
      w(1.4, g('slime', 10, 1.0), g('bat', 8, 0.5, 6)),
      w(1.5, g('orc', 6, 1.6), g('skeleton', 8, 1.0, 3)),
      w(1.6, g('wolf', 18, 0.4), g('gargoyle', 4, 1.5, 5)),
      w(1.8, g('slime', 14, 0.8), g('skeleton', 10, 0.9, 4)),
      w(2.0, g('bat', 20, 0.3), g('orc', 8, 1.4, 3)),
      w(2.3, g('skeleton', 16, 0.7), g('gargoyle', 8, 1.2, 6)),
      w(2.7, g('orc', 14, 1.0), g('slime', 12, 0.8, 2), g('bat', 12, 0.4, 8)),
      w(3.2, g('troll', 6, 3.5), g('skeleton', 20, 0.6, 2), g('gargoyle', 10, 1.0, 10)),
    ],
  },
  {
    id: 'lake',
    name: '凍てつく湖',
    desc: '湖を迂回する長い道。トロルと暗黒騎士の重装部隊',
    initialMoney: 260,
    initialLives: 20,
    map: { cols: 24, rows: 14, start: { x: 0, y: 2 }, goal: { x: 23, y: 11 } },
    obstacles: [
      { kind: 'water', x: 8, y: 4, w: 8, h: 6 },
      { kind: 'rock', x: 3, y: 9, w: 2, h: 5 },
      { kind: 'rock', x: 19, y: 0, w: 2, h: 5 },
      { kind: 'rock', x: 12, y: 0, w: 1, h: 2 },
      { kind: 'rock', x: 11, y: 12, w: 1, h: 2 },
    ],
    waves: [
      w(1.0, g('goblin', 10, 0.9)),
      w(1.1, g('goblin', 8, 0.8), g('skeleton', 5, 1.2, 4)),
      w(1.2, g('slime', 8, 1.1), g('wolf', 6, 0.6, 6)),
      w(1.3, g('bat', 8, 0.6), g('goblin', 12, 0.6, 2)),
      w(1.4, g('troll', 3, 4.0), g('wolf', 14, 0.45, 2)),
      w(1.5, g('skeleton', 14, 0.8), g('slime', 8, 1.2, 6)),
      w(1.6, g('dark_knight', 2, 5.0), g('orc', 8, 1.4, 2)),
      w(1.8, g('bat', 24, 0.3), g('gargoyle', 10, 0.9, 6)),
      w(2.0, g('troll', 6, 3.0), g('skeleton', 12, 0.8, 3)),
      w(2.2, g('orc', 16, 1.0), g('slime', 14, 0.8, 4)),
      w(2.5, g('dark_knight', 5, 3.0), g('wolf', 20, 0.4, 2)),
      w(2.8, g('gargoyle', 16, 0.7), g('troll', 6, 2.5, 5)),
      w(3.2, g('skeleton', 24, 0.5), g('dark_knight', 6, 2.5, 8)),
      w(3.4, g('troll', 8, 2.2), g('dark_knight', 6, 2.4, 6), g('bat', 20, 0.3, 15)),
    ],
  },
  {
    id: 'castle',
    name: '魔王城',
    desc: '最終決戦。あらゆる魔物の後に魔王が現れる',
    initialMoney: 320,
    initialLives: 25,
    map: { cols: 26, rows: 16, start: { x: 0, y: 8 }, goal: { x: 25, y: 8 } },
    obstacles: [
      { kind: 'rock', x: 4, y: 0, w: 1, h: 5 },
      { kind: 'rock', x: 4, y: 11, w: 1, h: 5 },
      { kind: 'rock', x: 9, y: 6, w: 3, h: 4 },
      { kind: 'water', x: 14, y: 1, w: 4, h: 3 },
      { kind: 'water', x: 14, y: 12, w: 4, h: 3 },
      { kind: 'rock', x: 20, y: 0, w: 1, h: 6 },
      { kind: 'rock', x: 20, y: 10, w: 1, h: 6 },
      { kind: 'rock', x: 16, y: 7, w: 2, h: 2 },
    ],
    waves: [
      w(1.0, g('goblin', 12, 0.8), g('wolf', 6, 0.6, 6)),
      w(1.1, g('slime', 8, 1.1), g('goblin', 8, 0.7, 4)),
      w(1.2, g('skeleton', 8, 1.0), g('bat', 8, 0.6, 5)),
      w(1.3, g('orc', 6, 1.5), g('goblin', 14, 0.5, 2), g('gargoyle', 5, 1.2, 8)),
      w(1.4, g('troll', 4, 3.5), g('slime', 12, 0.9, 2)),
      w(1.5, g('dark_knight', 3, 4.0), g('skeleton', 12, 0.8, 2)),
      w(1.6, g('wolf', 24, 0.35), g('bat', 16, 0.35, 6)),
      w(1.8, g('orc', 14, 1.0), g('gargoyle', 10, 0.9, 4)),
      w(2.0, g('troll', 6, 3.0), g('dark_knight', 4, 3.5, 4)),
      w(2.2, g('slime', 18, 0.7), g('skeleton', 16, 0.7, 4)),
      w(2.5, g('demon_lord', 1, 1, 0), g('bat', 20, 0.4, 6)),
      w(2.6, g('gargoyle', 18, 0.6), g('troll', 8, 2.5, 4)),
      w(2.9, g('dark_knight', 8, 2.5), g('orc', 20, 0.8, 3)),
      w(3.2, g('skeleton', 30, 0.45), g('troll', 10, 2.0, 6), g('bat', 20, 0.3, 14)),
      w(3.6, g('dark_knight', 12, 2.0), g('gargoyle', 20, 0.6, 6)),
      w(3.6, g('demon_lord', 1, 1, 0), g('dark_knight', 8, 2.2, 4), g('troll', 10, 2.0, 10), g('slime', 20, 0.6, 20)),
    ],
  },
];

// ステージIDから定義を引く
export function getStage(stageId) {
  return STAGES.find((s) => s.id === stageId) || STAGES[0];
}
