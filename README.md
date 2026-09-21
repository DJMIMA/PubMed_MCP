# PubMed MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that gives Claude and other LLM clients structured access to [PubMed](https://pubmed.ncbi.nlm.nih.gov/) and [PubMed Central (PMC)](https://www.ncbi.nlm.nih.gov/pmc/) via the NCBI E-utilities API.

## Tools

| Tool | 説明 |
|------|------|
| `search_articles` | PubMed構文またはキーワードで文献を検索。ATM診断・フィールド制限・日付フィルタ・ソート・ページネーション対応 |
| `get_article_metadata` | PMIDを指定してタイトル・抄録・著者・MeSH語・キーワードなどを取得 |
| `find_related_articles` | ELinkを使って関連文献や他DBへのリンクを検索 |
| `lookup_article_by_citation` | 雑誌名・年・巻・筆頭著者などの引用情報からPMIDを逆引き |
| `convert_article_ids` | PMID・PMCID・DOI を相互変換 |
| `get_full_text_article` | PMC Open Access記事の本文全文をプレーンテキストで取得 |
| `get_copyright_status` | 全文取得の可否（`has_full_text`）・ライセンス・著作権表示・OAステータスを確認。PMCのEFetchメタデータを使用（旧PMC OA Web Serviceは2026-08-25に廃止） |

---

## `search_articles` の ATM 診断とフィールド制限

PubMed はタグのない検索語に Automatic Term Mapping（ATM）を適用します。ATM は MeSH、
雑誌名、著者名などへ検索語を展開するため、意図しない変換や、引用句が句インデックスに
存在しないことによる検索のフォールバックが起こる場合があります。

`search_articles` は次の任意の `field` 値を受け取り、クエリ内のタグなし語をすべてその
フィールドへ制限します。

- `title`
- `tiab`（Title/Abstract）
- `mesh`
- `author`
- `journal`
- `affiliation`

クエリ内に明示的なフィールドタグがある語では、そのタグが `field` より優先されます。
`field` を省略した場合の検索動作は従来どおりです。`all` は ATM を無効化しないため、
公開パラメータには含めていません。

レスポンスには、NCBI ESearch の診断を正規化した次のフィールドが常に含まれます。

```json
{
  "warnings": {
    "phrases_ignored": [],
    "quoted_phrases_not_found": [],
    "output_messages": []
  },
  "errors": {
    "phrases_not_found": [],
    "fields_not_found": []
  }
}
```

この `errors` は NCBI ESearch が返す検索語・フィールドの診断であり、通信エラーや
MCP ツール自体の実行エラーとは別の情報です。
これらのキーは診断がない場合も空配列として返ります。低件数や0件を「文献なし」と判断する
前に、`query_translation`、`warnings`、`errors` を確認してください。複数語を同一フィールドで
確実に検索する場合は各語へタグを付け、引用句が句インデックスにない場合の隣接検索には
`[ti:~0]` または `[tiab:~0]` を使用できます。

---

## 必要環境

- **Node.js** 18 以上
- **npm** 8 以上
- **NCBI API キー**（任意。なくても動作するが、レートリミットが 3 req/s に制限される）

---

## インストール

```bash
git clone https://github.com/DJMIMA/PubMed_MCP.git
cd PubMed_MCP
npm install
npm run build
```

`dist/` はリポジトリに含まれません。`git pull` でソースを更新したら `npm run build` を再実行し、
MCP クライアントを再起動してください。起動中のサーバーは再起動するまで古いビルドのまま動きます。

### NCBI API キーの設定（推奨）

APIキーを取得するとレートリミットが 3 → 8 req/s に向上します。

