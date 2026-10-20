# CriptoVersus — Price Crossover Social (captura de imagem)

Referência operacional da imagem social do Price Crossover, gerada a partir da página pública e capturada pelo Browserless (n8n).

- Workflow de exemplo: [criptoversus-price-crossover-social-workflow.json](criptoversus-price-crossover-social-workflow.json)

## Página de captura

- Rota pública: `https://www.criptoversus.com/[/{lang}/]social/price-crossover/{matchId}`
  (ex.: `https://www.criptoversus.com/pt/social/price-crossover/41212`)
- Código: `CriptoVersus/Components/Pages/Internet/PriceCrossoverSocial.razor`
- Renderer do gráfico: `CriptoVersus/wwwroot/js/priceCrossoverSocialCard.mjs`
- Modelo/formatos: `CriptoVersus/Services/PriceCrossoverSocialCardModel.cs`

## Presets de imagem

| Preset | Viewport do Browserless | Como pedir | Uso |
|---|---|---|---|
| 4:3 (padrão) | `1200 x 900` | `.../pt/social/price-crossover/{id}` | Binance Square e feeds que aceitam proporção livre |
| 16:9 | `1200 x 675` | `.../pt/social/price-crossover/{id}?preset=16x9` | X/Twitter (múltiplas imagens recomendam 1200×675) |

O card tem tamanho fixo igual ao viewport exportado. Não há recorte nem distorção:
o preset 16:9 é uma composição compactada da mesma peça, não um corte do 4:3.

Ajuste no node Browserless (corpo JSON):

```text
{ url: <publicUrl>, options: { fullPage: false, type: 'png' }, viewport: { width: 1200, height: 900 } }
```

Para 16:9, use `?preset=16x9` na URL e `viewport: { width: 1200, height: 675 }`.

## Cultura e tradução

- A cultura vem do caminho (`/pt/...`, `/en/...`), de `?culture=pt-BR`/`?lang=...`, da
  preferência do usuário (`cv_culture`) ou do `Accept-Language`.
- Fallback final da imagem: `pt-BR`.
- As chaves ficam em `CriptoVersus/i18n.<cultura>.json`, bloco `social.priceCrossover`
  (aninhado, nunca `"chart.title"` plano).
- Validação antes de publicar: `npm run test:i18n` (inclui
  `tools/i18n-price-crossover-validate.mjs`, que falha se alguma chave não resolver em
  qualquer cultura). Em runtime, `detectUnresolvedLocalizationKeys` zera
  `data-social-ready` se alguma chave literal aparecer no DOM.

## `publicUrl` / `publicUrlAvailable` (contrato da API)

O endpoint `GET /api/social/price-crossover/highlight` (e `GET /{matchId}`) devolve:

```json
{
  "highlight": {
    "matchId": 41393,
    "status": "Completed",
    "canPost": true,
    "publicUrl": "https://www.criptoversus.com/pt/social/price-crossover/41393",
    "publicUrlAvailable": true
  }
}
```

Regras:

- `publicUrl` = `{origem}/{cultura}/social/price-crossover/{matchId}`. O `matchId` da URL
  é sempre o da partida analisada.
- A **origem** vem só de configuração da API (nunca de cabeçalhos HTTP):
  `PriceCrossover:PublicBaseUrl` → `CriptoVersus:PublicBaseUrl` →
  `SocialAutomation:PublicBaseUrl` → padrão `https://www.criptoversus.com`.
  Origem inválida (sem `http(s)`) mantém `publicUrlAvailable: false` — nunca se inventa URL.
- A **cultura** respeita as rotas suportadas (`en`, `pt`, `zh`, `es`, `fr`, `de`, `it`, `ja`),
  aceitando o idioma completo (`pt-BR`) ou a cultura de rota (`pt`). Idioma não suportado
  cai no fallback da imagem: `pt` (`/pt/...`).
