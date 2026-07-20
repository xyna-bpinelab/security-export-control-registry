# Security Export Control Registry

安全保障輸出管理に関する国内外の法令、政令、省令、通達、および規制リスト（エンティティリスト等）のメタデータを一元管理し、自動追随・見える化するためのグローバルなオープンソースレジストリです。

## 概要

安全保障輸出管理（外為法、米国EAR/ITARなど）の法規・リストは極めて複雑で、国際情勢やレジームの合意を反映して頻繁に改正されます。
本プロジェクトでは、各国の公式データソースを構造化し、その更新状況を継続監視・バリデーションする基盤を構築します。将来的にグラフデータベース等と連携し、法令の依存関係や適用関係を「見える化」することを目指します。

## Webポータル

法規制・国際輸出管理レジームの一覧と、規制対象エンティティの横断検索をブラウザで行えるWebポータルを公開しています。

🔗 https://xyna-bpinelab.github.io/security-export-control-registry/

- **規制根拠情報**: 国・地域（日本／米国／中国／国際レジーム）ごとに法令・政令・省令・通達・国際輸出管理レジームの要約をカード形式で閲覧し、原典へのリンクからアクセスできます。
- **規制対象エンティティ検索**: 米国・日本・中国の規制対象エンティティ（合計約27,000件）を、チェックボックスで選択した国を横断して検索できます。カード表示／リスト表示（詳細はモーダルで確認）の切替、及び国ごとの収録件数の日次推移グラフに対応しています。

ソースは `ui/`（Vite製の静的サイト）にあり、`main` への push 時に `.github/workflows/deploy-ui.yml` が自動でビルド・GitHub Pagesへデプロイします。

```bash
# ローカルでの起動
cd ui
npm install
npm run dev
```

## ディレクトリ構造

```
security-export-control-registry/
├── README.md               # プロジェクト概要
├── CONTRIBUTING.md         # コミュニティ貢献ガイド
├── schema/                 # 共通データ構造スキーマ（JSON Schema）
│   ├── datasource-schema.json
│   ├── validate_datasources.py
│   ├── entity-schema.json
│   └── validate_entities.py
├── countries/              # 国・地域別データ（法令・リストのメタデータ）
│   ├── jp/                 # 日本（外為法、輸出令、貨物等省令、運用・役務・提出書類通達など）
│   │   └── datasources.yaml
│   ├── us/                 # 米国（EAR, ITAR, Entity List, SDNリストなど）
│   │   └── datasources.yaml
│   ├── cn/                 # 中国（出口管制法、両用物項出口管制条例、不可靠実体清单など）
│   │   └── datasources.yaml
│   └── ml/                 # 国際輸出管理レジーム（ワッセナー・NSG・MTCR・オーストラリア・グループ）
│       └── datasources.yaml
├── data/                   # 統合エンティティデータベース（掲載企業・個人等の実体データ）
│   ├── manifest.json       # 収録リストの索引（件数・更新日・出典URL）
│   ├── entity_count_history.json  # リストごとの収録件数の日次推移（UIのグラフ表示に使用）
│   └── entities/
│       ├── us.json         # 米国 Consolidated Screening List（正規化済み）
│       ├── jp.json         # 日本 外国ユーザーリスト（正規化済み）
│       └── cn.json         # 中国 不可靠実体清单・出口管制管控名单・关注名单（正規化済み）
├── scripts/
│   ├── crawler/            # 自動更新検知クローラー
│   │   ├── check_updates.py
│   │   └── requirements.txt
│   └── ingest/             # 実体データ取得・正規化・差分検知スクリプト
│       ├── common.py
│       ├── ingest_us_csl.py
│       ├── ingest_jp_end_user_list.py
│       └── ingest_cn_lists.py
├── ui/                     # Webポータル（Vite製の静的サイト、GitHub Pagesで公開）
│   ├── index.html
│   └── src/
│       ├── main.js         # 画面ロジック（規制根拠情報・エンティティ検索の両モード）
│       ├── api.js          # データ取得（GitHub Raw / ローカルdatasources.yaml・data/）
│       ├── trendChart.js   # 収録件数推移の簡易SVGチャート
│       └── index.css
└── .github/workflows/      # 自動検知・自動反映・自動デプロイ
    ├── validate-data.yml       # push/PR時にdatasources.yaml・entitiesをスキーマ検証
    ├── ingest-entities.yml     # 実体データの自動再取得・差分要約付きIssue起票・自動コミット
    ├── check-updates.yml       # JP METIお知らせページの監視・変更検知時にIssue起票
    └── deploy-ui.yml           # ui/への変更をGitHub Pagesへ自動デプロイ
```

## セットアップと使用方法

### 必要な依存関係のインストール

本プロジェクトのバリデーションやクローラーは Python で記述されています。

```bash
pip install -r scripts/crawler/requirements.txt
```

### データバリデーション

追加・修正した `datasources.yaml` が共通スキーマに準拠しているかをローカルで検証できます。

```bash
python schema/validate_datasources.py
```

