# CriptoVersus MCP

O `CriptoVersus MCP` e um servidor MCP read-only para agentes de IA consumirem dados publicos do CriptoVersus via HTTP, sem acesso direto ao banco e sem qualquer operacao financeira.

Esta primeira fase expoe apenas tools de consulta e usa o transporte `Streamable HTTP` no endpoint `/mcp`, com health check em `/health`.

## Requisitos

- Node.js LTS 20+
- npm 10+
- API do CriptoVersus acessivel por HTTP
- Docker e Docker Compose opcionais

## Instalacao local

1. Entre na pasta do projeto:

```bash
cd CriptoVersus.Mcp
```

2. Copie o arquivo de ambiente:

```bash
cp .env.example .env
```

3. Ajuste as variaveis no `.env`.

## Configuracao `.env`

Variaveis suportadas:

```env
CRIPTO_VERSUS_API_BASE_URL=http://criptoversus-api:8080
MCP_SERVER_NAME=criptoversus-mcp
MCP_SERVER_VERSION=0.1.0
MCP_AUTH_TOKEN=
PORT=8787
NODE_ENV=production
```

Notas:

- `MCP_AUTH_TOKEN` habilita autenticacao Bearer no endpoint `/mcp`.
- Se `MCP_AUTH_TOKEN` estiver vazio, o modo aberto e permitido apenas em `NODE_ENV=development`.
- Em `production`, o servidor falha ao iniciar se `MCP_AUTH_TOKEN` estiver vazio.

## Como instalar dependencias

```bash
npm install
```

## Como rodar em desenvolvimento

O script abaixo sobe o servidor com `NODE_ENV=development`:

```bash
npm run dev
```

Endpoints:

- `GET /health`
- `POST /mcp`

## Como buildar

```bash
npm run build
```

## Como rodar a build

```bash
npm run start
```

## Como rodar via Docker

1. Crie o arquivo `.env`:

```bash
cp .env.example .env
```

2. Ajuste o token e a URL da API.

3. Suba o container:

```bash
docker compose up -d --build
```

4. Veja os logs:

```bash
docker compose logs -f --tail 100 criptoversus-mcp
```

## Tools disponiveis

- `get_live_matches`
  - Chama `GET /api/matches/live?limit={limit}`
  - Se o endpoint nao existir, retorna `Live matches endpoint is not available yet.`

- `get_hot_matches`
  - Chama `GET /api/social/hot-matches`
  - Filtra `hotScore >= minHotScore`
  - Limita o resultado em memoria

- `get_match_stats`
  - Chama `GET /api/matches/{matchId}/stats`
  - Se o endpoint nao existir, retorna `Match stats endpoint is not available yet.`

- `get_rankings`
  - Chama `GET /api/rankings?type={type}&limit={limit}`
  - Se o endpoint nao existir, retorna `Ranking endpoint is not available yet.`

## Seguranca

- O MCP nao acessa o banco diretamente.
- O MCP consome apenas a API HTTP existente do CriptoVersus.
- Nao ha tools financeiras nesta fase.
- Nao ha `create_position` nem `close_position`.
- Nao ha wallet, custody, ledger, assinatura ou private key.
- Tokens e headers sensiveis nao sao logados.
- Erros retornam mensagens limpas ao cliente, sem stack trace.
- As chamadas HTTP para a API usam timeout.

## Aviso

Esta versao e estritamente read-only e nao expoe nenhuma movimentacao financeira.