1. [NCBI アカウント](https://www.ncbi.nlm.nih.gov/account/)を作成してAPIキーを発行
2. 環境変数 `NCBI_API_KEY` にセット（後述のクライアント別設定を参照）

MCP クライアントからローカルで起動する場合は、クライアント設定の `env` でキーを渡してください。
`.env` は起動時のカレントディレクトリから読み込まれるため、クライアント経由の起動では
プロジェクト直下の `.env` が読まれないことがあります。

APIキーは、このサーバーを運用する個人または組織が所有・管理するものを設定してください。
リポジトリにはAPIキーを同梱しません。レスポンス中にNCBI APIの `echo` が含まれる場合も、
`api_key` 値は `<redacted>` にマスクされます。

クライアント側ではプロセスごとに簡易レートリミッターをかけています。APIキーなしでは最大
3 req/s、APIキーありではNCBI上限の10 req/sに対して余裕を持たせた8 req/sで送信します（NCBIは到着時刻で数えるため、回線の揺らぎ分の余裕）。HTTP 429 が返った場合は最大2回まで待機して再試行します。
同一プロセス内の並列呼び出しは自動的に間隔調整されますが、Cloud Runなどで複数インスタンスを
動かす場合は全インスタンス合算でNCBIの上限を超えないようにしてください。目安として、単一
インスタンスではAPIキーありで8並列程度、APIキーなしで2並列程度までに抑える運用を推奨します。

---

## 使い方

### Claude Desktop（ローカル・stdio）

`claude_desktop_config.json` の `mcpServers` にサーバーを追加します。

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pubmed-local": {
      "command": "node",
      "args": ["/absolute/path/to/PubMed_MCP/dist/index.js"],
      "env": {
        "NCBI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

- 他のサーバーが登録済みの場合は、`mcpServers` の中に `"pubmed-local": { ... }` を並べて追加します（前の項目との間のカンマを忘れずに）。
- Windows のパスは `"C:/path/to/PubMed_MCP/dist/index.js"` のようにスラッシュ区切りで書くか、`\\` とエスケープしてください。
- サーバー名を `pubmed-local` にしておくと、リモート版（`pubmed-remote`）や同じツール名を持つ他の PubMed コネクタと区別しやすくなります。

設定後、Claude Desktop を完全に終了してから再起動してください。ウィンドウを閉じただけではアプリが常駐したままになることがあります（Windows ではタスクトレイのアイコンから終了できます）。
この設定のサーバーは、Claude Desktop の Code タブで開いたセッションにも読み込まれます。

起動しない場合は、ログ（Windows: `%APPDATA%\Claude\logs\mcp-server-pubmed-local.log`、macOS: `~/Library/Logs/Claude/mcp-server-pubmed-local.log`）を確認してください。

---

### Claude Code（ローカル・stdio）

`claude mcp add` で登録します。`--scope user` を付けるとすべてのプロジェクトで使えます。

```bash
claude mcp add --env NCBI_API_KEY=your_api_key_here --transport stdio --scope user pubmed-local -- node /absolute/path/to/PubMed_MCP/dist/index.js
```

- `--` より後ろは、サーバーの起動コマンドとしてそのまま渡されます。
- `--env` の直後にサーバー名を書くと `KEY=value` の続きとして解釈されてエラーになるため、間に別のオプション（ここでは `--transport stdio`）を挟みます。
- 登録内容は `~/.claude.json`（user / local スコープ）またはプロジェクト直下の `.mcp.json`（project スコープ）に保存されます。`~/.claude/settings.json` に `mcpServers` を書いても読み込まれません。
- Claude Desktop の Code タブだけで使う場合は、上記の `claude_desktop_config.json` への登録で読み込まれるため、この手順は不要です。

登録後、`claude mcp list` または Claude Code 内の `/mcp` で接続状態を確認できます。

---

### Codex（ローカル・stdio）

Codex のデスクトップアプリ・CLI・IDE 拡張は、同じ設定ファイル `~/.codex/config.toml`（Windows: `%USERPROFILE%\.codex\config.toml`）を共有します。次のブロックを追記してください。

```toml
[mcp_servers.pubmed-local]
command = "node"
args = ["/absolute/path/to/PubMed_MCP/dist/index.js"]

[mcp_servers.pubmed-local.env]
NCBI_API_KEY = "your_api_key_here"
```

- Windows のパスはシングルクォート（TOML のリテラル文字列）で囲むと、`\` をそのまま書けます（例: `args = ['C:\path\to\PubMed_MCP\dist\index.js']`）。ダブルクォートで囲む場合は `\\` とエスケープしてください。
- `node` が見つからずに起動しない場合は、`command` に Node.js の絶対パス（例: `'C:\Program Files\nodejs\node.exe'`）を指定します。
- Codex は OS の環境変数をそのまま MCP サーバーへ渡しません。API キーは上のように `env` に書くか、`[mcp_servers.pubmed-local]` に `env_vars = ["NCBI_API_KEY"]` を追加して Codex 側の環境変数から転送してください。

CLI からは `codex mcp add` でも登録できます。

```bash
codex mcp add pubmed-local --env NCBI_API_KEY=your_api_key_here -- node /absolute/path/to/PubMed_MCP/dist/index.js
```

設定後は Codex を再起動してください（デスクトップアプリでは **Settings → MCP servers** の **Restart**）。同じ画面の **Add server** から登録することもできます。CLI と IDE 拡張では `/mcp` で接続中のサーバーを確認できます。

---

### Anthropic API（プログラムからの利用）

```python
import os

import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-opus-4-6",
    max_tokens=1024,
    messages=[{
        "role": "user",
        "content": "Find recent papers on CRISPR gene editing in cancer treatment"
    }],
    mcp_servers=[{
        "type": "url",
        "url": "https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp",
        "name": "pubmed",
        # /mcp は OAuth で保護されているため、アクセストークンが必要
        "authorization_token": os.environ["PUBMED_MCP_TOKEN"],
    }],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "pubmed"}],
    betas=["mcp-client-2025-11-20"]
)
```

Anthropic API の MCP コネクタは HTTP で公開されたリモートサーバーにしか接続できないため、先に Cloud Run へデプロイしておく必要があります。
デプロイ方法は後述の「[Google Cloud Run へのデプロイ](#google-cloud-run-へのデプロイ)」、アクセストークンの取得方法は「[クライアント別の接続設定](#クライアント別の接続設定)」を参照してください。

---

### ローカル開発

```bash
# .env ファイルを作成してAPIキーを設定
cp .env.example .env
# .env を編集して NCBI_API_KEY を記入

