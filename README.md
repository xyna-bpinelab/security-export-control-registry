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
│   └── validate_datasources.py
├── countries/              # 国・地域別データ
│   ├── jp/                 # 日本（外為法、輸出令、貨物等省令、運用・役務通達など）
│   │   └── datasources.yaml
│   ├── us/                 # 米国（EAR, ITAR, Entity List, SDNリストなど）
│   │   └── datasources.yaml
│   ├── eu/                 # 欧州（EU Dual-Use Regulation）
│   └── international/      # 国際レジーム（WA, MTCR, NSG, AG）
└── scripts/
    └── crawler/            # 自動更新検知クローラー
        ├── check_updates.py
        └── requirements.txt
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

## ライセンス

本プロジェクトはオープンソース（MIT License）です。詳細は今後の開発に従って整備します。
