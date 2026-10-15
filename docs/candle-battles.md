# Candle Battles

Implementação de 14/10/2026. Competição arcade independente: não altera Match.ScoreA/ScoreB, dominância, posições, apostas, ledger ou liquidação.

## Acesso

- LIVE: /{culture}/tv/candle/{matchId}/{slug}
- DEMO sem API: /{culture}/games/candle-battles/demo
- A TV de partida e a Candle Battle V2 oferecem o link para o arcade. A visualização clássica continua disponível.
- O modo REPLAY usa uma cópia das rodadas persistidas já carregadas; aceita 1x, 2x, 5x e 10x, pausa e reinício. Voltar para LIVE reconcilia o histórico atual sem reproduzir pontos antigos.
- Idiomas: pt, en, zh, es, fr, de, it e ja.

## Dados, confirmação e autoridade

O Worker é o único escritor. A etapa candle-battles-arcade é executada depois das etapas existentes, em escopo DbContext próprio. O heartbeat é atualizado entre partidas. A falha do arcade não impede uma liquidação já realizada nas etapas anteriores.

BinanceKlineClient centraliza o transporte público de klines usado também pelas janelas de volume existentes. O comportamento de leitura do volume financeiro permanece separado da validação OHLC do arcade. Não há conexão de mercado no navegador.

As velas são OHLC e volume cotado reais de 5 minutos. A confirmação exige: timestamps UTC alinhados, fechamento da corretora igual à abertura + 300000 - 1 ms, OHLC válido, e relógio da corretora pelo menos 1500 ms após o fim exclusivo do intervalo. Os dois ativos precisam compartilhar o mesmo intervalo e ter 20 candles anteriores completos e contíguos. O primeiro intervalo parcial da partida é excluído. Não há substituição por máximas, mínimas ou volumes inventados.

A regra de vitória versionada `return-v1-pct-strength-tiebreak` compara primeiro a variação percentual do candle, usando decimal:

- Variação: `((Close - Open) / Open) * 100`.
- A maior variação vence: o menos negativo vence entre quedas, o positivo vence qualquer negativo e a maior alta vence entre altas.
- Se as variações forem iguais até `0,000001`, a fórmula de força `strength-v1-b45-v25-r20-m10-h20` permanece como desempate; força igual produz `draw`.

A força auxiliar usa:

- Corpo: abs(Close - Open) / Open, saturado em 2%, peso 45%.
- Volume: volume cotado / média dos 20 candles anteriores, saturado em 3x, peso 25%. Média zero produz componente zero.
- Amplitude: (High - Low) / Open, saturada em 4%, peso 20%.
- Momentum: abs(Close - Close de três candles atrás) / Close de três candles atrás, saturado em 3%, peso 10%.

Cada componente fica em [0,100]. Força final arredondada para dez casas decimais. Os limites fazem parte da versão. Dados de preço e volume extremos saturam antes de operações que poderiam causar overflow. A força provisória usa PreviewStrength com candles ainda abertos, sem modificar confirmação ou timestamps; pode aparecer no HUD, mas não concede pontos nem resolve uma rodada.

## Persistência e recuperação

A migração 20261015000000_AddCandleBattlesArcade adiciona somente:

- candle_battles_round: PK (MatchId, OpenTimeUtc), JSON OHLCV dos dois participantes, forças, vencedor, versão e horário de confirmação.
- candle_battles_state: cursor durável, snapshots em formação, status e horário da última atualização.

Uma trava transacional PostgreSQL por partida serializa réplicas do Worker. Rodadas e cursor são salvos na mesma transação. A PK impede duplicação. Um erro não avança o cursor; o próximo ciclo tenta novamente. A etapa tem orçamento total de 20 segundos; cancelamentos por orçamento preservam cursores e transações. São processados até 64 intervalos por partida e até 100 estados por ciclo, ordenados pela última atualização para atender o backlog. Os estados permanecem pendentes após o encerramento da partida até processarem seus intervalos completos.

