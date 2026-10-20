# Autenticação n8n — Price Crossover Social

Configuração operacional para o n8n executar `reserve`/`confirm`/`release` e a leitura de
candidatos do Price Crossover sem JWT de usuário e sem `$env` nos headers (bloqueado no
n8n 2.7.4 com `access to env vars denied`).

## Modelo de autenticação

Os endpoints protegidos usam a política `SocialAutomation` da API, que aceita **um dos dois**:

1. JWT Bearer válido (`Authorization: Bearer {token}`) — comportamento preservado; ou
2. Header `X-Social-Key` com o valor de `SocialAutomation:ApiKey` — caminho do n8n.

Regras da validação por chave (`CriptoVersus.API/Service/SocialAutomationAuthenticationService.cs`):

- chave ausente, vazia ou só com espaços: **negada**;
- `SocialAutomation:ApiKey` vazia/ausente na API: autenticação por chave **negada** (fail-closed);
- comparação de tempo constante (hash SHA-256 + `CryptographicOperations.FixedTimeEquals`);
- a chave nunca aparece em respostas, logs ou diagnósticos.

A proteção roda no pipeline de autorização, antes da execução das operações do controller.
Nenhum endpoint de escrita usa `[AllowAnonymous]` como mecanismo de acesso.

## Endpoints

| Método | Rota | Acesso |
|---|---|---|
| GET | `/api/social/price-crossover/highlight` | Público (sem efeito colateral) |
| GET | `/api/social/price-crossover/{matchId}` | Público (sem efeito colateral) |
| GET | `/api/social/price-crossover/highlights/candidates` | JWT ou `X-Social-Key` |
| POST | `/api/social/price-crossover/{matchId}/reserve` | JWT ou `X-Social-Key` |
| POST | `/api/social/price-crossover/{matchId}/confirm` | JWT ou `X-Social-Key` |
| POST | `/api/social/price-crossover/{matchId}/release` | JWT ou `X-Social-Key` |
| POST | `/api/social/coin-profile` | JWT ou `X-Social-Key` |

Comportamento esperado:

| Cenário | Resultado |
|---|---|
| Chave correta | Permitido (2xx da operação) |
| Chave incorreta | HTTP 401 |
| Chave ausente ou vazia | HTTP 401 |
| `SocialAutomation:ApiKey` não configurada na API | HTTP 401 para chamadas por chave |
| JWT válido | Permitido |
| JWT inválido | Negado (HTTP 401) |
| GET público sem credenciais | Permitido |

## Configuração da API

A chave vive em `SocialAutomation:ApiKey`. Em contêiner, a variável de ambiente usa
convenção `__`:

```yaml
# trecho do compose da API (o compose de produção é externo a este repositório)
services:
  criptoversus-api:
    environment:
      SocialAutomation__ApiKey: ${CV_SOCIAL_API_KEY}
```

- Gere uma chave forte, por exemplo `openssl rand -hex 32`.
- Guarde o valor no `.env`/mecanismo de secrets do compose; **não** commite o valor.
  `CV_SOCIAL_API_KEY` acima é só o nome do arquivo de ambiente do compose; a API lê
  `SocialAutomation__ApiKey`.
- A API e o n8n devem usar **exatamente o mesmo valor**.
- Rotacione a chave nos dois lados em conjunto.

## Configuração no n8n (credencial Header Auth)

1. Em **Credentials**, crie uma credencial do tipo **Header Auth**:
   - **Name**: `X-Social-Key`
   - **Value**: a mesma chave configurada na API (campo de credencial, nunca no JSON).
2. Nos nodes `HTTP Request` que chamam os endpoints protegidos, escolha
   *Authentication → Generic Credential Type → Header Auth* e selecione a credencial.
3. **Não** use `Authorization: Bearer {{$env.CV_SOCIAL_API_TOKEN}}` — o n8n 2.7.4 nega
   acesso a `$env` em headers.
