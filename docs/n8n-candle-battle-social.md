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

Não há identificador de partida de produção verificado neste repositório.
Obtenha uma URL existente por `selectedMatchId` e `publicUrl` da API antes de
adicioná-la ao workflow. O identificador 41 dos testes é somente uma fixture
local e não deve ser usado como link público.
