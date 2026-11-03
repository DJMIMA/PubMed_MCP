# 変更履歴

このプロジェクトの主な変更を記録します。
書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、バージョン番号は [セマンティック バージョニング](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### 変更

- README を英語にしました。日本語版は `README_ja.md` に移し、両方の冒頭に npm のバージョン・パッケージサイズ・ライセンス・Node.js のバージョン・CI のバッジと、言語の切り替えリンクを付けました。

## [1.0.1] - 2026-11-01

### 変更

- NCBI へのリクエストに付ける連絡先（`email` パラメータ）を、ダミーの `pubmed-mcp@example.com` から開発者の転送用アドレスに変更しました。NCBI の E-utilities 利用ガイドラインは、`email` に利用者ではなく開発者のアドレスを使うよう求めています。
- README の「ライセンス」の節で、NCBI の免責事項・著作権表示へのリンクをはっきり示しました。

## [1.0.0] - 2026-10-29

npm パッケージ [`@djmima/pubmed-mcp`](https://www.npmjs.com/package/@djmima/pubmed-mcp) として最初に公開した版です。

### 追加

- 7 つの MCP ツール: `search_articles`、`get_article_metadata`、`find_related_articles`、`lookup_article_by_citation`、`convert_article_ids`、`get_full_text_article`、`get_copyright_status`
- stdio と、OAuth で保護した Streamable HTTP の 2 つのトランスポート（`PORT` を設定すると HTTP モード）
- 同じツールをシェルから実行する `pubmed` CLI と、エージェント向けの Skill（`skills/pubmed-cli`）
- MIT License

[Unreleased]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/DJMIMA/PubMed_MCP/releases/tag/v1.0.0
