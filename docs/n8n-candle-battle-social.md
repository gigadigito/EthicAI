# Candle Battle Social — integração n8n

O Candle Battle Social usa a mesma política `SocialAutomation`, a tabela
`social_post_history` e os estados de publicação do Price Crossover. Configure
uma credencial **Header Auth** do n8n com o nome `X-Social-Key`; o valor deve ser
configurado somente no gerenciador de credenciais do n8n e em
`SocialAutomation:ApiKey` na API. Nunca inclua o valor em um workflow exportado.

| Método | Rota | Acesso |
|---|---|---|
| GET | `/api/social/candle-battle/highlight` | público |
| GET | `/api/social/candle-battle/highlights/candidates` | `SocialAutomation` |
| GET | `/api/social/candle-battle/{matchId}` | público |
| POST | `/api/social/candle-battle/{matchId}/reserve` | `SocialAutomation` |
| POST | `/api/social/candle-battle/{matchId}/confirm` | `SocialAutomation` |
| POST | `/api/social/candle-battle/{matchId}/release` | `SocialAutomation` |

Os GETs não alteram reservas. Os três POSTs retornam o mesmo contrato
`PriceCrossoverPublicationResult` e os mesmos estados e códigos HTTP do Price
Crossover (`200` para sucesso, `409` para conflito). A chave de idempotência é
`candle_battle_highlight:{matchId}` e não interfere na categoria
`price_crossover_highlight`. A migração `20261017000000_AddSocialPublicationControl`
já fornece o índice único parcial; não há migração nova.

## Sequência do workflow

1. Consulte `highlights/candidates?lookbackHours=6&take=10` com a credencial.
   Escolha `selectedMatchId` ou um candidato com `isEligible=true`.
2. Faça `POST /{matchId}/reserve` com `{"owner":"n8n-candle-battle"}`.
   Um `409` com `already_reserved`, `already_published` ou
   `reconciliation_required` encerra a tentativa. Guarde o valor
   `publication.reservedAtUtc` retornado: ele identifica esta reserva.
3. Consulte `GET /{matchId}?language=pt-BR&includeRounds=true`. A URL pública
   permanece disponível durante a reserva quando a batalha histórica está
   completa. Use `publicUrlAvailable` e aguarde no Browserless pelo seletor
   `#candle-battle-social-card[data-social-ready="true"]` antes da captura.
   A página contém o replay Phaser; `rounds` preserva os candles reais e os
   vencedores persistidos de cada confronto.
4. Prepare texto e imagem a partir da resposta. Publique na Binance Square.
   Confirme a resposta da plataforma e guarde seu identificador ou URL externa.
5. Somente após confirmação verificável, envie `POST /{matchId}/confirm` com
   `{"outcome":"posted","externalPostId":"<id confirmado>","reservedAtUtc":"<publication.reservedAtUtc>"}`.
6. Se a plataforma confirmou uma falha recuperável antes de publicar, envie
   `{"outcome":"failed","error":"<motivo>","reservedAtUtc":"<publication.reservedAtUtc>"}`
   ao endpoint `confirm` ou `POST /release` com
   `{"reason":"<motivo>","reservedAtUtc":"<publication.reservedAtUtc>"}`.
7. Se o resultado externo é desconhecido, confirme `{"outcome":"unknown"}`.
   Isso persiste `reconciliation_required` e bloqueia novas reservas. Nunca
   libere automaticamente essa reserva; reconcilie manualmente com a plataforma.

O endpoint `confirm` exige `externalPostId` ou `externalPostUrl` quando o
resultado é `posted`. Uma confirmação ou liberação com token de reserva antigo
retorna `stale_reservation`; guarde o mesmo valor durante todo o fluxo. Em
`unknown`, inclua também `reservedAtUtc`.

`GET /highlight` é uma consulta pública sem reserva. O ranking exige partida
encerrada, estado Worker `finished`, 18 confrontos contíguos e candles válidos.
Os pesos e limites ficam em `CandleBattleSocial` na configuração da API; a
categoria usa `Platform=binance_square` e lease padrão de 900 segundos.

## Formato dos contratos

Campos centrais de `GET /{matchId}`: `category`, `matchId`, `battleId`,
`battleType`, `status`, `battleStatus`, `startTimeUtc`, `endTimeUtc`,
`durationMinutes`, `assetA`, `assetB`, `scoreA`, `scoreB`, `winnerSymbol`,
`confrontationCount`, `expectedConfrontations`, `interestScore`,
`selectionReasons`, `rounds`, `replayAvailable`, `canPost`, `skipReason`,
`publication`, `publicUrl` e `publicUrlAvailable`. Cada asset inclui `symbol`,
`pair`, `logoUrl`, `openingPrice`, `closingPrice`, `performancePercent`,
`greenCandles` e `redCandles`. Os itens de `rounds` usam o DTO existente
`CandleBattlesRoundDto` com candles OHLCV confirmados.

