# 変更履歴

このプロジェクトの主な変更を記録します。
書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、バージョン番号は [セマンティック バージョニング](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### 変更

- npm パッケージの説明に CLI を加えました。

## [1.2.1] - 2026-11-05

### 修正

- `search_articles`（CLI の `pubmed search`）で、NCBI の検索サーバーの障害時に `Cannot read properties of undefined (reading 'length')` で失敗していたのを、NCBI が返したエラーメッセージ（例: `Search is temporarily unavailable`）を返すようにしました。NCBI は障害時に HTTP 200 で ID の一覧のない応答を返すことがあり、これを検索結果として扱っていました。

## [1.2.0] - 2026-11-04

### 追加

- CLI に `-v` / `--version` を追加しました。インストールされている `pubmed` のバージョンを表示します。

### 修正

- MCP サーバーが `initialize` の応答（`serverInfo.version`）でバージョンを常に `1.0.0` と返していたのを、`package.json` のバージョンを返すようにしました。

## [1.1.0] - 2026-11-04

### 変更

- **HTTP モードで `ALLOWED_SUBJECTS` を必須にしました。** 未設定または空のときは起動時に終了します。これまでは空のとき、認可サーバー（WorkOS AuthKit）で有効なトークンを取得できるユーザー全員が `/mcp` を使えました。
- HTTP モードで、`/mcp` への GET と DELETE に 405 を返すようにしました。ステートレスなサーバーには GET で開く SSE ストリームに送るものがなく、開いたままのストリームがサーバーインスタンスと Cloud Run のリクエストを占有していました。

### セキュリティ

- MCP サーバーが `.env` を起動時のカレントディレクトリから読み込んでいたのをやめ、パッケージ自身のルート（ソースからビルドした場合はリポジトリ直下）からだけ読み込むようにしました（CLI はもともとこの動作です）。MCP クライアントは開いているプロジェクトのディレクトリでサーバーを起動するため、そのプロジェクトの `.env` に `PORT` があると HTTP モードで起動し、`HTTPS_PROXY` と `NODE_TLS_REJECT_UNAUTHORIZED=0` があると NCBI への通信（API キーを含む）を第三者のプロキシが読み書きできました。
- ID を受け取るツール（`get_article_metadata`、`find_related_articles`、`get_copyright_status`、`get_full_text_article`、`convert_article_ids`）で、1 つの値に 1 つの ID だけを受け付けるようにしました。NCBI はカンマを ID の区切りとして扱うため、`"1,2,3"` のような値で 1 回あたりの上限を超える件数を取得できました。上限のなかった `find_related_articles` の `pmids` も 200 件までにしました。
- `lookup_article_by_citation` で、引用の各項目に含まれる `|` と改行を空白に置き換えるようにしました。どちらも ECitMatch の区切り文字なので、項目がずれたり別の引用として送られたりして、結果が別の引用に対応づけられるおそれがありました。
- NCBI へのリクエストに 60 秒のタイムアウトを設けました。応答のない接続で、ツールの呼び出し（HTTP モードではクライアントのリクエスト）が止まったままになることがなくなります。
- NCBI へのリクエストがリダイレクトされたときは、HTTPS で `*.ncbi.nlm.nih.gov` に向かうものだけをたどるようにしました。API キーはクエリ文字列に含まれ、リダイレクト先にも引き継がれます。
- エラーメッセージの中の API キーは、NCBI が返した本文のどこに現れても伏せるようにしました。ネットワークエラーには、API キーを含む axios のエラーオブジェクトを付けないようにしました。
- HTTP モードで、`exp` と `sub` のないアクセストークンを拒否するようにしました。
- HTTP モードで、リクエスト本文の JSON をトークンの検証後に解析するようにしました。不正な形式や大きすぎる本文などのエラーには、スタックトレースを含む HTML ではなく JSON を返し、`X-Powered-By` ヘッダーも送らないようにしました。Docker イメージでは `NODE_ENV=production` を設定し、依存パッケージのインストールスクリプトを実行しないようにしました。
- `@modelcontextprotocol/sdk`、`axios`、`express` の最低バージョンを、既知の脆弱性の修正を含むバージョンに上げました。
- GitHub Actions のアクションをコミット SHA で固定し、`actions/checkout` が認証情報を `.git` に残さないようにしました。

## [1.0.2] - 2026-11-03

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

[Unreleased]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/DJMIMA/PubMed_MCP/releases/tag/v1.0.0
