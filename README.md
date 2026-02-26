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

### Claude Desktop

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

### Claude Code

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
        "url": "https://pubmed.mcp.claude.com/mcp",  # 公式Anthropicホスト版
        "name": "pubmed"
    }],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "pubmed"}],
    betas=["mcp-client-2025-11-20"]
)
```

このリポジトリをセルフホストして使う場合は、HTTPトランスポートを別途実装するか、stdioをそのまま使うクライアントから起動してください。

---

### ローカル開発

```bash
# .env ファイルを作成してAPIキーを設定
cp .env.example .env
# .env を編集して NCBI_API_KEY を記入

# 開発サーバーを起動（tsx でホットリロード不要の場合はそのまま実行）
npm run dev
```

---

## 開発コマンド

```bash
npm run build      # TypeScript をコンパイル → dist/
npm run dev        # tsx で直接実行（開発用）
npm test           # テストスイートを実行（47テスト）
npm run typecheck  # 型チェックのみ（コンパイルなし）
npm run lint       # ESLint を実行
```

---

## 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `NCBI_API_KEY` | 任意 | NCBIのAPIキー。設定するとレートリミットが 3 → 9 req/s になる |

`.env` ファイルを使う場合は `.env.example` をコピーして編集してください。
本番環境ではOSの環境変数（systemd `EnvironmentFile=`、Docker `--env` など）で渡すことを推奨します。

---

## 参考リンク

- [MCP ドキュメント](https://modelcontextprotocol.io/docs)
- [NCBI E-utilities ドキュメント](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [NCBI APIキー登録](https://www.ncbi.nlm.nih.gov/account/)
- [PubMed 検索ヘルプ](https://pubmed.ncbi.nlm.nih.gov/help/)
