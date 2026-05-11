# CriptoVersus MCP

CriptoVersus MCP is a remote Streamable HTTP MCP server that allows AI agents to consume live public crypto battle, ranking and match data from CriptoVersus.

Public developer portal:

https://mcp.criptoversus.com

---

## Endpoint

```text
https://mcp.criptoversus.com/mcp
```

---

## Transport

```text
Streamable HTTP
```

---

## Authentication

```text
Bearer Token
```

Generate your token at:

```text
https://mcp.criptoversus.com
```

---

## Features

- Remote MCP Server
- Streamable HTTP transport
- Wallet-based authentication
- MCP token generation
- Read-only crypto match tools
- HTTPS public endpoint
- Solana wallet login
- MCP token revocation
- Persistent token storage via SQLite

---

## Current Scope

Current version is intentionally read-only.

No financial actions are exposed.

No custody operations are available.

No blockchain transactions are executed by the MCP server.

---

## This version includes

- Public landing page in `GET /`
- Health check in `GET /health`
- MCP Streamable HTTP transport in `POST /mcp`
- Solana wallet login via signed message
- MCP token generation per wallet
- Token listing and revocation
- Compatibility with legacy `MCP_AUTH_TOKEN`

---

## Security Guarantees

- No direct access to the main CriptoVersus database
- No wallet custody
- No private key storage
- No seed phrase usage
- No ledger access
- No `create_position`
- No `close_position`
- No financial functions

---

## Main Structure

```text
CriptoVersus.Mcp/
  src/
    auth/
    db/
    http/
    public/
    routes/
    tools/
    utils/
```

---

## Environment Variables

```env
CRIPTO_VERSUS_API_BASE_URL=http://criptoversus-api:8080
MCP_SERVER_NAME=criptoversus-mcp
MCP_SERVER_VERSION=0.1.0
MCP_AUTH_TOKEN=
MCP_TOKEN_DB_PATH=/data/criptoversus-mcp.sqlite
MCP_PUBLIC_BASE_URL=https://mcp.criptoversus.com
MCP_TOKEN_PREFIX=cv_mcp_
MCP_TOKEN_DEFAULT_DAILY_LIMIT=1000
PORT=8787
NODE_ENV=production
```

### Notes

- `MCP_AUTH_TOKEN` continues to work as an admin/fallback token
- Wallet-generated MCP tokens work in parallel on `/mcp`
- If `MCP_AUTH_TOKEN` is empty, open mode remains allowed only in development mode

---

## Install Locally

```bash
cd CriptoVersus.Mcp
cp .env.example .env
npm install
```

---

## Run Locally

### Development mode

```bash
npm run dev
```

### Manual build

```bash
npm run build
npm run start
```

---

## Suggested Local Test

### 1. Configure `.env`

```env
NODE_ENV=development
CRIPTO_VERSUS_API_BASE_URL=http://127.0.0.1:8080
MCP_PUBLIC_BASE_URL=http://127.0.0.1:8787
MCP_AUTH_TOKEN=admin-test-token
MCP_TOKEN_DB_PATH=./data/criptoversus-mcp.sqlite
```

### 2. Start CriptoVersus public API or a local mock

Required endpoints:

- `GET /api/social/hot-matches`
- Other public endpoints used by MCP tools

### 3. Run development server

```bash
npm run dev
```

### 4. Verify landing page

```bash
curl http://127.0.0.1:8787/
```

### 5. Verify health endpoint

```bash
curl http://127.0.0.1:8787/health
```

### 6. Open browser, connect Phantom and generate a token

---

## Available Tools

- `get_live_matches`
- `get_hot_matches`
- `get_match_stats`
- `get_rankings`

All tools remain strictly read-only.

---

## MCP Configuration Example

```json
{
  "mcpServers": {
    "criptoversus": {
      "transport": {
        "type": "streamable-http",
        "url": "https://mcp.criptoversus.com/mcp",
        "headers": {
          "Authorization": "Bearer YOUR_TOKEN"
        }
      }
    }
  }
}
```

---

## Test Generated Token

Replace `YOUR_TOKEN` with a token generated from the landing page.

### List available tools

```bash
curl -X POST "https://mcp.criptoversus.com/mcp" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
```

### Tool execution example

```bash
curl -X POST "https://mcp.criptoversus.com/mcp" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_hot_matches\",\"arguments\":{\"minHotScore\":0,\"limit\":5}}}"
```

---

## Docker

### Build

```bash
docker compose up -d --build
```

### Logs

```bash
docker compose logs -f --tail 100 criptoversus-mcp
```

### Persistence

- SQLite database in `/data/criptoversus-mcp.sqlite`
- Local volume mounted as `./data:/data`

---

## Security Checklist

- MCP tokens are stored only as SHA-256 hashes
- Session tokens are stored only as SHA-256 hashes
- Full MCP token appears only once during creation
- No private key is stored
- No seed phrase is requested
- Challenges expire after 5 minutes
- Challenges are single-use
- Sessions expire after 24 hours
- Tokens can be revoked by the owning wallet
- Revoked tokens stop working immediately on `/mcp`
- Legacy `MCP_AUTH_TOKEN` remains supported
- Errors return clean messages without stack traces to clients