# stdio モードで起動（デフォルト）
npm run dev

# HTTP モードで起動（PORT を設定すると有効になる。OAuth の環境変数も必須）
PORT=8080 npm run dev
# → http://localhost:8080/mcp   MCP エンドポイント（Bearer トークン必須）
# → http://localhost:8080/health ヘルスチェック
```

HTTP モードは起動時に `OAUTH_ISSUER`・`OAUTH_JWKS_URL`・`MCP_RESOURCE_URL` を読み込み、1 つでも未設定だと次のエラーで終了します。

```
Fatal error: Error: Missing required environment variable: OAUTH_ISSUER
```

`.env` にこれらの値を設定してから起動してください（各値の意味は「[環境変数](#環境変数)」を参照）。
`/health` や 401 応答を確かめるだけなら URL 形式の仮の値でも起動できますが、`/mcp` を実際に呼び出すには
`MCP_RESOURCE_URL` を `aud` として発行されたアクセストークンが必要です。認証なしでツールを試す場合は stdio モードを使ってください。

---

## Google Cloud Run へのデプロイ

このサーバーは Docker コンテナとして Google Cloud Run にデプロイできます。
`PORT` 環境変数が設定されると自動的に HTTP モードで起動し、Streamable HTTP トランスポートで MCP クライアントと通信します。

HTTP モードの `/mcp` は **OAuth 2.0 で保護** されています。サーバーは OAuth のリソースサーバーとして動作し、
リクエストごとに Bearer トークン（JWT）の署名・発行者（`iss`）・対象（`aud`）・有効期限を、認可サーバーの公開鍵（JWKS）で検証します。
ログイン画面やトークンの発行は外部の認可サーバーが担当します（ここでは WorkOS AuthKit を使います）。

Cloud Run 自体は `--allow-unauthenticated` で公開します。Cloud Run の IAM 認証（IAP を含む）は claude.ai からの接続と両立しないため、
アクセス制御は Cloud Run ではなくアプリ側の OAuth で行います。

| パス | 認証 | 内容 |
|------|------|------|
| `/mcp` | Bearer トークン必須 | MCP エンドポイント |
| `/.well-known/oauth-protected-resource` | 不要 | 認可サーバーの場所を示すメタデータ（RFC 9728） |
| `/health` | 不要 | ヘルスチェック |

```
Claude（Web / Desktop / モバイル）・Claude Code・Anthropic API
        │  Authorization: Bearer <WorkOS AuthKit が発行したアクセストークン>
        ▼
  Cloud Run（--allow-unauthenticated）
        │  /mcp で JWT を検証し、ALLOWED_SUBJECTS で利用者を限定
        ▼
  MCP ハンドラ
