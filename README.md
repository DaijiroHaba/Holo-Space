# HOLO / SPACE
Webカメラの手で3D解剖模型を扱う教育用体験アプリ。公開版 v0.11。

**[体験URL](https://daijirohaba.github.io/Holo-Space/) · [操作ガイド](https://daijirohaba.github.io/Holo-Space/guide.html)**

1. カメラ開始→開いた手を3秒→模型のアイコンを1回タップ。
2. 両掌を約0.7秒静止→発光している掌で回転。
3. 操作掌をこぶしにして固定。回転中の担当手のつまみは別操作を開始しません。
4. 指を開いて片手ずつつまむ→角度を保って移動・拡大。
5. 離して配置→両掌を再び保持して回転。
固定後、直接再回転する場合は両手を一度軽く握ってから開くか、掌モードをタップします。
回転中にアイコンを操作するときは掌を静止し、もう片手でタップしてください。

通常1体、3体比較は任意。自由回転を含む両手操作は別モード。浮遊パネルと操作パレットも個別に配置できます。
最新版はHAND INTERACTION · 11。古い表示ならCtrl＋F5。

PCのChrome/Edgeとカメラ許可が必要。カメラなしでもマウスで体験可能。
ローカル起動は node server.mjs または START.cmd。npm test は合成単体テスト72件。依存資産は同梱済み。

[操作仕様](OPERATION_SPEC.md) / [更新と確認範囲](docs/更新記録.md) / [出典](ATTRIBUTION.md)
実カメラの認識率・操作感・端から端までの遅延は未確認。カメラ映像を録画・送信する機能はありません。

解剖モデルを含む体験版は非商用。アプリ固有コードはMIT、第三者素材は各ライセンス。MITは解剖モデルの利用条件を変更しません。
BodyParts3D / DBCLS: CC-BY-SA 2.1 Japan。Z-Anatomy: CC-BY-SA 4.0。Kidney by lissiecowley: CC-BY-NC 4.0。
詳細はATTRIBUTION.mdとTHIRD_PARTY_NOTICES.mdを参照してください。
