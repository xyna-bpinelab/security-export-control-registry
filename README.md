# Security Export Control Registry

安全保障輸出管理に関する国内外の法令、政令、省令、通達、および規制リスト（エンティティリスト等）のメタデータを一元管理し、自動追随・見える化するためのグローバルなオープンソースレジストリです。

## 概要

安全保障輸出管理（外為法、米国EAR/ITARなど）の法規・リストは極めて複雑で、国際情勢やレジームの合意を反映して頻繁に改正されます。
本プロジェクトでは、各国の公式データソースを構造化し、その更新状況を継続監視・バリデーションする基盤を構築します。将来的にグラフデータベース等と連携し、法令の依存関係や適用関係を「見える化」することを目指します。

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
│   ├── jp/                 # 日本（外為法、輸出令、貨物等省令、運用・役務通達など）
│   │   └── datasources.yaml
│   ├── us/                 # 米国（EAR, ITAR, Entity List, SDNリストなど）
│   │   └── datasources.yaml
│   ├── cn/                 # 中国（出口管制法、両用物項出口管制条例、不可靠実体清单など）
│   │   └── datasources.yaml
│   ├── eu/                 # 欧州（EU Dual-Use Regulation）
│   └── international/      # 国際レジーム（WA, MTCR, NSG, AG）
├── data/                   # 統合エンティティデータベース（掲載企業・個人等の実体データ）
│   ├── manifest.json       # 収録リストの索引（件数・更新日・出典URL）
│   └── entities/
│       ├── us.json         # 米国 Consolidated Screening List（正規化済み）
│       └── jp.json         # 日本 外国ユーザーリスト（正規化済み）
└── scripts/
    ├── crawler/            # 自動更新検知クローラー
    │   ├── check_updates.py
    │   └── requirements.txt
    └── ingest/             # 実体データ取得・正規化スクリプト
        ├── common.py
        ├── ingest_us_csl.py
        └── ingest_jp_end_user_list.py
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

### 更新検知（プロトタイプ）

各データソースが更新されているかを検知するクローラーを実行します。

```bash
python scripts/crawler/check_updates.py
```

## 統合エンティティデータベース（API的な利用方法）

`countries/` のメタデータとは別に、各国の規制リストに実際に掲載されている企業・個人等の実体データを
`data/entities/` 配下にJSONとして正規化・集約しています。サーバーを介さず、以下のURLに直接アクセスするだけで
外部のAPIやAIアプリから参照できます（無料・恒久的に利用可能）。

```
https://raw.githubusercontent.com/xyna-bpinelab/security-export-control-registry/main/data/manifest.json
https://raw.githubusercontent.com/xyna-bpinelab/security-export-control-registry/main/data/entities/us.json
https://raw.githubusercontent.com/xyna-bpinelab/security-export-control-registry/main/data/entities/jp.json
```

`data/manifest.json` が索引となり、収録リストごとのファイルパス・件数・出典・更新頻度を確認できます。
各レコードは `schema/entity-schema.json` に準拠し、`source_url` と `last_verified` を必ず含みます。

現時点では以下の2リストを収録しています。中国分は今後追加予定です。

| 国 | リスト | 件数 | 更新頻度 |
| --- | --- | --- | --- |
| 🇺🇸 米国 | Consolidated Screening List（Entity List, SDN List等11リストの統合） | 約25,800件 | 毎日自動更新 |
| 🇯🇵 日本 | 外国ユーザーリスト（METIが改正の都度PDFで公表） | 約835件 | 毎週月曜チェック（改正は年数回程度） |

日本分はMETIが構造化データを提供しておらず、改正のたびにPDFが新しいURLで公表されるため、
`scripts/ingest/ingest_jp_end_user_list.py` 内の `PRESS_RELEASE_URL` を改正時に手動更新する必要があります
（`countries/jp/datasources.yaml` の `jp-end-user-list` エントリにも同様の注記があります）。

**注意:** 本データはあくまで公式情報源のミラー（ベストエフォート）です。コンプライアンス上の判断を行う際は、
必ず各レコードの `source_url` から一次情報源を確認してください。

```bash
# 手動での再取得・検証
python scripts/ingest/ingest_us_csl.py
python scripts/ingest/ingest_jp_end_user_list.py
python schema/validate_entities.py
```

## ライセンス

本プロジェクトはオープンソース（MIT License）です。詳細は今後の開発に従って整備します。
