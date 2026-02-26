# PubMed MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that gives Claude and other LLM clients structured access to [PubMed](https://pubmed.ncbi.nlm.nih.gov/) and [PubMed Central (PMC)](https://www.ncbi.nlm.nih.gov/pmc/) via the NCBI E-utilities API.

## Tools

| Tool | 説明 |
|------|------|
| `search_articles` | PubMed構文またはキーワードで文献を検索。日付フィルタ・ソート・ページネーション対応 |
| `get_article_metadata` | PMIDを指定してタイトル・抄録・著者・MeSH語・キーワードなどを取得 |
| `find_related_articles` | ELinkを使って関連文献や他DBへのリンクを検索 |
| `lookup_article_by_citation` | 雑誌名・年・巻・筆頭著者などの引用情報からPMIDを逆引き |
| `convert_article_ids` | PMID・PMCID・DOI を相互変換 |
| `get_full_text_article` | PMC Open Access記事の本文全文をプレーンテキストで取得 |
| `get_copyright_status` | 記事のPMC収録状況・ライセンス・OAステータスを確認 |

---

## 必要環境

- **Node.js** 18 以上
- **npm** 8 以上
- **NCBI API キー**（任意。なくても動作するが、レートリミットが 3 req/s に制限される）

---

## インストール

```bash
git clone <このリポジトリのURL>
cd PubMed_MCP
npm install
npm run build
```

### NCBI API キーの設定（推奨）

APIキーを取得するとレートリミットが 3 → 9 req/s に向上します。

1. [NCBI アカウント](https://www.ncbi.nlm.nih.gov/account/)を作成してAPIキーを発行
2. 環境変数 `NCBI_API_KEY` にセット（後述のクライアント別設定を参照）

---

## 使い方

### Claude Desktop（ローカル）

`claude_desktop_config.json` にサーバーを追加します。

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pubmed": {
      "command": "node",
      "args": ["/absolute/path/to/PubMed_MCP/dist/index.js"],
      "env": {
        "NCBI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

設定後、Claude Desktop を再起動してください。

---

### Claude Code（ローカル）

**方法 A — settings.json に直接追加**

`~/.claude/settings.json` を編集します（ファイルが存在しない場合は新規作成）。

```json
{
  "mcpServers": {
    "pubmed": {
      "command": "node",
      "args": ["/absolute/path/to/PubMed_MCP/dist/index.js"],
      "env": {
        "NCBI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**方法 B — Claude Code コマンドで追加**

```bash
claude mcp add pubmed node /absolute/path/to/PubMed_MCP/dist/index.js
```

追加後、MCP接続状態は `/mcp` コマンドで確認できます。

---

### Anthropic API（プログラムからの利用）

```python
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
        "url": "https://<your-cloud-run-url>/mcp",
        "name": "pubmed",
        "authorization_token": "<google_id_token>"  # Cloud Run IAM 認証
    }],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "pubmed"}],
    betas=["mcp-client-2025-11-20"]
)
```

Cloud Run へのデプロイ方法は後述の「[Google Cloud Run へのデプロイ](#google-cloud-run-へのデプロイ)」を参照してください。

---

### ローカル開発

```bash
# .env ファイルを作成してAPIキーを設定
cp .env.example .env
# .env を編集して NCBI_API_KEY を記入

# stdio モードで起動（デフォルト）
npm run dev

# HTTP モードで起動（PORT を設定するだけで有効になる）
PORT=8080 npm run dev
# → http://localhost:8080/mcp   MCP エンドポイント
# → http://localhost:8080/health ヘルスチェック
```

---

## Google Cloud Run へのデプロイ

このサーバーは Docker コンテナとして Google Cloud Run にデプロイできます。
`PORT` 環境変数を設定すると自動的に HTTP モードで起動し、Streamable HTTP トランスポートで MCP クライアントと通信します。
Cloud Run は `--no-allow-unauthenticated` フラグにより、Google Cloud IAM で認証されたリクエストだけを受け付けます。アプリ側に認証コードを書く必要はありません。

### 前提条件

- Google Cloud プロジェクト（課金が有効なもの）
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) インストール済み・ログイン済み

### ステップ 1 — プロジェクトと API の準備

```bash
# デプロイ先プロジェクトをセット
gcloud config set project MY_PROJECT_ID

# 必要な API を有効化（初回のみ）
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

### ステップ 2 — Artifact Registry リポジトリを作成（初回のみ）

```bash
gcloud artifacts repositories create pubmed-mcp \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="PubMed MCP Server"
```