```

Claude の各アプリと Claude Code は、トークンなしのリクエストに返る 401 応答（`WWW-Authenticate` ヘッダー）から
メタデータをたどって認可サーバーを見つけ、ブラウザでのログインを経てトークンを取得します。
Anthropic API から使う場合は、呼び出し側でトークンを用意して渡します。

### 前提条件

- Google Cloud プロジェクト（課金が有効なもの）
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) インストール済み・ログイン済み
- [WorkOS](https://workos.com/) アカウント（AuthKit を OAuth 認可サーバーとして使用）

### ステップ 1 — プロジェクトと API の準備

```bash
# デプロイ先プロジェクトをセット
gcloud config set project MY_PROJECT_ID

# 必要な API を有効化（初回のみ）
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com  # NCBI_API_KEY を管理する場合のみ
```

### ステップ 2 — Artifact Registry リポジトリを作成（初回のみ）

```bash
gcloud artifacts repositories create pubmed-mcp \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="PubMed MCP Server"
```

### ステップ 3 — シークレットを Secret Manager に登録

NCBI API キーをコマンド履歴やログに残さないために Secret Manager を使います。

```bash
# NCBI API キーを登録
echo -n "your_ncbi_api_key" | \
  gcloud secrets create ncbi-api-key \
    --data-file=- \
    --replication-policy=automatic
```

### ステップ 4 — コンテナイメージをビルドしてプッシュ

Cloud Build を使うとローカルに Docker をインストールせずにビルドできます。
`gcloud builds submit` はカレントディレクトリのファイルを Cloud Build に送信するため、
**事前にリポジトリをクローンしておく必要があります。**

```bash
# リポジトリをクローンしてディレクトリに移動
git clone https://github.com/DJMIMA/PubMed_MCP.git
cd PubMed_MCP

# Cloud Build でビルド（ローカルに Docker 不要）
gcloud builds submit \
  --region=asia-northeast1 \
  --tag asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest
```

ローカルの Docker でビルドする場合:

```bash
gcloud auth configure-docker asia-northeast1-docker.pkg.dev

docker build -t asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest .
docker push asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest
```

### ステップ 5 — OAuth 認可サーバー（WorkOS AuthKit）を設定

まず MCP エンドポイントの公開 URL を決めます。Cloud Run のサービスには
`https://サービス名-プロジェクト番号.リージョン.run.app` 形式の URL が割り当てられるため、デプロイ前に確定できます。

```bash
PROJECT_NUMBER=$(gcloud projects describe MY_PROJECT_ID --format='value(projectNumber)')
MCP_RESOURCE_URL="https://pubmed-mcp-${PROJECT_NUMBER}.asia-northeast1.run.app/mcp"
echo "$MCP_RESOURCE_URL"
```

