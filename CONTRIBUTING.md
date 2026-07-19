# Contributing to Security Export Control Registry

本プロジェクトへの貢献（データソースの追加、法改正情報の反映、クローラーの改善など）に関心を持っていただき、ありがとうございます。

## どのように貢献できるか？

### 1. 新たなデータソース（国・地域）の追加
まだ登録されていない国や地域の規制データ（`datasources.yaml`）を追加してください。
* `countries/` 配下に新規ディレクトリを作成します（例: `countries/eu/`、`countries/gb/`）。
* ディレクトリ内に `datasources.yaml` を配置します。
* `datasources.yaml` が `schema/datasource-schema.json` に準拠しているかをローカルで検証してください。

### 2. データソース情報のアップデート
法令のURLが変わったり、新しいAPIが利用可能になったりした場合は、該当する `datasources.yaml` を編集してください。

### 3. バリデータやクローラーのバグ修正・機能強化
* クローラーの検知精度の向上
* 新たな官公庁ウェブサイトへのクローラー対応

## 開発と確認手順

### 1. 依存関係のインストール
```bash
pip install -r scripts/crawler/requirements.txt
```

### 2. バリデーションチェック
コミットや Pull Request の作成前に、必ずバリデーションスクリプトを実行してください。
```bash
python schema/validate_datasources.py
```
エラーがある場合、CI (GitHub Actions) 上のテストも失敗します。
