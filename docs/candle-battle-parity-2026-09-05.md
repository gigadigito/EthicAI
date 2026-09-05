# Candle Battle: paridade Partida / TV — 2026-09-05

Correção da apresentação, sem alteração de Worker, API, scoring, epsilon, momentum, percentuais, snapshots, histórico ou algoritmo de normalização.

A causa foi confirmada no Chromium na página pública `/pt/tv/match/35750/aster-vs-chip`: um corpo com atributo SVG `height="12.88"` tinha `getComputedStyle().height = "338px"` e `getBBox().height = 338`. A regra externa em TvStageTelemetryStack aplicava `height:100%` a `.tv-candle-battle__body`, confundindo um retângulo financeiro com um container. CSS sobrescrevia a geometria correta do atributo. O indicador de vencedor já era um retângulo separado.

A regra removida selecionava `:is(.tv-candle-battle, .tv-candle-battle__surface, .tv-candle-battle__chart, .tv-candle-battle__body)`. Não foi adicionada uma exceção corretiva ao corpo: retirou-se a interferência externa. A raiz continua preenchendo o container pela regra externa já existente.

**Chamadas e parâmetros auditados**

- Partida: `CriptoVersus/Components/Pages/Internet/MatchDetail.razor`, chamada de TvCandleBattle.
- TV: `CriptoVersus/Components/Pages/Internet/TvStageTelemetryStack.razor`, fragmento CandleBattleContent, consumido pelo TvStage.

| Parâmetro | Partida | TV |
|---|---|---|
| LeftTickerLabel / RightTickerLabel | _match.TeamA / TeamB | Model.LeftTickerLabel / RightTickerLabel |
| LeftHeroLabel / RightHeroLabel | GetBaseSymbol(TeamA/TeamB) | Model.LeftHeroLabel / RightHeroLabel |
| LeftLogoUrl / RightLogoUrl | GetCoinIconUrl(TeamA/TeamB) | Model.LeftLogoUrl / RightLogoUrl |
| LeftChangePercent / RightChangePercent | _match.PctA / PctB | Model.LeftChangePercent / RightChangePercent |
| LeftPoints / RightPoints | LeftPriceBattlePoints / RightPriceBattlePoints | Model.LeftPriceBattlePoints / RightPriceBattlePoints |
| OfficialScoreA / OfficialScoreB | _match.ScoreA / ScoreB | Model.LeftScore / RightScore |
| ScoreVersion | _match.ScoreVersion | omitido: 0; não é lido na cadeia de renderização |
| Culture | CurrentCulture | antes omitido; agora Model.Culture |
| ShowTacticalPanel | omitido: true | parâmetro do host, normalmente false |
| AriaLabel | TeamA vs TeamB candle battle arena | mesma composição usando labels do Model |
| InstanceId | omitido: identificador gerado | omitido: identificador gerado |

São fontes diferentes de parâmetros equivalentes, não valores ao vivo obrigatoriamente idênticos: as páginas têm ciclos de atualização independentes. Ambas aplicam OrderBy, TakeLast(64), conversão UTC e LastPrice ?? PercentageChange na preparação dos pontos. Partida separa snapshots por TeamId; TV usa o filtro de símbolo existente. Nada disso foi alterado nesta tarefa.

Havia duas alterações anteriores no workspace: TvStage buscava/retinha 500 snapshots em vez de 160, e LogicalHeight já estava fixado em 338. Ambas foram preservadas e não são apresentadas como correções feitas nesta tarefa.

**Branches e cadeia compartilhada**

Ocorrências atuais de `IsBroadcastCompact`, `broadcast-compact` e `tv-candle-battle--broadcast-compact` no componente: zero. Não havia dois renderers para unificar, nem branches broadcast a remover. A divergência estava na cascata CSS externa.

`OnParametersSet → CandleBattleChartModelBuilder.Build → CalculateSharedDomain → BuildChartVisuals → CreateGeometry → RenderBattleChart`