この URL が `MCP_RESOURCE_URL` です。WorkOS の Resource Indicator や各クライアントに登録する URL とは**完全に同じ文字列**にしてください
（クライアントは接続先の URL とメタデータの `resource` が一致するかを確認し、サーバーはトークンの `aud` をこの値と照合します）。
Cloud Run には `https://pubmed-mcp-xxxx-an.a.run.app` 形式の URL も割り当てられ、どちらでもアクセスできますが、OAuth で使う URL はどちらか一方に統一します。

次に WorkOS ダッシュボードで AuthKit を設定します。

1. **Connect → Configuration** で **Dynamic Client Registration** を有効にする（claude.ai などの MCP クライアントが、自分自身を OAuth クライアントとして登録できるようにするため）
2. `MCP_RESOURCE_URL` を **Resource Indicator** として登録する（アクセストークンの `aud` がこの URL になる）
3. AuthKit ドメインの認可サーバーメタデータを開き、`issuer` と `jwks_uri` の値を控える

   ```bash
   curl https://YOUR_AUTHKIT_DOMAIN/.well-known/oauth-authorization-server
   # → {"issuer":"https://YOUR_AUTHKIT_DOMAIN", ..., "jwks_uri":"https://YOUR_AUTHKIT_DOMAIN/oauth2/jwks", ...}
   ```

WorkOS の Staging 環境と Production 環境は、設定も AuthKit ドメインも別々です。環境を切り替えるときは上の設定をやり直し、
`OAUTH_ISSUER`・`OAUTH_JWKS_URL` も差し替えてください。

### ステップ 6 — Cloud Run にデプロイ

ステップ 5 で控えた値を使ってデプロイします。`ALLOWED_SUBJECTS` には最初は仮の値（ここでは `placeholder`）を入れておきます（理由はステップ 8 を参照）。

```bash
# ステップ 5 で控えた issuer と jwks_uri の値に置き換える
OAUTH_ISSUER="https://YOUR_AUTHKIT_DOMAIN"
OAUTH_JWKS_URL="https://YOUR_AUTHKIT_DOMAIN/oauth2/jwks"

gcloud run deploy pubmed-mcp \
  --image asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest \
  --region asia-northeast1 \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --allow-unauthenticated \
  --set-secrets NCBI_API_KEY=ncbi-api-key:latest \
  --set-env-vars "OAUTH_ISSUER=${OAUTH_ISSUER},OAUTH_JWKS_URL=${OAUTH_JWKS_URL},MCP_RESOURCE_URL=${MCP_RESOURCE_URL},ALLOWED_SUBJECTS=placeholder"
```

| 変数 | 設定する値 |
|------|-----------|
| `OAUTH_ISSUER` | 認可サーバーメタデータの `issuer`。トークンの `iss` と完全一致で照合されるので、末尾の `/` の有無も含めてそのままコピーする |
| `OAUTH_JWKS_URL` | 同じメタデータの `jwks_uri`。トークンの署名検証に使う公開鍵の URL |
| `MCP_RESOURCE_URL` | ステップ 5 で決めた MCP エンドポイントの URL。トークンの `aud` と照合し、`/.well-known/oauth-protected-resource` の `resource` としても公開される |
| `ALLOWED_SUBJECTS` | 接続を許可するユーザー ID（トークンの `sub`）のカンマ区切りリスト。空にすると、AuthKit で有効なトークンを取得できるユーザー全員が接続できる |

`OAUTH_ISSUER`・`OAUTH_JWKS_URL`・`MCP_RESOURCE_URL` のどれかが欠けていると、サーバーは起動時に
`Missing required environment variable: ...` で終了し、デプロイは失敗します。失敗した場合は Cloud Run のログでこのメッセージを確認してください
（Cloud Console で設定した場合は、変数名の前後に空白が入っていないかも確認してください）。

