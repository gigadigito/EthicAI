# Candle Battle Social — registro de homologação local

Data: 2026-10-21. Escopo autorizado nesta rodada: somente validação local.
Nenhum banco ou URL de homologação ficou acessível no host Codex; não há
identificador de partida real validado. Nenhuma publicação externa foi feita.

## Evidência local

| Verificação | Resultado | Limite da evidência |
|---|---|---|
| Build `EthicAI.sln` | Passou | Compilação, não execução em homologação |
| Testes `CandleBattleSocialTests` | 6 passaram | EF InMemory e controller direto; não cobrem HTTP real, PostgreSQL ou corrida entre processos |
| Testes Web de página, rotas e localização | 23 passaram | Confirmam rotas compiladas e recursos; não validam renderização de uma partida real |
| Testes de modelo e prontidão do renderer | 23 passaram | Incluem espera pelo quadro final antes da captura; dados locais |
| Playwright Candle Battles | 12 passaram | Cobrem logos, mobile, replay e finale em harness local; não cobrem a página Blazor contra API de homologação |
| Suíte completa da API, antes da correção do teste de migração | 390/400 passaram | Dez falhas reproduzidas |
| Suíte completa da API, após a correção | 392/401 passaram | Nove falhas preexistentes em `CommunityMatchServiceTests` |

## Regressões investigadas

O teste `ArcadeSchemaHasUniqueIntervalAndDoesNotTouchFinancialTables` escolhia
como migração anterior a última migração **diferente** da migração arcade.
Depois que uma migração social posterior passou a existir, esse código gerava
um script de rollback e procurava nele uma criação de tabela. A seleção agora
usa a migração imediatamente anterior à arcade; a validação voltou a passar.

As outras nove falhas ocorrem em `CommunityMatchServiceTests` ao chamar
`BeginTransactionAsync` no provedor EF InMemory, que não oferece transações.
O serviço e esses testes não foram alterados pelo CandleBattleSocial; a chamada
de transação antecede este módulo. Os testes não foram modificados para suprimir
o aviso e produzir uma aprovação sem cobertura transacional real.

Os nove casos foram conferidos individualmente no TRX local e todos falham com
`TransactionIgnoredWarning` no mesmo ponto:

| Teste `CommunityMatchServiceTests` | Casos |
|---|---|
| `CreateAsync_WhenAuthenticatedUserCreatesMatch_UsesCommunityOrigin` | 1 |
| `CreateAsync_WhenSymbolsNormalizeWithOrWithoutUsdt_CreatesMatch` | 4: `XECUSDT/ZBTUSDT`, `XEC/ZBT`, `XECUSDT/ZBT`, `XEC/ZBTUSDT` |
| `CreateAsync_WhenSymbolsAreReversed_ReusesSamePairKey` | 1 |
| `CreateAsync_WhenTwoRequestsArriveTogether_CreatesOnlyOneMatch` | 1 |
| `CreateAsync_WhenSpotAssetIsFreshAndFuturesAreUnavailable_StillCreatesMatch` | 1 |
| `CreateAsync_WhenValidRequest_CreatesCommunityMatch` | 1 |

## Pendências de homologação com dados reais

1. Em banco de homologação, localizar uma partida encerrada com estado Worker
   `finished` e 18 linhas persistidas em `candle_battles_round`. Conferir
   símbolos, OHLCV, vencedores por rodada, placar, vencedor final e `canPost`.
2. Executar os seis endpoints por HTTP contra a API de homologação. Testar
   autenticação sem chave/com chave, reserva concorrente em duas sessões,
   expiração, `stale_reservation`, confirmação idempotente e rejeição de
   `posted` sem ID ou URL externa. Usar uma partida descartável ou cópia de
   banco para o caso `posted`, que persiste o estado final.
3. Abrir a URL pública da mesma partida em desktop e mobile; verificar logos,
   personagens, resultado, gráfico, replay e fim da animação. Capturar depois
   de `data-social-ready=true` e verificar `data-replay-ready=true` quando o
   replay concluir. Conferir console JS, Open Graph e URL canônica no HTML
   prerenderizado.
4. Executar o workflow n8n em homologação sem envio à Binance Square. Validar
   o contrato e a passagem exata de `publication.reservedAtUtc`; registrar
   evidência de que nenhuma tentativa desconhecida causa repostagem.

**Decisão:** o módulo ainda não está homologado para receber o workflow n8n em
produção. Os testes locais são favoráveis, mas os dados reais, o HTTP de
homologação, a corrida em PostgreSQL e a página pública real seguem pendentes.
