// ゲームバランス・ステージ・タワー・敵・ウェーブの全パラメータ
// ロジック内に数値をハードコードせず、必ずここを参照する

// ---- 時間 ----
export const TICK_RATE = 30;          // 1秒あたりのtick数
export const DT = 1 / TICK_RATE;      // 1tickの秒数

// ---- 経済 ----
export const ECONOMY = {
  sellRefundRate: 0.5,              // 売却時の返金率（投資額に対する割合）。商人の宿で上書きされる
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
  slowFactorAdd: [0, -0.1, -0.2],   // 減速がさらに強くなる
  buffMul: [1, 1.5, 2.0],           // 支援効果の強さ（倍率の「上乗せ分」に掛かる）
};

// ---- 戦闘共通 ----
export const COMBAT = {
  minDamage: 1,                     // 鎧で軽減されても最低これだけは通る
  critMulDefault: 2,                // クリティカル倍率の既定値
};

// ---- グリッドの値 ----
export const CELL_EMPTY = 0;
export const CELL_TOWER = 1;
export const CELL_ROCK = 2;         // 岩: 通れない・建てられない
export const CELL_WATER = 3;        // 水: 通れない・建てられない

// ---- 建築ジャンル（UIのタブ順） ----
export const GENRES = [
  { id: 'melee',   name: '近距離', desc: '射程は短いが火力が高い。迷路の曲がり角や通路の両脇に' },
  { id: 'ranged',  name: '遠距離', desc: '広く長く届く主力。迷路全体をカバーする' },
  { id: 'support', name: '支援',   desc: '範囲内の塔を強化する。同じ効果は重複せず最大値が有効' },
  { id: 'debuff',  name: '妨害',   desc: '減速・毒・鎧低下・スタンで敵を弱らせる' },
  { id: 'special', name: '特殊',   desc: '壁や経済など、戦い方そのものを変えるお役立ち建築' },
];