> **`--set-env-vars` と `--update-env-vars` の違い**: `--set-env-vars` は既存の環境変数をすべて削除してから、指定した値を設定します（指定しなかった変数は消えます）。
> デプロイ後に一部の値だけを追加・変更するときは、既存の値とマージされる `--update-env-vars` を使ってください（`gcloud run services update` でも使えます）。

### ステップ 7 — 動作確認

`/health` と `/.well-known/oauth-protected-resource` は認証なしで応答します。`/mcp` はトークンなしでは **401 が返れば正常** です。

**Linux / macOS (bash)**

```bash
PROJECT_NUMBER=$(gcloud projects describe MY_PROJECT_ID --format='value(projectNumber)')
CLOUD_RUN_URL="https://pubmed-mcp-${PROJECT_NUMBER}.asia-northeast1.run.app"

# ヘルスチェック
curl "$CLOUD_RUN_URL/health"
# → ok

# Protected Resource Metadata（resource が MCP_RESOURCE_URL、authorization_servers が OAUTH_ISSUER になっていることを確認）
curl "$CLOUD_RUN_URL/.well-known/oauth-protected-resource"
# → {"resource":"https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp","authorization_servers":["https://YOUR_AUTHKIT_DOMAIN"],"bearer_methods_supported":["header"]}

# MCP エンドポイント（トークンなしなので 401。-i でヘッダーも表示。ヒアドキュメントでクォート問題を回避）
curl -i "$CLOUD_RUN_URL/mcp" \
  -X POST \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}
EOF
```

`/mcp` の応答は次のようになります（抜粋。HTTP のバージョンやヘッダー名の大文字・小文字は環境によって異なります）。

```
HTTP/2 401
www-authenticate: Bearer resource_metadata="https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/.well-known/oauth-protected-resource", error="missing_token"
content-type: application/json; charset=utf-8

{"error":"missing_token"}
```

MCP クライアントは `WWW-Authenticate` ヘッダーの `resource_metadata` をたどって認可サーバーを見つけます。
トークンの検証に失敗した場合は `error="invalid_token"` の 401、トークンは有効でも `sub` が `ALLOWED_SUBJECTS` にない場合は 403（`{"error":"forbidden"}`）が返ります。

**Windows（コマンドプロンプト）**

```cmd
:: %CLOUD_RUN_URL% に URL を設定してから実行（PROJECT_NUMBER は自分のプロジェクト番号に置き換える）
set CLOUD_RUN_URL=https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app

curl "%CLOUD_RUN_URL%/health"

curl "%CLOUD_RUN_URL%/.well-known/oauth-protected-resource"

curl -i "%CLOUD_RUN_URL%/mcp" -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0.0.1\"}}}"
```

**Windows（PowerShell）**

