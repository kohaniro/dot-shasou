# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「ドット車窓」: 電車のロングシート中央から、向かいの窓を流れるランダム生成の景色を眺めるだけの静的 Web サイト。HTML + Canvas 2D + 素の JavaScript（ビルド不要の ES Modules）、サーバー・画像素材なし（すべてコードで描画）。

**作業前に `HANDOFF.md` を読むこと**。決定済みの方針（§1）、座標の目安（§2）、ロードマップ（§5, §6）はそこが正。§6-1（分割と倍率コードの削除）は完了済みで、次は §6-2（`world.js` のバイオーム化）。

`prototype.html` は分割前の1ファイル版。比較の基準として残してあるので編集しない。

## 実行・確認

- ビルド・リンタ・テストは無い。ES Modules は `file://` では読めないため、確認用サーバー経由で開く: `http://localhost:8000/`（`index.html`）、`http://localhost:8000/prototype.html`（基準）。
- サーバーは `.claude/settings.json` の Stop フックが応答の終わりごとに起動を確認する（すでに動いていれば何もしない）。手動では `node .claude/skills/serve/serve.mjs --detach` / `--stop`（`serve` スキル）。キャッシュ無効なので、編集後はブラウザの再読み込みだけで反映される。
- 路線（乱数シード）は URL ハッシュ `#line-1234` で固定できる。同じシードなら同じ景色になるので、表示の比較・回帰確認に使う。
- 変更のたびに **4つの絵柄（写実 / 淡彩 / ゲーム風16色 / モノクロ4色）すべてで表示が崩れないこと**を確認する。
- 見た目を変えないリファクタリングは、ヘッドレス Chrome で `performance.now` / `requestAnimationFrame` / `Math.random` を差し替えて固定ステップで進め、キャンバスのハッシュを変更前後で比べると確実（分割時はこの方法で `prototype.html` と一致を確認した）。
- 設定は `localStorage`（`shasou-vol`, `shasou-style`, `shasou-pass`）に保存される。

## アーキテクチャの要点（複数箇所にまたがる仕組み）

- **モジュールの依存方向**: `state.js`（何も import しない。画面寸法の定数と共有の可変状態 `state`）← `rng.js` ← `world.js` / `palette.js` ← `layers.js` ← `scenery/*` ← `scenery/index.js`（レイヤーの実体 `layers`）← `ui.js` ← `main.js`。循環 import を作らないこと。`ui.js` は `main.js` を import せず、`render` / `rebuild` は `initUI(render, rebuild)` で受け取る。
- **共有状態の書き換え**: `seed`・`dist`・`t`・`speed` などは `state.xxx` として読み書きする。`STYLE`（`palette.js`）と音の状態（`audio.js`）は `export let` なので、外からは `setStyle()` / `setSoundOn()` / `setVolume()` 経由で変える。
- **決定的生成**: `hash32(a,b,c)` + `rng(seed)`（mulberry32）。景色はシード×チャンク番号から決定的に作るので、生成コードで `Math.random()` を使わないこと（新シードの選択と音のノイズ生成のみ例外）。既存の生成コードに手を入れるときは、乱数の呼び出し順・回数が変わると同じシードの景色が変わる点に注意。
- **視差レイヤー `Layer`**: 横 256 ドットのチャンクを生成してキャッシュし、視差係数でスクロール。雲 0.012 / 遠景 0.09 / 中景 0.28 / 近景 0.6 / 線路際 1.0 / 架線 1.2（架線だけ `main.js` の `render()` で毎フレーム直接描画）。シード変更時は `setSeed()`（`ui.js`）、絵柄変更時は `rebuild()`（`main.js`）で全キャッシュを破棄する。
- **都市度 `density(d)`**（`world.js`）: 走行距離→0〜1。近景の建物種別（3段階）を決める。バイオーム化の出発点。
- **絵柄の仕組み**: 色はすべて `R()`（矩形描画）内で `P(color)` を通り、`STYLES[*].pal` が色を差し替える（結果は `palCache`）。**新しい描画コードも必ず `R()` か `P()` を通すこと**。直接 `fillStyle` を設定すると絵柄切り替えに追従しない。`outline`（輪郭線 `ink()`）と `glass`（窓の映り込み）も絵柄ごとのフラグ。
- **描画の重ね順**: 空 → 各レイヤー → 架線 → 車内（`drawInterior()` で別キャンバスに一度だけ描き、窓を `clearRect` で抜いたもの）→ つり革・乗客（毎フレーム描画）。
- **揺れと音の同期**: 25m レール = 250 ドット（`RAIL`）。継ぎ目を越えるたび `jointPattern()`（`main.js`）が台車ごとの `click()` 音と揺れ（`state.bobs`）を同時に予約する。揺れは半ドット・台車1つにつき1回で固定（大きくしない方針）。
- **半ドット表示 `SUB = 2`**: キャンバスを内部解像度（320×130、内部座標 y=20〜150）の2倍で持ち、景色を半ドットずらすための仕組み。残すこと。
- **表示倍率 `fit()`**: 端末ピクセルの整数倍で拡大してドットを均一に保つ。

## 既知の点（未対応）

- 音（Web Audio 合成）は耳で未確認。音量バランスの調整はユーザーに聴いてもらう必要がある。
- ガラスの映り込み（`main.js` の `render()`）だけ `fillStyle = '#ffffff'` を直接設定しており、`P()` を通っていない。
- `setSeed()` は `state.t` をリセットしない。同じシードでも、起動直後と途中で路線を切り替えた場合とで雲・つり革・乗客のしぐさの位相が異なる。
- `win()`（`palette.js`）は倍率コードの削除で `R()` と同じ中身になっている。
