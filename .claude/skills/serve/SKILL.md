---
name: serve
description: ドット車窓の確認用ローカルサーバー（http://localhost:8000/）を起動・停止する。「サーバーを起動して」「ブラウザで確認したい」「サーバーを止めて」と言われたとき、または index.html をブラウザやヘッドレスブラウザで開く前に使う。
---

# 確認用サーバー

ES Modules は `file://` では読めないので、表示確認には必ずこのサーバーを使う。依存なしの Node スクリプトで、このスキルと同じフォルダにある。

```bash
node .claude/skills/serve/serve.mjs --detach   # 裏で起動（すでに動いていれば何もしない）
node .claude/skills/serve/serve.mjs --stop     # 止める
```

- URL: `http://localhost:8000/`（`index.html`）
- 路線を固定するときは `http://localhost:8000/#line-1234`
- キャッシュ無効（`Cache-Control: no-store`）なので、ファイルを直したらブラウザを再読み込みするだけで反映される
- ポートを変えるときは環境変数 `SHASOU_PORT`
- `.claude/settings.json` の Stop フックが、Claude の応答が終わるたびに `--hook` で起動を確認する。普段は手で起動しなくてよい

起動したら、ユーザーに URL を伝える。