```powershell
$CLOUD_RUN_URL = "https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app"

curl.exe "$CLOUD_RUN_URL/health"

curl.exe "$CLOUD_RUN_URL/.well-known/oauth-protected-resource"

curl.exe -i "$CLOUD_RUN_URL/mcp" -X POST -H "Content-Type: application/json" `
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
```

### ステップ 8 — 自分のユーザー ID を ALLOWED_SUBJECTS に登録

Dynamic Client Registration では誰でも OAuth クライアントを登録できるため、`ALLOWED_SUBJECTS` で接続できるユーザーを限定します
（空のままだと AuthKit にログインできるユーザー全員が `/mcp` を使えます。AuthKit でサインアップを許可している場合は第三者も含まれます）。
設定する値はアクセストークンの `sub`（WorkOS のユーザー ID。`user_` で始まる値）です。

`ALLOWED_SUBJECTS` が空のときは `sub` がログに記録されません。そのため、仮の値を入れた状態で一度接続し、拒否されたときのログから確認します。

1. 後述の「[クライアント別の接続設定](#クライアント別の接続設定)」の手順で claude.ai などから接続し、WorkOS AuthKit でログインします。
   `sub` が `ALLOWED_SUBJECTS` に含まれていないため接続は 403 で失敗し、サーバーのログに `[auth] forbidden subject: ...` が記録されます。
2. ログから自分の `sub` を確認します（WorkOS ダッシュボードの **Users** で確認できるユーザー ID と同じ値です）。

   ```bash
   gcloud run services logs read pubmed-mcp \
     --region asia-northeast1 \
     --log-filter='textPayload:"forbidden subject"' \
     --limit 5
   # → ... [auth] forbidden subject: user_01XXXXXXXXXXXXXXXXXXXXXXXX
   ```

3. その値を設定します。`--update-env-vars` なので、ほかの環境変数はそのまま残ります。

   ```bash
   gcloud run services update pubmed-mcp \
     --region asia-northeast1 \
     --update-env-vars ALLOWED_SUBJECTS=user_01XXXXXXXXXXXXXXXXXXXXXXXX
   ```

   複数のユーザーを許可する場合は、値にカンマが含まれるため `^@^` で区切り文字を変えて指定します
   （例: `--update-env-vars '^@^ALLOWED_SUBJECTS=user_01AAAA,user_01BBBB'`。Windows の cmd / PowerShell では `^` を `^^^^` と書きます。詳しくは `gcloud topic escaping` を参照）。
4. クライアントから接続し直します。

---

### クライアント別の接続設定

デプロイ後、各クライアントに MCP エンドポイントの URL を登録します。URL は `MCP_RESOURCE_URL` と**完全に同じ文字列**
（例: `https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp`）にしてください。
初回接続時に WorkOS AuthKit のログイン画面が開きます。ログインしたアカウントの `sub` が `ALLOWED_SUBJECTS` に含まれていれば接続できます
（自分の `sub` を登録する手順はステップ 8 を参照）。

**Claude（Web 版・Claude Desktop）— カスタムコネクタ**

リモートサーバーは「カスタムコネクタ」として追加します（[Claude ヘルプセンター](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)）。
カスタムコネクタは Free プランでも 1 つまで利用できます。

- Pro / Max プラン
  1. [claude.ai](https://claude.ai) または Claude Desktop で **Customize > Connectors** を開く
  2. **+** → **Add custom connector** をクリック
  3. URL（`MCP_RESOURCE_URL`）を入力して **Add** をクリック
  4. 追加したコネクタの **Connect** から認証する（WorkOS AuthKit のログイン画面が開く）
- Team / Enterprise プラン
  1. オーナーが **Organization settings > Connectors** を開き、**Add** → **Custom** にカーソルを合わせて **Web** を選ぶ
  2. URL（`MCP_RESOURCE_URL`）を入力して **Add** をクリック
  3. 各メンバーが **Customize > Connectors** でこのコネクタを探し、**Connect** から認証する

**Advanced settings** の OAuth Client ID / OAuth Client Secret は空欄のままで構いません（Dynamic Client Registration でクライアントが自動登録されます）。
チャットで使うときは、入力欄左下の **+** → **Connectors** から会話ごとに有効にします。

Claude Desktop の `claude_desktop_config.json` はローカル（stdio）サーバー用の設定で、`"type"` や `"url"` を書いてもリモートサーバーには接続されません。
Desktop でもリモートサーバーは上記のカスタムコネクタとして追加してください（Web 版で追加したコネクタは Desktop でもそのまま使えます）。

**Claude モバイルアプリ（Android / iOS）**

Web 版または Claude Desktop で追加したカスタムコネクタは、同じアカウントのモバイルアプリでもそのまま使えます。
モバイルアプリからのコネクタ追加はベータ機能のため、追加は Web 版か Desktop で行ってください。

**Claude Code**

```bash
claude mcp add --transport http --scope user pubmed-remote https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp
```

Claude Code は `~/.claude/settings.json` の `mcpServers` を読み込まないため、`claude mcp add` で登録します。
登録後、Claude Code で `/mcp` を開いて `pubmed-remote` を選び、ブラウザで WorkOS AuthKit にログインして認証します。

**Anthropic API（Python）**

```python
import os

