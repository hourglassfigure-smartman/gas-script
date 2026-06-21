# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイドラインです。

## プロジェクト概要

Google Apps Script (GAS) のスクリプトを管理するリポジトリです。
スプレッドシート / ドキュメント / Gmail / カレンダー等の Google サービスを
自動化するスクリプトを格納します。

## 開発・デプロイ

- ローカルと GAS プロジェクトの同期には [clasp](https://github.com/google/clasp) を使用する。
  - `clasp push` … ローカルの変更を GAS へ反映
  - `clasp pull` … GAS 側の変更をローカルへ取得
  - `clasp open` … エディタをブラウザで開く
- `.clasp.json` には `scriptId` が含まれるため、機密扱いとし公開リポジトリにそのまま含めない。
- `appsscript.json` がマニフェスト（実行権限・タイムゾーン・依存ライブラリ）を定義する。

## コーディング規約

- ファイルは機能ごとに分割し、用途が分かる名前を付ける（例: `sendDailyReport.gs`）。
- グローバル汚染を避け、エントリポイント関数（トリガーから呼ばれる関数）を明確にする。
- API キーや個人情報をソースに直書きしない。`PropertiesService`（スクリプトプロパティ）を使う。
- 既存ファイルのスタイル（命名・コメント量・インデント）に合わせる。

## Git 運用ルール（重要）

**コードを変更するたびに、必ず GitHub にプッシュすること。**

1. コード変更を行ったら、その変更単位ごとに commit する。
2. commit したら、続けて `git push` で GitHub に反映する。
   - 変更を放置してローカルに溜め込まない。1 つの作業が完了したら push まで行う。
3. デフォルトブランチ（`main`）で直接作業する場合も、変更後は必ず push する。
4. commit メッセージは変更内容が分かるよう日本語で簡潔に書く。

```bash
git add -A
git commit -m "変更内容の要約"
git push
```

### 初回セットアップ（リポジトリ未初期化の場合）

このディレクトリはまだ Git リポジトリではないため、初回のみ以下を実行する。

```bash
git init
git branch -M main
git remote add origin <GitHub のリポジトリ URL>
git add -A
git commit -m "初回コミット"
git push -u origin main
```

> 注意: `.clasp.json` や認証情報（`.clasprc.json` 等）は `.gitignore` に追加し、
> GitHub にプッシュしないこと。