// ---- タワー ----
// 共通: genre, cost, range(マス), damage, cooldown(秒), damageType('physical'|'magic')
// attack: 'homing'(追尾弾・単体) | 'splash'(範囲弾) | 'chain'(連鎖・即時) | 'aura'(範囲内全体・即時)
//         | 'line'(射線上を貫通・即時) | 'none'(攻撃しない)
// 付与効果: slow{factor,duration} poison{dps,duration} curse{armorReduce,damageTakenMul,duration}
//           stun{chance,duration} knockback{chance,cells}
// 特殊: crit{chance,mul} executeBelow ramp{perHit,max} multishot bossMul flyingMul groundMul undeadMul
//       pierceArmor leadTarget groundOnly splashRadius(homingなら着弾時に周囲へも) lineWidth chain{jumps,range,decay}
// 支援: buff{range, damageMul, rangeAdd, cooldownMul, critAdd, flyingMul, statusDurationMul, only:'physical'|'magic'}
// 経済: income incomeGrowth interest{rate,cap} livesPerWave bonusMul sellRate upgradeDiscount
//       bounty{range,gold} perTowerGold{gold,cap} previewWaves
export const TOWERS = {
  // ======== 近距離 ========
  thorn: {
    genre: 'melee', name: '茨の壁', short: '茨',
    desc: '安い壁。隣を通る地上の敵をチクチク刺す。物理',
    cost: 14, range: 1.2, damage: 3, cooldown: 0.5,
    attack: 'aura', damageType: 'physical', groundOnly: true,
  },
  spear: {
    genre: 'melee', name: '槍兵の櫓', short: '槍',
    desc: '短射程だが手数が多い。序盤の主力。物理',
    cost: 45, range: 1.5, damage: 14, cooldown: 0.45, projectileSpeed: 20,
    attack: 'homing', damageType: 'physical',
  },
  flamer: {
    genre: 'melee', name: '火炎放射器', short: '炎',
    desc: '前方の地上敵をまとめて焼き、炎上させる。魔法',
    cost: 95, range: 1.6, damage: 5, cooldown: 0.3,
    attack: 'aura', damageType: 'magic', groundOnly: true,
    poison: { dps: 6, duration: 2.0 },
  },
  blade: {
    genre: 'melee', name: '剣闘士の塔', short: '剣',
    desc: '周囲を薙ぎ払う。狭い通路で真価。物理',
    cost: 110, range: 1.4, damage: 20, cooldown: 0.6,
    attack: 'aura', damageType: 'physical',
  },
  holy: {
    genre: 'melee', name: '聖光の祭壇', short: '聖',
    desc: '射程内の全敵に光のダメージ。アンデッドに2倍。魔法',
    cost: 180, range: 2.2, damage: 10, cooldown: 0.7,
    attack: 'aura', damageType: 'magic', undeadMul: 2,
  },
  frostfield: {
    genre: 'melee', name: '氷柱の結界', short: '柱',
    desc: '周囲の敵を凍えさせ減速させる。魔法',
    cost: 120, range: 1.8, damage: 2, cooldown: 0.5,
    attack: 'aura', damageType: 'magic', slow: { factor: 0.6, duration: 1.5 },
  },
  hammer: {
    genre: 'melee', name: '衝撃槌', short: '槌',
    desc: '重い一撃で周囲を打ち、ときどき気絶させる。物理',
    cost: 160, range: 1.5, damage: 40, cooldown: 1.6,
    attack: 'aura', damageType: 'physical', stun: { chance: 0.3, duration: 0.8 },
  },
  dragonmaw: {
    genre: 'melee', name: '竜の火口', short: '竜',
    desc: '超短射程の最高火力。地上の敵を焼き尽くす。魔法',
    cost: 240, range: 1.5, damage: 18, cooldown: 0.35,
    attack: 'aura', damageType: 'magic', groundOnly: true,
    poison: { dps: 10, duration: 3.0 },
  },
  guillotine: {
    genre: 'melee', name: '処刑台', short: '刑',
    desc: 'HP25%以下の敵（ボス以外）を即死させる。物理',
    cost: 220, range: 1.8, damage: 60, cooldown: 1.4, projectileSpeed: 20,
    attack: 'homing', damageType: 'physical', executeBelow: 0.25,
  },
  scatter: {
    genre: 'melee', name: '散弾の櫓', short: '散',
    desc: '近くの敵3体を同時に撃つ。物理',
    cost: 150, range: 2.0, damage: 16, cooldown: 0.9, projectileSpeed: 16,
    attack: 'homing', damageType: 'physical', multishot: 3,
  },
  treant: {
    genre: 'melee', name: '大樹の守り手', short: '樹',
    desc: '枝の一撃で敵をときどき1マス押し戻す。物理',
    cost: 200, range: 2.0, damage: 35, cooldown: 0.8, projectileSpeed: 18,
    attack: 'homing', damageType: 'physical', knockback: { chance: 0.25, cells: 1 },
  },
  chainpull: {
    genre: 'melee', name: '鎖の塔', short: '鎖',
    desc: '鎖で敵を捕まえ、2マス引き戻す。魔法',
    cost: 140, range: 2.0, damage: 8, cooldown: 2.5, projectileSpeed: 20,
    attack: 'homing', damageType: 'magic', knockback: { chance: 1, cells: 2 },
  },

  // ======== 遠距離 ========
  archer: {
    genre: 'ranged', name: 'アーチャー塔', short: '弓',
    desc: '安くて手堅い単体攻撃。物理',
    cost: 50, range: 2.6, damage: 12, cooldown: 0.6, projectileSpeed: 10,
    attack: 'homing', damageType: 'physical',
  },
  crossbow: {
    genre: 'ranged', name: '弩兵の塔', short: '弩',
    desc: '25%でクリティカル（2倍）。物理',
    cost: 80, range: 3.2, damage: 24, cooldown: 1.0, projectileSpeed: 12,
    attack: 'homing', damageType: 'physical', crit: { chance: 0.25, mul: 2 },
  },
  wind: {
    genre: 'ranged', name: '風の弩', short: '風',
    desc: '対空専門。飛行に2倍、地上には半減。物理',
    cost: 110, range: 3.5, damage: 30, cooldown: 1.0, projectileSpeed: 14,
    attack: 'homing', damageType: 'physical', flyingMul: 2, groundMul: 0.5,
  },
  ballista: {
    genre: 'ranged', name: 'バリスタ', short: '矢',
    desc: '長射程・高威力。鎧を貫通する。物理',
    cost: 120, range: 4.5, damage: 55, cooldown: 1.8, projectileSpeed: 14,
    attack: 'homing', damageType: 'physical', pierceArmor: true,
  },
  repeater: {
    genre: 'ranged', name: '連弩', short: '連',
    desc: '毎秒5発の連射。鎧には弱い。物理',
    cost: 130, range: 2.8, damage: 9, cooldown: 0.2, projectileSpeed: 16,
    attack: 'homing', damageType: 'physical',
  },
  catapult: {
    genre: 'ranged', name: '爆炎の投石台', short: '石',
    desc: '着弾地点に範囲ダメージ。飛行には当たらない。物理',
    cost: 140, range: 3.6, damage: 45, cooldown: 2.4, projectileSpeed: 9,
    attack: 'splash', damageType: 'physical', splashRadius: 1.1, groundOnly: true, leadTarget: true,
  },
  cannon: {
    genre: 'ranged', name: '魔導砲', short: '砲',
    desc: '射線上の敵をまとめて貫く。長い直線通路で真価。魔法',
    cost: 150, range: 4.0, damage: 35, cooldown: 1.5,
    attack: 'line', damageType: 'magic', lineWidth: 0.55,
  },
  lightning: {
    genre: 'ranged', name: '雷の尖塔', short: '雷',
    desc: '雷が敵から敵へ連鎖する。魔法',
    cost: 160, range: 2.8, damage: 22, cooldown: 1.2,
    attack: 'chain', damageType: 'magic', chain: { jumps: 4, range: 1.8, decay: 0.75 },
  },
  moonbow: {
    genre: 'ranged', name: '月光の弓', short: '月',
    desc: '同じ敵を撃ち続けるほど威力が上がる（最大3倍）。魔法',
    cost: 170, range: 3.4, damage: 20, cooldown: 0.7, projectileSpeed: 14,
    attack: 'homing', damageType: 'magic', ramp: { perHit: 0.15, max: 3 },
  },
  mortar: {
    genre: 'ranged', name: '迫撃砲', short: '迫',
    desc: '超長射程の範囲砲撃。飛行には当たらない。物理',
    cost: 200, range: 5.0, damage: 70, cooldown: 3.0, projectileSpeed: 8,
    attack: 'splash', damageType: 'physical', splashRadius: 1.4, groundOnly: true, leadTarget: true,
  },
  sniper: {
    genre: 'ranged', name: '狙撃手の塔', short: '狙',
    desc: '最長射程・鎧貫通の一撃。ボスに1.5倍。物理',
    cost: 260, range: 6.0, damage: 150, cooldown: 3.5, projectileSpeed: 30,
    attack: 'homing', damageType: 'physical', pierceArmor: true, bossMul: 1.5,
  },
  meteor: {
    genre: 'ranged', name: '流星の塔', short: '星',
    desc: '隕石を落とし広範囲を焼く。飛行にも当たる。魔法',
    cost: 320, range: 4.5, damage: 120, cooldown: 4.0, projectileSpeed: 7,
    attack: 'splash', damageType: 'magic', splashRadius: 1.6, leadTarget: true,
    poison: { dps: 8, duration: 3.0 },
  },

  // ======== 支援 ========
  banner: {
    genre: 'support', name: '軍旗', short: '旗',
    desc: '周囲の塔の攻撃+10%。安い支援の入門',
    cost: 60, attack: 'none', buff: { range: 1.5, damageMul: 1.10 },
  },
  watchtower: {
    genre: 'support', name: '見張り塔', short: '見',
    desc: '周囲の塔の射程+0.5',
    cost: 90, attack: 'none', buff: { range: 1.5, rangeAdd: 0.5 },
  },
  beacon: {
    genre: 'support', name: '照明塔', short: '灯',
    desc: '周囲の塔の飛行へのダメージ+30%',
    cost: 100, attack: 'none', buff: { range: 2.0, flyingMul: 1.3 },
  },
  wardrum: {
    genre: 'support', name: '戦太鼓', short: '鼓',
    desc: '周囲の塔の攻撃間隔−15%',
    cost: 110, attack: 'none', buff: { range: 1.5, cooldownMul: 0.85 },
  },
  smithy: {
    genre: 'support', name: '鍛冶屋', short: '鍛',
    desc: '周囲の塔の攻撃+20%',
    cost: 120, attack: 'none', buff: { range: 1.5, damageMul: 1.20 },
  },
  whetstone: {
    genre: 'support', name: '砥石台', short: '砥',
    desc: '周囲の物理塔の攻撃+25%',
    cost: 140, attack: 'none', buff: { range: 2.0, damageMul: 1.25, only: 'physical' },
  },
  manawell: {
    genre: 'support', name: '魔力の泉', short: '泉',
    desc: '周囲の魔法塔の攻撃+25%',
    cost: 140, attack: 'none', buff: { range: 2.0, damageMul: 1.25, only: 'magic' },
  },
  shrine: {
    genre: 'support', name: '祈りの祠', short: '祠',
    desc: '周囲の塔のクリティカル率+10%',
    cost: 150, attack: 'none', buff: { range: 2.0, critAdd: 0.10 },
  },
  sage: {
    genre: 'support', name: '賢者の塔', short: '賢',
    desc: '周囲の塔が与える減速・毒・呪い・気絶の時間+50%',
    cost: 180, attack: 'none', buff: { range: 2.0, statusDurationMul: 1.5 },
  },
  observatory: {
    genre: 'support', name: '占星台', short: '占',
    desc: '広い範囲の塔の射程+0.8',
    cost: 200, attack: 'none', buff: { range: 3.0, rangeAdd: 0.8 },
  },
  command: {
    genre: 'support', name: '司令塔', short: '令',
    desc: '周囲の塔の攻撃+10%・射程+0.3・間隔−10%をまとめて',
    cost: 260, attack: 'none', buff: { range: 2.5, damageMul: 1.10, rangeAdd: 0.3, cooldownMul: 0.9 },
  },
  statue: {
    genre: 'support', name: '英雄像', short: '像',
    desc: 'すぐ隣の塔の攻撃+35%。置き場所が勝負',
    cost: 300, attack: 'none', buff: { range: 1.0, damageMul: 1.35 },
  },

  // ======== 妨害 ========
  mire: {
    genre: 'debuff', name: '泥沼の呪具', short: '泥',
    desc: '周囲の敵を少し遅くする安い結界。魔法',
    cost: 60, range: 1.5, damage: 0, cooldown: 0.5,
    attack: 'aura', damageType: 'magic', slow: { factor: 0.7, duration: 1.0 },
  },
  ice: {
    genre: 'debuff', name: '氷の魔導塔', short: '氷',
    desc: '命中した敵を減速させる。魔法',
    cost: 70, range: 2.3, damage: 5, cooldown: 0.9, projectileSpeed: 8,
    attack: 'homing', damageType: 'magic', slow: { factor: 0.5, duration: 2.0 },
  },
  poison: {
    genre: 'debuff', name: '毒の祭壇', short: '毒',
    desc: '命中した敵に継続ダメージ。魔法',
    cost: 90, range: 2.5, damage: 3, cooldown: 0.8, projectileSpeed: 8,
    attack: 'homing', damageType: 'magic', poison: { dps: 9, duration: 4.0 },
  },
  netter: {
    genre: 'debuff', name: '網投げ台', short: '網',
    desc: '網で敵をからめ取り気絶させる。飛行に2倍。物理',
    cost: 100, range: 2.6, damage: 4, cooldown: 1.5, projectileSpeed: 12,
    attack: 'homing', damageType: 'physical', stun: { chance: 0.5, duration: 0.6 }, flyingMul: 2,
  },
  curse: {
    genre: 'debuff', name: '呪いの塔', short: '呪',
    desc: '命中した敵の鎧を下げ、被ダメージを増やす。魔法',
    cost: 120, range: 2.6, damage: 4, cooldown: 1.0, projectileSpeed: 9,
    attack: 'homing', damageType: 'magic', curse: { armorReduce: 6, damageTakenMul: 1.2, duration: 3.0 },
  },
  weaken: {
    genre: 'debuff', name: '弱体の瘴気', short: '瘴',
    desc: '周囲の敵全員の鎧を下げ、被ダメージを増やす。魔法',
    cost: 130, range: 2.0, damage: 0, cooldown: 0.6,
    attack: 'aura', damageType: 'magic', curse: { armorReduce: 4, damageTakenMul: 1.15, duration: 2.0 },
  },
  mirror: {
    genre: 'debuff', name: '幻惑の鏡', short: '鏡',
    desc: '敵を幻で惑わせ、3マス押し戻す。魔法',
    cost: 140, range: 2.5, damage: 5, cooldown: 2.0, projectileSpeed: 20,
    attack: 'homing', damageType: 'magic', knockback: { chance: 1, cells: 3 },
  },
  blizzard: {
    genre: 'debuff', name: '吹雪の塔', short: '吹',
    desc: '広い範囲の敵を減速させ続ける。魔法',
    cost: 150, range: 2.4, damage: 3, cooldown: 0.8,
    attack: 'aura', damageType: 'magic', slow: { factor: 0.5, duration: 2.0 },
  },
  plague: {
    genre: 'debuff', name: '疫病の祭壇', short: '疫',
    desc: '毒の霧を飛ばし、範囲内の敵をまとめて蝕む。飛行にも。魔法',
    cost: 160, range: 2.6, damage: 2, cooldown: 1.0, projectileSpeed: 8,
    attack: 'splash', damageType: 'magic', splashRadius: 1.2, poison: { dps: 7, duration: 5.0 },
  },
  freezer: {
    genre: 'debuff', name: '凍結の杖', short: '凍',
    desc: '35%で敵を1秒凍らせる。魔法',
    cost: 170, range: 2.4, damage: 6, cooldown: 1.2, projectileSpeed: 12,
    attack: 'homing', damageType: 'magic', stun: { chance: 0.35, duration: 1.0 },
  },
  corrode: {
    genre: 'debuff', name: '腐食の霧', short: '腐',
    desc: '周囲の敵の鎧を大きく溶かす。魔法',
    cost: 190, range: 1.8, damage: 2, cooldown: 0.5,
    attack: 'aura', damageType: 'magic', curse: { armorReduce: 10, damageTakenMul: 1.0, duration: 3.0 },
  },
  gravity: {
    genre: 'debuff', name: '重力の塔', short: '重',
    desc: '周囲の敵を強く減速。飛行も地面に引きずり下ろす。魔法',
    cost: 220, range: 2.2, damage: 4, cooldown: 0.5,
    attack: 'aura', damageType: 'magic', slow: { factor: 0.4, duration: 1.0 }, flyingMul: 2,
  },

  // ======== 特殊 ========
  wall: {
    genre: 'special', name: '石壁', short: '壁',
    desc: '攻撃しない安価な壁。迷路づくりの主役',
    cost: 6, attack: 'none',
  },
  pillar: {
    genre: 'special', name: '門柱', short: '門',
    desc: '壁として使え、すぐ隣の塔の射程+0.2',
    cost: 25, attack: 'none', buff: { range: 1.0, rangeAdd: 0.2 },
  },
  goldmine: {
    genre: 'special', name: '金鉱', short: '金',
    desc: 'ウェーブ終了ごとに収入。攻撃しない',
    cost: 60, attack: 'none', income: 10,
  },
  market: {
    genre: 'special', name: '市場', short: '市',
    desc: 'ウェーブ終了時に所持金の5%の利息（上限60）',
    cost: 80, attack: 'none', interest: { rate: 0.05, cap: 60 },
  },
  seedling: {
    genre: 'special', name: '魔法の苗木', short: '苗',
    desc: '収入が毎ウェーブ+3ずつ育つ。早く植えるほど得',
    cost: 90, attack: 'none', income: 2, incomeGrowth: 3,
  },
  bounty: {
    genre: 'special', name: '賞金首の掲示板', short: '賞',
    desc: '周囲で倒した敵1体につき+3ゴールド',
    cost: 100, attack: 'none', bounty: { range: 2.5, gold: 3 },
  },
  balloon: {
    genre: 'special', name: '偵察気球', short: '球',
    desc: '次の3ウェーブ分の敵構成が見える',
    cost: 50, attack: 'none', previewWaves: 3,
  },
  fountain: {
    genre: 'special', name: '祈りの泉', short: '癒',
    desc: 'ウェーブ終了ごとにライフ+1（初期値まで）',
    cost: 150, attack: 'none', livesPerWave: 1,
  },
  inn: {
    genre: 'special', name: '商人の宿', short: '宿',
    desc: '建っている間、売却の返金率が70%になる',
    cost: 120, attack: 'none', sellRate: 0.7,
  },
  barracks: {
    genre: 'special', name: '練兵場', short: '練',
    desc: '建っている間、強化費用が20%引き',
    cost: 160, attack: 'none', upgradeDiscount: 0.8,
  },
  alchemy: {
    genre: 'special', name: '錬金炉', short: '錬',
    desc: 'ウェーブ終了時に建物1つにつき+2ゴールド（上限80）',
    cost: 180, attack: 'none', perTowerGold: { gold: 2, cap: 80 },
  },
  treasury: {
    genre: 'special', name: '宝物庫', short: '宝',
    desc: 'ウェーブクリアボーナスが1.5倍',
    cost: 220, attack: 'none', bonusMul: 1.5,
  },
};

// ジャンル別のタワーID一覧（定義順）
export function towersByGenre(genreId) {
  return Object.keys(TOWERS).filter((k) => TOWERS[k].genre === genreId);
}

// ---- 敵 ----
// hp: 基礎HP, speed: マス/秒, reward: 撃破報酬, livesCost: 到達時に失うライフ
// 特性: armor(物理ダメージを固定値で軽減), flying(迷路を無視して直進), regen(毎秒回復)
//       undead(聖光に弱い), splitInto(死亡時に分裂), boss(ボス表示), slowResist(減速を軽減)
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