Esta é a cadeia única das duas chamadas. RenderBattleChart produz o mesmo card, SVG, viewBox, preserveAspectRatio="none", grupos, corpos, pavios e faixa inferior. O teste HtmlRenderer compara literalmente todo o card nas duas configurações, variando painel tático e ScoreVersion. O domínio canônico permaneceu intacto: normalização pela primeira dupla, exclusão do primeiro bucket no cálculo do domínio, padding de 8%, sem forçar 1.000. Corpo continua abs(closeY-openY), origem min(openY,closeY); leader marker separado.

Removidos: EnsureVisualsUpToDate, RebuildChartVisuals, cache de modelo/altura, OnPlotResized, import/observador/polling JS, campos de medição, ciclo de descarte exclusivamente ligado ao observer e os arquivos tvCandleBattleResize.mjs / tvCandleBattleResize.test.mjs. O diagnóstico agora mede o DOM diretamente. O SVG fixo responde ao tamanho por CSS, sem reconstruir candles no resize. CSS canônico interno e cálculos financeiros não foram modificados.

**Comparação congelada da partida 35750, ASTERUSDT / CHIPUSDT**

Captura pública de /partida: 63 pares reais. Para comparar exatamente os mesmos preços, os closes normalizados e o open inicial 1 foram usados como entrada congelada do componente local compilado. O timestamp do ponto inicial de bootstrap, não disponível no DOM, foi definido como 0 apenas na fixture; os 63 timestamps de candles foram preservados. Esse ponto não é um candle adicional. Não houve consulta ao banco nem alteração de dados reais.

O modelo e as duas renderizações locais estão em artifacts/candle-battle. A tabela mostra OHLC normalizado compartilhado (8 casas); high/low são extremos dos preços observados, conforme o builder existente.

| Timestamp | Ativo | Open / High / Low / Close — Partida | TV |
|---|---|---|---|
| 1788619224 | A | 1.00000000 / 1.00360144 / 1.00000000 / 1.00360144 | iguais |
| 1788619224 | B | 1.00000000 / 1.00000000 / 0.99025641 / 0.99025641 | iguais |
| 1788619258 | A | 1.00360144 / 1.00360144 / 1.00360144 / 1.00360144 | iguais |
| 1788619258 | B | 0.99025641 / 0.99487179 / 0.99025641 / 0.99487179 | iguais |
| 1788619292 | A | 1.00360144 / 1.00360144 / 1.00120048 / 1.00120048 | iguais |
| 1788619292 | B | 0.99487179 / 0.99675214 / 0.99487179 / 0.99675214 | iguais |
| 1788619326 | A | 1.00120048 / 1.00240096 / 1.00120048 / 1.00240096 | iguais |
| 1788619326 | B | 0.99675214 / 0.99675214 / 0.99538462 / 0.99538462 | iguais |
| 1788619361 | A | 1.00240096 / 1.00360144 / 1.00240096 / 1.00360144 | iguais |
| 1788619361 | B | 0.99538462 / 0.99658120 / 0.99538462 / 0.99658120 | iguais |

| Renderização local | Domain.Min | Domain.Max |
|---|---|---|
| Partida | 0.96312124849940 | 1.01046818727491 |
| TV | 0.96312124849940 | 1.01046818727491 |

Abaixo: BodyY / BodyHeight / HighY / LowY normalizados dentro do plot. Y usa (y-14)/296 e altura usa height/296. Valores do modelo antes do arredondamento SVG de duas casas; o navegador também validou a igualdade dos valores efetivos arredondados. Dojis usam linhas e não retângulos.

