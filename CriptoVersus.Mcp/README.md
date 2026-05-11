# CriptoVersus MCP

CriptoVersus MCP e um servidor MCP read-only para agentes de IA consumirem dados publicos do CriptoVersus via HTTP.

Esta versao inclui:

- landing page publica em `GET /`
- health check em `GET /health`
- transporte MCP Streamable HTTP em `POST /mcp`
- login com wallet Solana por assinatura de mensagem
- geracao de tokens MCP por wallet
- listagem e revogacao de tokens
- compatibilidade com o `MCP_AUTH_TOKEN` legado

## Garantias desta versao

- Sem acesso direto ao banco principal do CriptoVersus
- Sem wallet custody
- Sem private key
- Sem seed phrase
- Sem ledger
- Sem `create_position`
- Sem `close_position`
- Sem funcoes financeiras

## Estrutura principal

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

## Variaveis de ambiente

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

Notas:

- `MCP_AUTH_TOKEN` continua funcionando como token admin/fallback.
- Tokens de wallet gerados pela UI passam a funcionar em paralelo no `/mcp`.
- Se `MCP_AUTH_TOKEN` estiver vazio, o modo aberto continua permitido apenas em desenvolvimento.

## Instalar localmente

```bash
cd CriptoVersus.Mcp
cp .env.example .env
npm install
```

## Rodar localmente

Para desenvolvimento:

```bash
npm run dev
```

Para build manual:

```bash
npm run build
npm run start
```

## Teste local sugerido

1. Configure `.env` com:

```env
NODE_ENV=development
CRIPTO_VERSUS_API_BASE_URL=http://127.0.0.1:8080
MCP_PUBLIC_BASE_URL=http://127.0.0.1:8787
MCP_AUTH_TOKEN=admin-test-token
MCP_TOKEN_DB_PATH=./data/criptoversus-mcp.sqlite
```

2. Suba a API publica do CriptoVersus, ou um mock local para:

- `GET /api/social/hot-matches`
- demais endpoints publicos usados pelas tools

3. Rode:

```bash
npm run dev
```

4. Verifique a landing:

```bash
curl http://127.0.0.1:8787/
```

5. Verifique o health:

```bash
curl http://127.0.0.1:8787/health
```

6. Abra a pagina no navegador, conecte Phantom e gere um token.

## Tools disponiveis

- `get_live_matches`
- `get_hot_matches`
- `get_match_stats`
- `get_rankings`

Todas permanecem read-only.

## Exemplo de configuracao MCP

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

## Curl para testar token novo

Troque `YOUR_TOKEN` pelo token gerado na landing page:

```bash
curl -X POST "https://mcp.criptoversus.com/mcp" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
```

Teste de chamada de tool:

```bash
curl -X POST "https://mcp.criptoversus.com/mcp" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_hot_matches\",\"arguments\":{\"minHotScore\":0,\"limit\":5}}}"
```

## Docker

Build:

```bash
docker compose up -d --build
```

Logs:

```bash
docker compose logs -f --tail 100 criptoversus-mcp
```

Persistencia:

- SQLite em `/data/criptoversus-mcp.sqlite`
- volume local mapeado em `./data:/data`

## Checklist de seguranca

- Tokens MCP sao armazenados apenas como hash SHA-256
- Session tokens sao armazenados apenas como hash SHA-256
- O token MCP completo aparece uma unica vez no momento da criacao
- Nenhuma private key e armazenada
- Nenhuma seed phrase e solicitada
- Challenges expiram em 5 minutos
- Challenges sao de uso unico
- Sessions expiram em 24 horas
- Tokens podem ser revogados pela propria wallet
- Tokens revogados deixam de funcionar no `/mcp`
- `MCP_AUTH_TOKEN` legado continua suportado
- Erros retornam mensagens limpas sem stack trace para o cliente