- `publicUrlAvailable: true` somente quando a página deve chegar a
  `data-social-ready="true"`: partida `Completed`, símbolos dos dois ativos presentes,
  qualidade de dados suficiente para reconstruir o gráfico e publicação permitida
  (`canPost` — não publicada, não reservada). A existência do `matchId` nunca basta.
- Quando `publicUrlAvailable: false`, `publicUrl` é `null`. O workflow **não** deve
  capturar nem reservar: `URL de captura ausente` é o sinal correto de "página não pronta".

Estados distintos que o workflow deve separar:

| Sinal | Onde | Significado |
|---|---|---|
| `hasHighlight` / `highlight.canPost` | `/highlight` | partida elegível para publicação |
| `highlight.publicUrlAvailable` | `/highlight` | página pronta para captura |
| `publication.status: reserved` | `/reserve` | reserva confirmada (lease ativo) |
| `publication.status: posted` | `/confirm` | publicação externa confirmada |

## Contrato de prontidão para captura

Aguardar `#price-crossover-social-card[data-social-ready="true"]`. O atributo só é
definido quando todos estão satisfeitos:

- `data-capture-state="ready"`
- `data-cs-ready="true"` (modelo completo e publicável)
- `data-render-complete="true"` (canvas pintado)
- `data-fonts-ready="true"` / `data-images-ready="true"`
- `data-i18n-ok="true"` (nenhuma chave de tradução não resolvida)

O mesmo elemento expõe os atributos usados pelo seletor composto do node Browserless
atual do workflow n8n:

```text
.tv-price-battle[data-social-ready="true"][data-match-status="finished"][data-data-complete="true"][data-render-complete="true"]
```

- `.tv-price-battle` — alias de compatibilidade no próprio card de captura (o CSS do
  `TvMatchPriceBattleChart` não vaza: isolamento por componente do Blazor).
- `data-match-status` — token de captura: `finished` (partida concluída), `in_progress`
  (pendente/em andamento) ou `unknown` (cancelada/erro). O status cru da API
  (ex.: `Completed`) fica em `data-api-status`.
- `data-data-complete` — `true` só com os dados da imagem carregados e completos
  (série reconstruível, dois símbolos, qualidade suficiente). Falhas de carregamento
  nunca marcam como pronto.
- `data-render-complete` — `true` só após o canvas ser realmente pintado.

Os dois seletores apontam para o **mesmo** elemento; use o que o seu node já espera.
Não capturar por timeout fixo: sem `data-social-ready` a imagem não deve ser publicada.
O elemento contém o gráfico (Canvas 2D) e todos os dados sociais; o card é fixo em
1200×900 (4:3) e cabe em viewport 1280×900 sem scroll nem corte.

## Configuração de produção

- **API** — origem pública usada em `publicUrl` (nesta ordem):
  `PriceCrossover:PublicBaseUrl` → `CriptoVersus:PublicBaseUrl` →
  `SocialAutomation:PublicBaseUrl` → padrão `https://www.criptoversus.com`.
  Em container, a variável usa convenção `__` (ex.: `PriceCrossover__PublicBaseUrl`).
  O valor deve ser a origem **real** servida do site (a mesma do canonical/hreflang da Web);
  `https://criptoversus.com` sem `www` só é correto se for essa origem.
  Se `publicUrlAvailable` vier `false` com partida elegível, verifique primeiro esta chave.
- `PriceCrossover:Enabled=false` desabilita a seleção de destaques
  (`/highlight` deixa de indicar partidas) — é o interruptor de modo seguro do fluxo.
- **n8n** — credencial Header Auth `X-Social-Key` com o mesmo valor de
  `SocialAutomation:ApiKey` da API (ver [docs/n8n-price-crossover-auth.md](../../docs/n8n-price-crossover-auth.md)).

## Validação automatizada

