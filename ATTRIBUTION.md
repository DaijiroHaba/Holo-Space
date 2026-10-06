# 3D解剖モデルの出典・利用条件

HOLO / BODY v0.2 / 2026-10-05

## 必須クレジット

"BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan"

"Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0"

- BodyParts3D / DBCLS: https://lifesciencedb.jp/bp3d/
- 原データ: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
- Z-Anatomy: https://www.z-anatomy.com/
- Z-Anatomy原著者表示: https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/master/License.txt
- GLB形式の配布元: https://github.com/nqwrc/3d-anatomy
- 採用コミット: `8ca3b7421bcfbe88b85859eb1983d5cf79f21749`
- ファイル: muscular.glb、skeletal.glb、visceral.glb、cardiovascular.glb、joints.glb
- 原モデル著者: Kousaku Okubo / DBCLS。Z-Anatomy: Gauthier Kervyn、Marcin Zielinski、Lluis Vinentほか。GLB書出し・最適化配布: nqwrc/3d-anatomy。

## 非商用利用

配布元は全体を CC BY-NC-SA 4.0 として配布しています。本体験版も採用モデル群とその表示上の改変を、同条件の非商用利用に限定します。

https://creativecommons.org/licenses/by-nc-sa/4.0/

visceral.glb に含まれる腎臓の追加クレジット:
"Kidney - by lissiecowley - CC-BY-NC 4.0"

元データの条件は部品ごとに異なります。未改変の LICENSE、NOTICE、License.txt を models/anatomy/ に同梱しています。配布時にはこれらと本クレジットを保持し、改変したモデル・描画にも適用条件を保持してください。商用利用を想定する場合は対象部品の条件を別途確認してください。

神経系GLBとリンパ系GLBはダウンロード・使用していません。脳・白質・内耳に関する未確認の権利へ依存することは避けています。構造のWikipedia解説文も使用していません。

## このアプリでの変更

GLBファイル自体は配布物のままです。SHA-256と取得URLは models/anatomy/provenance.json に記録しています。

実行時に次の表示変更を行います。
- 部品の親子関係を平坦化。ただしワールド変換を保持し、位置関係を変えません。
- 全システム共通の中心・縮尺で画面へ収めます。部品ごとの別々の正規化は行いません。
- 筋・骨の色と照明・粗さを調整します。解剖学的形状は生成し直しません。
- 筋膜・滑液包、および大網などの包む構造の一部を非表示にして内部を見せます。ファイルから削除はしません。
- 表示モードに応じて筋、骨格、臓器・循環器を切り替えます。

個人の検査画像ではなく、参照解剖モデルです。臨床診断・治療・姿勢矯正を目的としません。

## ソフトウェア

Three.js r160 / MIT: https://github.com/mrdoob/three.js/tree/r160

GLTFLoader、DRACOLoader、BufferGeometryUtils はr160の公式ファイルを同梱。変更は `three` のimportを既存ローカルThree.jsへ向けた点です。Draco decoderはThree.js r160の配布物をそのまま同梱しています。Three.jsのMITライセンスは vendor/THREE_LICENSE を参照。DracoはGoogleのApache-2.0ソフトウェアです。

MediaPipeと手指推定モデルは既存のローカル配布物からコピーしたものです。カメラ映像はこのPC内で処理し、3D配布元へ送信しません。