### 更新検知（ローカル実行）

日本METIの新着お知らせページの更新を検知するクローラーをローカルで実行できます（本番ではGitHub Actionsが毎日自動実行します。詳細は次章参照）。

```bash
python scripts/crawler/check_updates.py
```

## 自動化（GitHub Actions）

データの検証・更新・公開は、以下のワークフローにより自動化されています。

| ワークフロー | トリガー | 内容 |
| --- | --- | --- |
| `validate-data.yml` | push / PR（main） | `datasources.yaml`・`data/entities/*.json` をスキーマ検証 |
| `ingest-entities.yml` | 米国は毎日、日本・中国は毎週月曜（＋手動実行） | 各国の実体データを再取得・正規化し `data/entities/*.json` を自動コミット。追加・更新・削除されたエンティティを検知した場合は、差分サマリー付きでGitHub Issue（`update-alert` ラベル）を自動起票 |
| `check-updates.yml` | 毎日（＋手動実行） | 日本METIの新着お知らせページを監視し、変更を検知した場合はIssueを自動起票 |
| `deploy-ui.yml` | `ui/` への push（main）＋手動実行 | `ui/` をビルドし、GitHub Pagesへ自動デプロイ |

## 統合エンティティデータベース（API的な利用方法）

`countries/` のメタデータとは別に、各国の規制リストに実際に掲載されている企業・個人等の実体データを
`data/entities/` 配下にJSONとして正規化・集約しています。サーバーを介さず、以下のURLに直接アクセスするだけで
外部のAPIやAIアプリから参照できます（無料・恒久的に利用可能）。

```
https://raw.githubusercontent.com/xyna-bpinelab/security-export-control-registry/main/data/manifest.json
https://raw.githubusercontent.com/xyna-bpinelab/security-export-control-registry/main/data/entities/us.json
https://raw.githubusercontent.com/xyna-bpinelab/security-export-control-registry/main/data/entities/jp.json
https://raw.githubusercontent.com/xyna-bpinelab/security-export-control-registry/main/data/entities/cn.json
```

`data/manifest.json` が索引となり、収録リストごとのファイルパス・件数・出典・更新頻度を確認できます。
各レコードは `schema/entity-schema.json` に準拠し、`source_url` と `last_verified` を必ず含みます。

実体データベース（`data/entities/`）は現時点で以下の3カ国を収録しています（法令・国際レジームのメタデータ `countries/` は、これとは別に日本・米国・中国・国際レジーム（ml/）の4区分を収録しています）。

| 国 | リスト | 件数 | 更新頻度 |
| --- | --- | --- | --- |
| 🇺🇸 米国 | Consolidated Screening List（Entity List, SDN List等11リストの統合） | 約25,800件 | 毎日自動更新 |
| 🇯🇵 日本 | 外国ユーザーリスト（METIが改正の都度PDFで公表） | 約835件 | 毎週月曜チェック（改正は年数回程度） |
| 🇨🇳 中国 | 不可靠实体清单・出口管制管控名单・关注名单（商務部が個別公告で随時追加） | 約240件 | 毎週月曜チェック（改正は不定期） |

日本分はMETIが構造化データを提供しておらず、改正のたびにPDFが新しいURLで公表されるため、
`scripts/ingest/ingest_jp_end_user_list.py` 内の `PRESS_RELEASE_URL` を改正時に手動更新する必要があります
（`countries/jp/datasources.yaml` の `jp-end-user-list` エントリにも同様の注記があります）。

中国分はさらに特殊で、3つのリストとも商務部から単一の一括データ（API・PDF等）が提供されておらず、
2020年の制度創設以降の個別公告（数十件）をそれぞれ解析して統合しています。公告本文の書式は統一されておらず、
番号付き列挙・地の文列挙が混在し、実体数の記載（「等N家」）と本文内容が一致しない公告も実際に存在したため
（`ingest_cn_lists.py` 内でカウント不一致を検知した場合は標準エラー出力に警告を出し、抽出結果はそのまま採用した上で
人間によるレビューを促す設計としています）。既知の1件（2024年5月20日付公告、対象3社のうち本文で明示的に
「列入」と記載されているのは2社のみ）は未解決のまま2社として登録しています。将来的にMOFCOMが新たな公告を
出すたびに `ingest_cn_lists.py` の再実行で自動的に検出・追加されますが、抽出ロジックの前提（本文の言い回し）が
崩れた場合は警告を確認のうえ手動での見直しが必要です。

**注意:** 本データはあくまで公式情報源のミラー（ベストエフォート）です。コンプライアンス上の判断を行う際は、
必ず各レコードの `source_url` から一次情報源を確認してください。

```bash
# 手動での再取得・検証
python scripts/ingest/ingest_us_csl.py
python scripts/ingest/ingest_jp_end_user_list.py
python scripts/ingest/ingest_cn_lists.py
python schema/validate_entities.py
```

## ライセンス

本プロジェクトはオープンソース（MIT License）です。詳細は今後の開発に従って整備します。
