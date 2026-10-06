# HOLO / SPACE
カメラの前の手で、3D人体模型を呼び出し、つかみ、移動・回転・拡大できる教育用体験アプリです。v0.8。

**[体験URL](https://daijirohaba.github.io/Holo-Space/) · [操作ガイド](https://daijirohaba.github.io/Holo-Space/guide.html) · [日本語ガイド原稿](docs/操作ガイド.md)**

## 30秒で始める
1. カメラ付きPCのChrome／Edgeで体験URLを開き、「カメラで体験」を押して許可。
2. 開いた手を3秒かざし、アイコンへ指先を合わせ、親指と人差し指を1回つけて離して決定。
3. 光る枠内をつまんで保持して模型を動かし、離して配置。
4. 右側の「掌で回転」「両手で自由操作」から選択。停止・中央・メニューへは手でもマウスでも戻れます。

カメラなしでも「メニューを開く」からマウスで試せます。操作パネルの上端はつまみ／ドラッグで移動できます。

## ローカル起動
Node.jsを使用する場合：node server.mjs、http://127.0.0.1:8796/ を開く。WindowsではSTART.cmdも利用できます。
依存ファイルは同梱しており、体験用のnpm installは不要です。

## テストと確認範囲
npm test で合成単体テストを実行します。単体59件、仮想カメラ＋合成ランドマークのブラウザ37項目を確認。Claudeコード監査はPASS_WITH_MINOR_ISSUES、その後に軽微指摘2点を修正しました。実カメラの認識率・操作感・遅延は未確認です。
カメラ映像を送信・録画する機能はありません。教育・体験用の試作版であり、臨床評価用ではありません。

## ライセンスと出典
解剖モデルを含む体験版は非商用利用に限定します。[ATTRIBUTION.md](ATTRIBUTION.md) と [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。アプリ固有コードはMIT、第三者素材は各素材のライセンスに従います。MITは解剖モデルの利用条件を変更しません。

BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan
Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0
Kidney - by lissiecowley - CC-BY-NC 4.0
