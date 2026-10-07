# v0.16 Claude監査と指摘後の対応
2026-10-07 / CLAUDE_AUDIT_RECOMMENDED / CLAUDE_AUDIT_EXECUTED

## 監査時
1回実施。PASS_WITH_MINOR_ISSUES / COMPUTATIONAL_PASS。app.mjsとmodel.mjsを全体、createTimedTaskを確認。残るジェスチャー内部、HTML/CSS、ブラウザーテストのソース等は未確認と明記。実機の原因判定・教育効果評価ではない。監査原ログはローカルaudit内に保持。
送信はCLAUDE_FILES.mdに示すコード・仕様・合成試験20ファイル。動画・実ランドマーク・個人・研究データなし。

## 指摘と修正
1. 主Handモデルの遅延初期化で旧GPUが新CPUを上書きする競合：Hand/Pose/ROIすべてgeneration照合。旧taskはcloseし、古いpromiseが新promiseの状態も消さない。
2. UI・操作エラーをGPU失敗と誤分類：detectForVideoの復旧tryを分離。後段はinteractionErrorとして別表示し、GPU/CPU切替を起こさない。
3. CPU再準備表示が上書き：再試行中の短いメッセージを別経路で表示。
4. Poseが古いbackendのまま：手のCPU再試行でPoseも再構築し、選択backendを診断へ追加。
5. ROIの実行時エラーが継続：2連続失敗でtask解放。GPUならCPUへ、2秒の待機を入れて再構築し、毎フレームの警告反復を抑止。
自己確認でもbackend切替後の処理時間集計をリセットし、GPU/CPUが混ざった値を提示しないようにした。

## 指摘後の検証
単体88件。認識故障の合成ブラウザー14項目（監査前11）、ROI遅延・失敗4項目（監査前3）。既存操作14項目と実モデルGPU/CPU起動6項目の最終確認結果は完了報告に記載。
合成・仮想カメラの確認であり、別PCの実カメラ認識率ではない。修正後の再Claude監査はしていない。

診断文の自己確認でも、モデルが手を返したがサイズ／点の品質で採用できなかった場合を、モデル検出0と別に表示するよう補正し、合成確認を追加した。
