# Deploy manual na VPS

Este projeto foi preparado para deploy manual posterior.

Nenhum comando desta entrega acessa ou altera a sua VPS automaticamente.

## 1. Copiar ou atualizar o codigo

Opcao A, copiar apenas a pasta do MCP:

```bash
cd /home/admin/stacks
mkdir -p criptoversus-mcp
cd criptoversus-mcp
```

Depois copie o conteudo de `CriptoVersus.Mcp/`.

Opcao B, usar o repositorio inteiro:

```bash
cd /home/admin/stacks
cd <repositorio>/CriptoVersus.Mcp
```

## 2. Preparar `.env`

```bash
cp .env.example .env
nano .env
```

Defina pelo menos:

```env
CRIPTO_VERSUS_API_BASE_URL=http://criptoversus-api:8080
MCP_PUBLIC_BASE_URL=https://mcp.criptoversus.com
MCP_AUTH_TOKEN=SEU_TOKEN_ADMIN_OPCIONAL
MCP_TOKEN_DB_PATH=/data/criptoversus-mcp.sqlite
MCP_TOKEN_PREFIX=cv_mcp_
MCP_TOKEN_DEFAULT_DAILY_LIMIT=1000
PORT=8787
NODE_ENV=production
```

## 3. Subir o container

```bash
docker compose up -d --build
docker compose logs -f --tail 100 criptoversus-mcp
docker ps
```

## 4. Persistencia

O `docker-compose.yml` monta:

```text
./data:/data
```

O banco SQLite de tokens fica em:

```text
/data/criptoversus-mcp.sqlite
```

## 5. Validacao manual

Health:

```bash
curl http://127.0.0.1:8787/health
```

Resposta esperada:

```json
{
  "status": "ok",
  "name": "criptoversus-mcp",
  "version": "0.1.0"
}
```

Teste do token admin legado:

```bash
curl -X POST "http://127.0.0.1:8787/mcp" \
  -H "Authorization: Bearer SEU_TOKEN_ADMIN_OPCIONAL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
```

## 6. Nginx Proxy Manager

Configurar:

- Domain: `mcp.criptoversus.com`
- Forward Host: `criptoversus-mcp`
- Forward Port: `8787`
- WebSocket Support: `ON`
- SSL: `Let's Encrypt`
- Force SSL: `ON`

## 7. Fluxo esperado em producao

- usuario acessa `https://mcp.criptoversus.com/`
- conecta Phantom
- assina o challenge
- gera um token `cv_mcp_*`
- usa esse token em Claude, Cursor ou OpenHands
- pode listar e revogar o token depois
