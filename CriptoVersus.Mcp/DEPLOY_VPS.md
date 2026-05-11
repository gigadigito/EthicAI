# Deploy manual na VPS

Este projeto foi preparado para deploy manual posterior. Nenhuma alteracao automatica em VPS e realizada por este repositorio.

## Opcao 1: copiar apenas a pasta do MCP

```bash
cd /home/admin/stacks
mkdir -p criptoversus-mcp
cd criptoversus-mcp
```

Copie para esta pasta os arquivos gerados em `CriptoVersus.Mcp/`.

## Opcao 2: fazer git pull do repositorio completo

Se a VPS hospedar o repositorio inteiro do CriptoVersus, voce pode atualizar o codigo e entrar na pasta:

```bash
cd /home/admin/stacks
# entrar no repositorio existente ou clonar, conforme sua estrutura final
cd <repositorio>/CriptoVersus.Mcp
```

## Configuracao

```bash
cp .env.example .env
nano .env
```

Ajuste pelo menos:

- `CRIPTO_VERSUS_API_BASE_URL`
- `MCP_AUTH_TOKEN`
- `NODE_ENV=production`

Observacao:

- Em producao, o servidor nao inicia se `MCP_AUTH_TOKEN` estiver vazio.

## Subir com Docker Compose

```bash
docker compose up -d --build
docker compose logs -f --tail 100 criptoversus-mcp
docker ps
```

## Nginx Proxy Manager

Configurar proxy reverso com:

- Domain: `mcp.criptoversus.com`
- Forward Host: `criptoversus-mcp`
- Forward Port: `8787`
- WebSocket Support: `ON`
- SSL: `Let's Encrypt`
- Force SSL: `ON`

## Validacao rapida

Health check esperado:

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
