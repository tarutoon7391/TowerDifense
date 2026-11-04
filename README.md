# 迷宮の守護者（fantasy-maze-td）

ブラウザで遊べるファンタジー風・迷路建築型タワーディフェンスの MVP。
Node.js + Express + Canvas 2D。ゲームロジックは `shared/` に完全分離し、
ブラウザと Node の両方から同じコードを import できる（将来のサーバー権威化を想定）。

## 構成

```
server.js            Express: public/ と shared/ を静的配信（PORT 未設定時 3000）
shared/              ゲームロジック（ESM。DOM/Math.random/Date.now を使わない）
  config.js          マップ・タワー・敵・ウェーブ・経済の全パラメータ
  rng.js             シード付き疑似乱数（mulberry32）
  state.js           JSON 化可能なゲーム状態の生成
  pathfinding.js     ゴールからの BFS（フローフィールド）・到達判定・表示用経路
  commands.js        placeTower / sellTower / startWave（+ 副作用なしの canPlaceTower）
  simulation.js      step(state): 1tick = 1/30 秒 進める
public/              描画・入力（素の JS + ESM、外部アセットなし）
  js/main.js         rAF + 固定タイムステップのループ、HUD、ボタン配線
  js/renderer.js     Canvas 2D 描画（図形のみ）
  js/input.js        マウス入力 → コマンド呼び出し
test/                node --test によるユニットテスト
```

## ローカル起動（Windows PowerShell）

```powershell
cd $env:USERPROFILE\Desktop\fantasy-maze-td
npm install
npm test
npm start
# ブラウザで http://localhost:3000 を開く
```

ポートを変える場合:

```powershell
$env:PORT = "8080"; npm start
```

## 遊び方

- 左クリックで選択中のタワーを設置、売却モード中は売却（建設費の 50% 返金）
- 右クリック / Esc で選択解除、キー 1〜3 でタワー選択、S で売却、Space でウェーブ開始
- 敵は常にスタート→ゴールの最短経路を進む。壁で迷路を作って足止めする
- 経路を完全に塞ぐ配置、門と城の上、ウェーブ中の建築・売却はできない
- 10 ウェーブ撃退でクリア。ライフ 0 でゲームオーバー

## Railway デプロイ

- GitHub の main に push → Railway がそのままビルド・起動する
- Start Command: `npm start`（package.json の scripts.start = `node server.js`）
- PORT: Railway が注入する `process.env.PORT` をそのまま使用。手動設定不要
- Node バージョン: package.json の `engines.node` (>=20) に従う
- ビルドステップ・環境変数は不要（依存は express のみ）

## 設計上のルール

- 状態変更は `shared/commands.js` のコマンドと `simulation.step()` だけが行う
- ゲームバランスの数値は `shared/config.js` に集約し、ロジック内にハードコードしない
- `shared/` は決定的: 同じシード・同じコマンド列なら同じ結果になる（テストで検証）