```powershell
npm run test:i18n --prefix "CriptoVersus"
npm run test:price-crossover-social --prefix "CriptoVersus"
dotnet test "EthicAI.test/EthicAI.test.csproj" --filter "FullyQualifiedName~PriceCrossoverSocialCardTests"
```

`test:price-crossover-social` gera as páginas com os dados reais da partida 41212
(`tools/price-crossover/fixtures/match-41212.json`), executa a captura Playwright e
grava os PNGs em `tmp/price-crossover-social-captures/`. Os testes cobrem dimensões,
bounds (nenhum elemento ultrapassa o card), scroll, i18n, janela temporal completa e
regressões (símbolos longos, muitos cruzamentos, métricas ausentes).

## Publicação

Workflow, reserva e confirmação continuam em `PriceCrossoverPublicationService`
(`reserve`/`confirm`/`release`, idempotência `price_crossover_highlight:{matchId}`).
Não publicar automaticamente durante testes.

**Não realizar reserva quando `publicUrlAvailable: false` e não operar fora de modo
seguro**: sem página pronta não há o que capturar e a reserva só bloquearia a partida.

### Contratos reais de `reserve` / `confirm` / `release`

Autenticação (obrigatória nos três): JWT Bearer **ou** header `X-Social-Key`
(ver `docs/n8n-price-crossover-auth.md`). Não existe `leaseToken` no contrato real —
não envie nem espere um. A propriedade da reserva é definida pela chave de idempotência
`price_crossover_highlight:{matchId}` + janela de lease.

`POST /{matchId}/reserve` — corpo `{ "owner": "n8n", "leaseSeconds": 900 }` (ambos opcionais;
`leaseSeconds` tem teto de 7200 e padrão `PriceCrossover:ReservationLeaseSeconds` = 900).

| Resultado | HTTP | `result` |
|---|---|---|
| Reserva criada/renovada | 200 | `reserved` (com `publication.status: reserved` e `leaseExpiresAtUtc`) |
| Já publicada | 409 | `already_published` |
| Já reservada por lease ativo | 409 | `already_reserved` |
| Em reconciliação | 409 | `reconciliation_required` |
| Corrida de reserva | 409 | `already_reserved` (índice único decide) |

Lease expirado (`leaseExpiresAtUtc` no passado) permite reivindicar a reserva; estado
`failed` também. Reserva repetida para a mesma partida nunca cria duplicata.

`POST /{matchId}/confirm` — corpo `{ "outcome": "posted" | "failed" | "unknown", "externalPostId": "...", "externalPostUrl": "...", "error": "..." }`.

| `outcome` | Efeito |
|---|---|
| `posted` | `publication.status: posted`, registra `externalPostId`/`externalPostUrl`, limpa lease |
| `failed` | `publication.status: failed`, libera a partida para nova tentativa |
| `unknown` | `publication.status: reconciliation_required` e **bloqueia** nova tentativa até `release` explícito |

Sem reserva prévia: 409 `not_reserved`. `confirm` em `posted`: 409 `already_published`.

`POST /{matchId}/release` — corpo `{ "reason": "..." }` (opcional). Marca `failed` com o
motivo e libera a reserva. Em `posted`: 409 `already_published`. Sem reserva: 409 `not_reserved`.

`confirm`/`release` validam a partida pelo `matchId` + política de autenticação; qualquer
portador válido de `X-Social-Key` (ou JWT) da automação pode confirmar/liberar — não há
token de propriedade separado. Proteção contra duplicatas: a chave de idempotência única
+ máquina de estados (`posted` é terminal para nova reserva).


## Autenticacao (n8n + API)

Reserva, confirmacao e liberacao exigem autenticacao (JWT Bearer ou header `X-Social-Key`).
No n8n, use uma credencial do tipo Header Auth (Name: `X-Social-Key`) e nao use
`$env.CV_SOCIAL_API_TOKEN` nos headers.

Configuracao operacional completa (API + n8n): [docs/n8n-price-crossover-auth.md](../../docs/n8n-price-crossover-auth.md)
