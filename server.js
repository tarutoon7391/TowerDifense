// Express サーバー: public/ と shared/ を静的配信する
// ゲームロジック（shared/）はブラウザから ESM として直接 import される
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// 画面・描画コード
app.use(express.static(path.join(__dirname, 'public')));
// ゲームロジック（/shared/xxx.js で参照できる）
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// 稼働確認用
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`fantasy-maze-td: http://localhost:${PORT}`);
});