4. **Não** grave segredos no JSON do workflow; workflows exportáveis/importáveis devem
   referenciar apenas o nome da credencial.

Configuração de exemplo de um node `HTTP Request` (sem segredos):

```json
{
  "authentication": "genericCredentialType",
  "genericAuthType": "httpHeaderAuth",
  "credentials": {
    "httpHeaderAuth": {
      "name": "CriptoVersus Social API (X-Social-Key)"
    }
  }
}
```

Exemplo de chamada:

```bash
curl -X POST "$API_BASE_URL/api/social/price-crossover/123/reserve" \
  -H "X-Social-Key: $CHAVE_SOCIAL" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"n8n\"}"
```

## Idempotência da publicação

As regras de publicação não mudaram (`PriceCrossoverPublicationService`):

- Chave de idempotência: `price_crossover_highlight:{matchId}`.
- `reserve` repetido para a mesma partida responde 409 com `already_reserved` e não cria
  nova reserva (uma reserva expirada pode ser reivindicada).
- `confirm` com `outcome=unknown` marca `reconciliation_required` e bloqueia nova tentativa
  até um `release` explícito.

## Impactos de compatibilidade

- `POST /api/social/coin-profile` deixou de aceitar chamadas anônimas quando
  `SocialAutomation:ApiKey` está vazia (comportamento permissivo corrigido). Chamadas sem
  JWT devem enviar `X-Social-Key` com a chave configurada; caso contrário recebem 401.
- A resposta de autenticação negada é HTTP 401; o corpo JSON
  (`Chave de automacao invalida. Informe X-Social-Key ou use JWT.`) é informativo e não
  faz parte de contrato versionado.
- Endpoints públicos de consulta e contratos de `reserve`/`confirm`/`release` permanecem
  inalterados.

## Payload de `GET /highlights/candidates`

Parâmetros de consulta: `lookbackHours` (1..48, padrão 6), `take` (1..50, padrão 10) e
`minInterestScore` (padrão `PriceCrossover:MinInterestScore`, 50). Candidatos com
`interestScore` abaixo do piso não entram na lista (`filteredByMinInterestScore` informa a
quantidade descartada); o piso nunca é rebaixado — quando faltam candidatos, a API amplia a
varredura de partidas (limitada a `2 * max(take, MaxCandidates)` análises por consulta).

Cada candidato traz o contrato completo de avaliação: `assetA`/`assetB` (`teamId`, `symbol`,
`baseAsset`, `quoteAsset`), `canPost`/`skipReason`, `dataQuality.isSufficient`/
`canReconstructChart`, `publicUrl`/`publicUrlAvailable`, `alreadyPublished`/
`publicationStatus`, `narrative`, `isEligible`/`isSelected` e `rejectionReasons`. Símbolos
nunca são inventados: partida sem moeda cadastrada aparece com `symbol: ""` e
`rejectionReasons: ["missing_asset_symbols"]`.

Fluxo recomendado no n8n: filtrar `isEligible == true`, usar `publicUrl` apenas quando
`publicUrlAvailable == true` e reservar o `matchId` de `selectedMatchId` (ou do primeiro
candidato elegível). Rotina de rotação de moedas: a API já evita ativos publicados no mesmo
dia (`asset_already_published_today`) e pares repetidos em 72h (`pair_recently_published`),
considerando apenas publicações confirmadas (`posted`); reserva ou tentativa falha não marcam
a partida como publicada (`alreadyPublished` só é `true` com `confirm` + `outcome=posted`).

## Verificação

```powershell
dotnet test "CriptoVersus.API.Tests/CriptoVersus.API.Tests.csproj" --filter "FullyQualifiedName~SocialAutomation"
```

Os testes cobrem chave correta/incorreta/ausente, configuração de chave ausente, JWT
válido e inválido, GET público, reserva duplicada (idempotência preservada) e ausência de
material de chave em logs. Todos rodam com EF Core InMemory e não realizam publicação
externa.