| Timestamp | Ativo | Partida: Y / H / High / Low | TV: Y / H / High / Low |
|---|---|---|---|
| 1788619224 | A | 0.14503043 / 0.07606491 / 0.14503043 / 0.22109533 | 0.14503043 / 0.07606491 / 0.14503043 / 0.22109533 |
| 1788619224 | B | 0.22109533 / 0.20579134 / 0.22109533 / 0.42688667 | 0.22109533 / 0.20579134 / 0.22109533 / 0.42688667 |
| 1788619258 | A | 0.14503043 / 0.00000000 / 0.14503043 / 0.14503043 | 0.14503043 / 0.00000000 / 0.14503043 / 0.14503043 |
| 1788619258 | B | 0.32940656 / 0.09748011 / 0.32940656 / 0.42688667 | 0.32940656 / 0.09748011 / 0.32940656 / 0.42688667 |
| 1788619292 | A | 0.14503043 / 0.05070994 / 0.14503043 / 0.19574037 | 0.14503043 / 0.05070994 / 0.14503043 / 0.19574037 |
| 1788619292 | B | 0.28969245 / 0.03971412 / 0.28969245 / 0.32940656 | 0.28969245 / 0.03971412 / 0.28969245 / 0.32940656 |
| 1788619326 | A | 0.17038540 / 0.02535497 / 0.17038540 / 0.19574037 | 0.17038540 / 0.02535497 / 0.17038540 / 0.19574037 |
| 1788619326 | B | 0.28969245 / 0.02888299 / 0.28969245 / 0.31857544 | 0.28969245 / 0.02888299 / 0.28969245 / 0.31857544 |
| 1788619361 | A | 0.14503043 / 0.02535497 / 0.14503043 / 0.17038540 | 0.14503043 / 0.02535497 / 0.14503043 / 0.17038540 |
| 1788619361 | B | 0.29330282 / 0.02527262 / 0.29330282 / 0.31857544 | 0.29330282 / 0.02527262 / 0.29330282 / 0.31857544 |

**Verificação**

- 31 testes relacionados a Candle Battle no projeto CriptoVersus.API.Tests: passaram.
- npm run test:tv-charts --prefix CriptoVersus: sete suites passaram.
- HtmlRenderer: card inteiro idêntico entre painel true/ScoreVersion 2 e painel false/ScoreVersion 0.
- Playwright/Chromium: 63 pares; getBBox versus height SVG; dojis, pavios, leader strip; resize em 390, 768 e 1920 px; scrollbar horizontal: passaram.
- Controle de regressão: reinjetar a regra CSS removida quebra a igualdade e reproduz as barras.
- dotnet build CriptoVersus/CriptoVersus.Web.csproj --no-restore: passou, zero erros/avisos na execução final.
- dotnet build EthicAI.sln --no-restore: falhou fora do escopo, CS0029 em EthicAI.test/HotMatchesSocialCardRulesTests.cs:109 (MatchDto duplicado) e CS0579 no RazorAssemblyInfo do EthicAI legado (ProvideApplicationPartFactoryAttribute duplicado). Houve também avisos de acesso a caches de build.
- git diff --check: passou.
- Não houve alteração TypeScript; recompilação de dist não se aplica.

Screenshots locais: artifacts/candle-battle/comparison.png, tv-before.png e mobile.png. Capturas públicas de referência: partida-live.png e tv-live.png. O comparativo local usa HTML do componente real, com CSS atual de telemetria e dados congelados; não é um teste end-to-end dos dois hosts locais com API. Logos vazios e placar 4–3 na fixture são parâmetros de teste, não resultados oficiais da partida. Os percentuais de cabeçalho não foram fornecidos na fixture. Nenhuma implantação foi feita. Não se afirma que as duas páginas públicas já estejam corrigidas ou que seus dados capturados em instantes diferentes sejam idênticos.

Para reproduzir a verificação local sem rede, exporte CANDLE_PARITY_OUTPUT para uma pasta absoluta e execute o teste CandleBattleRenderingTests; opcionalmente CANDLE_PARITY_INPUT aponta para a fixture congelada JSON com Time, Left, Right. Em seguida, execute node CriptoVersus/wwwroot/js/tvCandleBattleParity.test.mjs com o mesmo CANDLE_PARITY_OUTPUT e PLAYWRIGHT_MODULE apontando para o pacote Playwright instalado. Sem fixture, o teste usa cinco candles determinísticos.

**Arquivos**

Alterados nesta tarefa: TvStageTelemetryStack.razor; TvCandleBattle.razor; tvCandleBattleDiag.mjs; ARCHITECTURE.md.
Adicionados: CriptoVersus.API.Tests/CandleBattleRenderingTests.cs; CriptoVersus/wwwroot/js/tvCandleBattleParity.test.mjs; este relatório.
Removidos: tvCandleBattleResize.mjs e tvCandleBattleResize.test.mjs.
TvStage.razor já estava modificado e foi preservado.

Commit sugerido: `fix(web): prevent TV layout CSS from overriding candle body geometry`.