Novos estados são criados para partidas em andamento ou concluídas nos últimos dez minutos. Não é feita uma importação indiscriminada de todas as partidas históricas. O histórico arcade é independente da retenção de snapshots de mercado e não é apagado por ela.

O endpoint público GET /api/matches/{matchId}/candle-battles aceita after (abertura Unix ms exclusiva) e take (1–500). Retorna símbolos reais, placar arcade agregado, estado de mercado, velas atuais e rodadas em ordem. Não expõe entidades EF. O host Blazor pagina todo o histórico antes do bootstrap. Rodadas persistidas com versões anteriores à regra percentual são normalizadas somente na leitura a partir do OHLC; a linha histórica não é alterada, mas o vencedor e o placar entregues ao Replay/TV seguem a regra atual. dashboard_changed é somente invalidação; a consulta periódica de dez segundos cobre eventos perdidos. Falhas são mostradas sem gerar resultados alternativos. O estado delayed é exposto quando o Worker deixa de atualizar por mais de dois minutos.

## Renderização modular

Fonte TypeScript: CriptoVersus/wwwroot/js/candle-battles. Phaser 3.90.0 é empacotado localmente pelo build, com sua licença. Não há CDN em runtime.

CandleRenderer projeta Open/Close e High/Low em um domínio percentual compartilhado entre os ativos. O corpo é um retângulo desenhado por Graphics e o doji tem altura financeira zero. Nenhuma imagem inteira é escalada verticalmente. Open, Close, High e Low visuais são interpolados por 240 ms e chegam exatamente às coordenadas alvo. Os DTOs recebidos não são alterados. Durante todo o round, um diretor determinístico de combate deriva a direção de `close - open`: candles verdes recebem pressão ofensiva, candles vermelhos priorizam defesa/recuo e reações, e dojis permanecem equilibrados; a força existente só desempata candles comparáveis. O tamanho OHLC permanece exclusivamente financeiro e não concede vantagem ofensiva.

O rosto, braços, punhos e pernas das ações disponíveis são sprites reais recortados da prancha aprovada; não são redesenhados pelo renderer. O atlas registra variantes neutra, compra e venda para as duas equipes. As sequências usadas são RUN (8), PUNCH (6), BREAK (8) e RECOVER (3), com o pé normalizado em uma tela transparente comum, sem deformar a proporção original. Idle, lunge, victory e defeat usam a alternativa mais próxima disponível da mesma arte. O corpo e os pavios continuam sendo a geometria OHLC exata, separados da camada ilustrada. Os contornos de alta, baixa e neutro são independentes da cor da equipe.

As poses incluem Idle/Bounce, corrida com oito posições, ataque com seis posições, destruição em oito etapas com fragmentos, vitória e recuperação em três etapas. As pranchas completas e a imagem conceitual não são usadas como frames financeiros nem como uma arena pronta.

As animações consomem apenas resultados confirmados. O heartbeat atualiza o próximo candle enquanto os lutadores exibem cópias imutáveis da rodada anterior. A duração visual pode ser ajustada por CandleBattles:AnimationDurationMs, limitada a 3000–5000 ms; o padrão é 3800 ms. Essa opção não muda o fechamento real de cinco minutos.

Cada vitória cria um ponto e um bloco quadrado. Empates não criam nenhum dos dois. A grade tem 20 colunas e 6 linhas; linhas completas ficam no histórico, contam uma vez e não concedem pontos. Cada página cheia é preservada. Território usa somente vitórias como denominador. Combo, domínio e virada são efeitos visuais e sonoros. CandleBattles:CrushingDifference ajusta a diferença de força que dispara a vitória esmagadora (padrão 25, entre 0 e 100), sem alterar pontos.

## Assets e áudio

Preparação reproduzível:

    python CriptoVersus/tools/candle-battles/prepare-assets.py <arquivo-zip-fornecido>