`GET /highlights/candidates` retorna `generatedAtUtc`, `lookbackHours`,
`matchesScanned`, `eligibleCount`, `selectedMatchId` e `candidates`. Cada
candidato inclui símbolos, placar arcade, `interestScore`, `isEligible`,
`selectionReasons` e `rejectionReasons`.

## Contrato operacional dos seis endpoints

Use `Content-Type: application/json` nos POSTs. Os exemplos abaixo descrevem
o contrato; os valores entre `<...>` devem vir das respostas da API de
homologação e **não são evidência de uma partida real**. Os nomes JSON seguem
`camelCase`. Nunca registre `X-Social-Key` em logs ou exports do workflow.

| Operação | Requisição | Resposta de sucesso | Outros resultados |
|---|---|---|---|
| `GET /highlight` | `?lookbackHours=6&language=pt-BR&includeRounds=false`, sem chave | `200`: `hasHighlight`, `highlight` (mesmo contrato de `GET /{matchId}`), `candidates`, `eligibleCount`, `skipReason`, `generatedAtUtc` | Sem elegível: `200`, `hasHighlight=false`, `highlight=null`; não cria reserva |
| `GET /highlights/candidates` | `?lookbackHours=6&take=10`, `X-Social-Key` | `200`: `generatedAtUtc`, `lookbackHours`, `matchesScanned`, `eligibleCount`, `selectedMatchId`, `candidates[]` | `401` sem autenticação; `403` se a política recusar a identidade |
| `GET /{matchId}` | `?language=pt-BR&includeRounds=true`, sem chave | `200`: dados da batalha, ativos, `rounds[]`, resultado, publicação e URL | `400` para ID inválido; `404` se a partida não existe |
| `POST /{matchId}/reserve` | `{"owner":"n8n-candle-battle","leaseSeconds":900}`, `X-Social-Key` | `200`: `success=true`, `result="reserved"`, `publication.reservedAtUtc` e `publication.leaseExpiresAtUtc` | `404` se a partida não existe; `409` se inelegível, reservada, publicada ou em reconciliação |
| `POST /{matchId}/confirm` | `{"outcome":"posted","externalPostId":"<id externo>","reservedAtUtc":"<UTC da reserva>"}`, `X-Social-Key` | `200`: `result="posted"`, `publication.status="posted"`; repetir o mesmo ID ou URL externa retorna sucesso idempotente | `400` sem token ou sem ID/URL externa para `posted`; `409` para reserva antiga, estado incompatível ou publicação diferente |
| `POST /{matchId}/release` | `{"reason":"<motivo>","reservedAtUtc":"<UTC da reserva>"}`, `X-Social-Key` | `200`: `result="released"`, `publication.status="failed"` | `400` sem token; `409` para token antigo, ausência de reserva ou publicação já confirmada |

`GET /{matchId}` inclui `assetA`/`assetB` com `symbol`, `pair`, `logoUrl`,
`openingPrice`, `closingPrice`, `performancePercent`, `greenCandles` e
`redCandles`. O placar arcade (`scoreA`, `scoreB`) é contado dos vencedores
persistidos em `rounds` e não vem de `Match.ScoreA/ScoreB`. `includeRounds=false`
reduz o payload para seleção; use `true` quando precisar de OHLCV e replay.
`publication` pode ser `null`. `publicUrlAvailable=true` só quando há URL
canônica para uma batalha finalizada com histórico completo, inclusive durante
uma reserva. `canPost` indica elegibilidade **naquele instante**; revalide na
reserva para lidar com concorrência.

### Seleção e reserva

O seletor examina partidas finalizadas dentro da janela solicitada (limitada
por `MaxLookbackHours`, padrão 48). Exige estado Worker `finished`, 18 intervalos
contíguos de cinco minutos, candles confirmados e válidos, símbolos coerentes
e vencedores consistentes com o motor. Exclui pares proibidos e limita a
repetição do mesmo par (`MaxSamePairCandidates`, padrão 1). Ordena elegíveis
primeiro, depois `interestScore`, data de encerramento e `matchId`. O interesse
considera virada (peso 25), placar equilibrado (25), vitória expressiva (20),
diferença de desempenho (15) e movimento dos candles (15); pesos e limites
são configuráveis em `CandleBattleSocial`.

O lease padrão é de 900 segundos e `leaseSeconds` solicitado tem teto de 7200.
Reservas ativas retornam `already_reserved`; após expirar, outra tentativa pode
obter novo `reservedAtUtc`. Em PostgreSQL, o índice único de
`idempotency_key` impede duas linhas para a mesma batalha/categoria e a linha
existente é bloqueada durante mutações. **Uma confirmação ou liberação atrasada
deve usar o token da própria tentativa**; `stale_reservation` indica que outra
reserva assumiu a partida.