### ステップ 3 — NCBI API キーを Secret Manager に登録（推奨）

APIキーをコマンド履歴やログに残さないために Secret Manager を使います。

```bash
echo -n "your_ncbi_api_key" | \
  gcloud secrets create ncbi-api-key \
    --data-file=- \
    --replication-policy=automatic
```

### ステップ 4 — コンテナイメージをビルドしてプッシュ

Cloud Build を使うとローカルに Docker をインストールせずにビルドできます。

```bash
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

### ステップ 5 — Cloud Run にデプロイ

```bash
gcloud run deploy pubmed-mcp \
  --image asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest \
  --region asia-northeast1 \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --no-allow-unauthenticated \
  --set-secrets NCBI_API_KEY=ncbi-api-key:latest
```

`--no-allow-unauthenticated` が認証の核心です。これにより、有効な Google ID トークンを持たないリクエストはすべて Cloud Run のインフラ層で 403 を返します。

デプロイ後に表示される URL（例: `https://pubmed-mcp-xxxx-an.a.run.app`）をメモしてください。

### ステップ 6 — IAM でアクセス権を付与

Cloud Run サービスを呼び出せるのは `roles/run.invoker` ロールを持つ ID のみです。

```bash
# 自分の Google アカウントに付与（ローカルの gcloud から呼ぶ場合）
gcloud run services add-iam-policy-binding pubmed-mcp \
  --region asia-northeast1 \
  --member "user:you@example.com" \
  --role roles/run.invoker

# 別のサービスアカウントに付与（CI / 他の GCP サービスから呼ぶ場合）
gcloud run services add-iam-policy-binding pubmed-mcp \
  --region asia-northeast1 \
  --member "serviceAccount:my-sa@MY_PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/run.invoker
```

現在の IAM ポリシーを確認するには:

```bash
gcloud run services get-iam-policy pubmed-mcp --region asia-northeast1
```

### Claude Desktop / Claude Code からリモートサーバーに接続する

Cloud Run エンドポイントには Google ID トークンが必要です。
`gcloud run services proxy` コマンドを使うと、ローカルポートを Cloud Run に転送しながらトークンを自動付与するプロキシが起動します。

**ターミナルでプロキシを常駐起動:**

```bash
gcloud run services proxy pubmed-mcp \
  --region asia-northeast1 \
  --port 8080
```

**Claude Desktop の設定 (`claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "pubmed-remote": {
      "type": "streamable-http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

**Claude Code の設定 (`~/.claude/settings.json`):**

```json
{
  "mcpServers": {
    "pubmed-remote": {
      "type": "streamable-http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

> **注意:** `gcloud run services proxy` はターミナルを閉じると終了します。
> 常時起動したい場合は systemd サービスや launchd エージェントとして登録してください。

### 動作確認

```bash
# プロキシ経由でヘルスチェック
curl http://localhost:8080/health
# → ok

# MCP initialize リクエストを送信
curl http://localhost:8080/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
```

Cloud Run に直接（プロキシなしで）確認する場合:

```bash
CLOUD_RUN_URL=$(gcloud run services describe pubmed-mcp \
  --region asia-northeast1 \
  --format='value(status.url)')

curl "$CLOUD_RUN_URL/health" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
# → ok
```

### イメージを更新する（再デプロイ）

```bash
# 新しいイメージをビルド・プッシュ
gcloud builds submit \
  --region=asia-northeast1 \
  --tag asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest

# Cloud Run を新しいイメージで更新
gcloud run services update pubmed-mcp \
  --region asia-northeast1 \
  --image asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest
```

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
| `NCBI_API_KEY` | 任意 | NCBIのAPIキー。設定するとレートリミットが 3 → 9 req/s になる |
| `PORT` | 任意 | 設定するとHTTPモードで起動。Cloud Run はこの変数を自動で注入する |

`.env` ファイルを使う場合は `.env.example` をコピーして編集してください。
本番環境では OS の環境変数、または Cloud Run の `--set-env-vars` / `--set-secrets` で渡してください。

---

## 参考リンク

- [MCP ドキュメント](https://modelcontextprotocol.io/docs)
- [NCBI E-utilities ドキュメント](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [NCBI APIキー登録](https://www.ncbi.nlm.nih.gov/account/)
- [PubMed 検索ヘルプ](https://pubmed.ncbi.nlm.nih.gov/help/)
- [Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Cloud Run IAM 認証](https://cloud.google.com/run/docs/authenticating/service-to-service)