O script preserva as pranchas base e extended em tools/candle-battles/source (fora do wwwroot), recorta os estados reais de ação, remove os rótulos incorporados, preserva alpha e gera modular.png/modular.json/manifest.json. O manifesto registra os hashes das fontes, as poses, as direções e os recursos utilizados. As músicas e os efeitos fornecidos estão em wwwroot/games/candle-battles/assets/audio.

O áudio só é desbloqueado por interação local do usuário. Os botões são tratados no navegador para preservar o gesto exigido por áudio e fullscreen. Há controles de volume geral, música, efeitos e mute, com preferência local, fade da trilha, máximo de seis efeitos simultâneos e intervalo mínimo de 900 ms para data tick. ResizeObserver, listeners, áudio, texturas e o jogo são liberados no descarte.

## Verificação

    npm ci --prefix CriptoVersus
    npm run test:candle-battles --prefix CriptoVersus
    npm run test:candle-battles:visual --prefix CriptoVersus
    npm run test:tv-charts --prefix CriptoVersus
    dotnet test CriptoVersus.API.Tests/CriptoVersus.API.Tests.csproj --filter FullyQualifiedName~CandleBattle
    dotnet test CriptoVersus.Worker.Tests/CriptoVersus.Worker.Tests.csproj --filter "FullyQualifiedName~CandleBattle|FullyQualifiedName~Volume"
    dotnet build EthicAI.sln

Os testes visuais usam Edge headless e servidor estático local, sem API ou banco de produção. As capturas de referência estão em wwwroot/js/candle-battles/tests/visual.spec.mjs-snapshots; o diretório tests é excluído da publicação Web. A galeria cobre corpos pequeno/médio/grande, doji, pavios extremos, contornos das duas equipes, sprites de combate, inversão durante interpolação, reconexão, replay, blocos quadrados, resize, dispose, áudio real e fullscreen por gesto nativo.

Neste workspace, arquivos de saída estavam bloqueados pela aplicação aberta e o projeto legado incluía obj antigo no glob. A validação da solução usa saída isolada e exclui esses objetos sem removê-los:

    dotnet build EthicAI.sln -p:RepoArtifactsRoot=C:/EthicAI/EthicAI/tmp/candle-battles-solution/ -p:DefaultItemExcludes=**/obj/**

Resultados desta sessão: 52 testes de backend Candle Battle, 8 testes de dominância/volume do Worker, 11 testes de lógica/áudio do arcade e 5 cenários Playwright aprovados. A regressão de gráficos/áudio da TV e o build completo da solução também passaram. O build emitiu avisos; não houve erros. As capturas são fixtures locais, não evidência de conexão com uma partida em produção.

## Ativação e limites de validação

A migração segue os responsáveis existentes: API e Worker aplicam migrations no startup. Publicar versões compatíveis de DAL/DTO/BLL/API/Worker/Web e assegurar que a migração aditiva foi aplicada antes de expor o endpoint novo. Nenhuma configuração ou implantação de produção foi modificada nesta tarefa.

A geração SQL da migração é testada sem conexão de banco. Na preparação da publicação, a migração foi aplicada duas vezes em um container PostgreSQL 16 temporário sem rede e sem dados de produção. Foram validados a trava concorrente com deduplicação, rollback transacional e a restrição de vencedor. O container foi removido após os testes. Também foi executado CandleBattlesRoundService real em PostgreSQL isolado com EnableRetryOnFailure: dois ciclos concorrentes e uma reexecução produziram exatamente duas rodadas, preservaram os placares financeiros, atualizaram a força provisória e retornaram o mesmo histórico pela API. O conjunto transacional é executado via CreateExecutionStrategy, com limpeza do tracking antes de cada tentativa. Candles ausentes, falta de histórico comparável ou indisponibilidade da corretora mantêm o processamento pendente e visível no status; não produzem vitórias fictícias.

Referências técnicas: [klines Spot da Binance](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market) e [containers do Phaser 3.90](https://docs.phaser.io/api-documentation/3.90.0/class/gameobjects-container).