### Confirmação, falha e reconciliação

Somente `outcome="posted"` com `externalPostId` ou `externalPostUrl` realmente
verificado deve encerrar a publicação. Repetir a confirmação do mesmo post é
idempotente; outro post recebe `already_published`. Para falha externa
comprovada antes de publicar, use `outcome="failed"` ou `release` com o token
atual. Para timeout ou resposta externa incerta, use `outcome="unknown"` com
o token: o estado vira `reconciliation_required` e impede nova reserva.
Consulte manualmente a plataforma antes de liberar esse estado. Nunca envie
`posted` com ID fictício durante homologação de uma partida real.

### URL e imagem social

Abra `publicUrl` apenas quando `publicUrlAvailable=true`. Para captura,
aguarde `#candle-battle-social-card[data-social-ready="true"]`; em partida
finalizada com replay, confirme também `data-replay-ready="true"` para capturar
o quadro de encerramento com vencedor e perdedor. Se o renderer falhar ou não
terminar em 45 segundos, a página libera a captura do resumo histórico após
aguardar fontes e imagens (até 10 segundos adicionais por imagem) com
`data-replay-ready="false"`; trate a imagem como fallback e verifique seu
conteúdo antes de publicar. A página prerenderiza título, descrição, Open
Graph, Twitter Card e URL canônica. Não configure `og:image` enquanto não
houver imagem pública persistida e verificável.

### Captura social compacta (Binance Square)

Para imagens de postagem social use o modo compacto em vez da página inteira:

- URL de captura: `publicUrl` + `?mode=socialCompact` (a cultura continua vindo
  do caminho, ex.: `/pt/social/candle-battle/{matchId}?mode=socialCompact`).
- Seletor de captura: `#candle-battle-social-capture[data-social-ready="true"]`.
- Capture **somente esse elemento** (screenshot do elemento, `fullPage: false`).
- Dimensão fixa do arquivo: **1200 x 675 pixels (16:9)**, em qualquer viewport
  (`data-poster-size="1200x675"`). Não capture a viewport inteira.

O bloco é um pôster com três regiões fixas (cabeçalho 80px, arena 515px, rodapé
80px) e contém apenas: cabeçalho (logo CriptoVersus, selo Candle Battle, pares e
status), a arena com os personagens inteiros, os logos dos ativos, os balões de
fala fixos (`data-cb-capture-bubble`) e o placar único (`RUNE 9 × 8 STRK`, com
selo de vencedor quando finalizada), e o rodapé com a linha de estado
(`Placar atual · Rodada 8 de 18` / `Resultado final · RUNE venceu!`), a marca e o
disclaimer. A interface operacional do Candle Battles (controles, áudio,
dashboard, painéis técnicos) não existe no DOM deste modo.

Contrato de prontidão do modo compacto:

| Atributo em `#candle-battle-social-capture` | Significado |
|---|---|
| `data-social-ready="true"` | Fontes, imagens e quadro congelado prontos; pode capturar. |
| `data-poster-size="1200x675"` | Dimensão fixa do pôster a exportar. |
| `data-capture-frame="frozen"` | Cena congelada em um quadro de pôster. |
| `data-replay-ready="true"` | Quadro pretendido atingido (vitória/derrota em partida finalizada; cena parada em partida em andamento). |
| `data-replay-ready="false"` | Captura degradada (renderer ausente/falho ou fallback de timeout); verifique a imagem antes de publicar. |
| `data-match-status` | `finished`, `in_progress` ou `unknown`. |
| `data-replay-failure` | Motivo da falha do renderer, quando aplicável. |

Em partida em andamento os balões fixos aparecem sempre na imagem, sem depender
do timing da animação. Em partida finalizada a arena congela no quadro de
vitória/derrota e os balões trazem as frases de encerramento. Se o motor não
congelar em até 40 segundos, a página congela a cena pelo comando oculto
`socialFreeze` e marca `data-replay-ready="false"`. O restante do fluxo de
reserva, confirmação e publicação permanece o mesmo da seção anterior.

A validação em navegador real do pôster (10 checkpoints, desktop e mobile) é
repetível com o stub local e o script Playwright:

```powershell
node tools/candle-battles/social-capture-stub-api.mjs
dotnet run --project CriptoVersus\CriptoVersus.Web.csproj --launch-profile http
node tools/candle-battles/social-capture-validate.mjs
```

Não há identificador de partida de produção verificado neste repositório.
Obtenha uma URL existente por `selectedMatchId` e `publicUrl` da API antes de
adicioná-la ao workflow. O identificador 41 dos testes é somente uma fixture
local e não deve ser usado como link público.
