# NEST Acoustic

長時間録音から鳥類の鳴き声候補を抽出し、山口県・季節フィルターと原音確認で判定するWebアプリ。

共有用アプリ: https://ksp-dev-jp.github.io/nest-acoustic/

## 使い方

1. 音声を選択し、録音開始日時と調査地域を確認します。
2. 「解析開始」で候補を抽出します。初回は解析モデルをダウンロードします。
3. 候補の原音を最後まで再生して、承認または却下します。
4. 「承認済み」または「全件CSV」で結果を保存します。

確認結果は同じブラウザ内に保存します。同じ音声を選び直すと再開できます。録音のアップロードや利用者間の結果共有は行いません。ブラウザのデータを消すと保存結果も消えます。

## 開発・公開

Node.js 24を使用します。

```sh
npm ci
npm run test:review
npx tsc --noEmit
npm run build:pages
npm run preview:pages
```

GitHub Pages用の出力先は `dist-pages/`。`main` へのpushで `.github/workflows/pages.yml` がビルド・公開します。PagesのSourceはGitHub Actionsです。既存Sites用の `npm run build` と `npm run dev` も使用できます。

`raw/`、`outputs/`、環境変数ファイルはGitの追跡対象外です。実録音・調査成果・認証情報を追加しないでください。

## 一時公開の終了

共有が終わったらGitHubのSettings → Pagesでサイトを非公開にし、Settings → General → Danger ZoneでリポジトリをPrivateに戻します。Public期間中に取得されたソースコードのコピーは取り消せません。

## 判定モデル

音声分類: [BirdNET Live](https://github.com/birdnet-team/birdnet-live-app) のBirdNET+ v3.0-preview3.1。地域・季節: GeoModel v3.0.4。モデルはブラウザから公式配布元へアクセスして取得します。各モデルのライセンス条件は配布元を確認してください。

候補は自動同定の確定結果ではありません。オオタカの鳴き声タイプの表示は録音時期からの区分です。