import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-opus-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "..."}],
    mcp_servers=[{
        "type": "url",
        "url": "https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp",
        "name": "pubmed",
        "authorization_token": os.environ["PUBMED_MCP_TOKEN"],
    }],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "pubmed"}],
    betas=["mcp-client-2025-11-20"]
)
```

MCP コネクタは OAuth のログインもトークンの更新も行いません。WorkOS AuthKit がこのサーバー向けに発行したアクセストークン
（`aud` が `MCP_RESOURCE_URL` で、`sub` が `ALLOWED_SUBJECTS` に含まれるもの）を呼び出し側で取得して `authorization_token` に渡し、
有効期限が切れたら取得し直してください。

テスト用のトークンは MCP Inspector で取得できます（[MCP connector ドキュメント](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector#authentication)）。

1. `npx @modelcontextprotocol/inspector` を実行
2. **Transport type** で **Streamable HTTP** を選び、URL に `MCP_RESOURCE_URL` を入力
3. **Open Auth Settings** → **Quick OAuth Flow** をクリックし、WorkOS AuthKit でログイン
4. **Authentication complete** まで進めたら、表示された `access_token` の値をコピー

---

### イメージを更新する（再デプロイ）

```bash
cd PubMed_MCP
git pull

gcloud builds submit \
  --region=asia-northeast1 \
  --tag asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest

gcloud run services update pubmed-mcp \
  --region asia-northeast1 \
  --image asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest
```

`--image` だけを指定した更新では、環境変数とシークレットの設定はそのまま引き継がれます。

---

## 開発コマンド

```bash
npm run build      # TypeScript をコンパイル → dist/
npm run dev        # tsx で直接実行（開発用）
npm test           # テストスイートを実行
npm run typecheck  # 型チェックのみ（コンパイルなし）
npm run lint       # ESLint を実行
```

---

## 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `NCBI_API_KEY` | 任意 | NCBIのAPIキー。設定するとレートリミットが 3 → 8 req/s になる |
| `PORT` | 任意 | 設定するとHTTPモードで起動。Cloud Run はこの変数を自動で注入する |
| `OAUTH_ISSUER` | HTTPモードでは必須 | 認可サーバーの issuer（認可サーバーメタデータの `issuer`）。トークンの `iss` と照合する |
| `OAUTH_JWKS_URL` | HTTPモードでは必須 | 認可サーバーの JWKS の URL（同じメタデータの `jwks_uri`）。トークンの署名検証に使う |
| `MCP_RESOURCE_URL` | HTTPモードでは必須 | MCP エンドポイントの公開 URL。トークンの `aud` と照合し、Protected Resource Metadata の `resource` として公開する |
| `ALLOWED_SUBJECTS` | 任意（推奨） | 接続を許可するトークン `sub` のカンマ区切りリスト。空なら有効なトークンを持つ全ユーザーを許可する |

`OAUTH_ISSUER`・`OAUTH_JWKS_URL`・`MCP_RESOURCE_URL`・`ALLOWED_SUBJECTS` は HTTP モードでのみ使われ、stdio モードでは不要です。
値の決め方は「[Google Cloud Run へのデプロイ](#google-cloud-run-へのデプロイ)」のステップ 5〜8 を参照してください。

`.env` ファイルを使う場合は `.env.example` をコピーして編集してください。
本番環境では、`NCBI_API_KEY` は Cloud Run の `--set-secrets` で Secret Manager から渡し、OAuth 関連の値は `--set-env-vars` / `--update-env-vars` で設定してください。

---

## 参考リンク

- [MCP ドキュメント](https://modelcontextprotocol.io/docs)
- [NCBI E-utilities ドキュメント](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [NCBI APIキー登録](https://www.ncbi.nlm.nih.gov/account/)
- [PubMed 検索ヘルプ](https://pubmed.ncbi.nlm.nih.gov/help/)
- [Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Secret Manager ドキュメント](https://cloud.google.com/secret-manager/docs)
