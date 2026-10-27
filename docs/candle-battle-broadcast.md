# Candle Battle Broadcast — API do diretor automatico de TV

Contrato de integracao entre o CriptoVersus (API .NET) e o transmissor externo
(`stream.py` versao 8, Python 3.12 + Playwright + FFmpeg + RTMPS do Pump.fun).

O diretor escolhe automaticamente a melhor Candle Battle para transmissao
continua: LIVE quando existe partida adequada, REPLAY quando nao existe LIVE e
tela de espera quando nao ha conteudo. Este documento e somente leitura para o
transmissor: os endpoints nao alteram partidas, rounds, placares nem publicacoes
sociais.

## Endpoints

Base de producao: `https://api.criptoversus.com` (ambos anonimos, somente GET).

| Metodo | Rota | Uso |
|---|---|---|
| GET | `/api/tv/candle-battle/next` | proximo conteudo a exibir |
| GET | `/api/tv/candle-battle/{matchId}/broadcast-status` | quando trocar de partida |

`next` aceita query opcional `currentMatchId` (partida em exibicao) e `culture`
(`pt`, `en`, `es`, ...; padrao `CandleBattleBroadcast:PlaybackCulture`).

## Contrato de `GET /api/tv/candle-battle/next`

```json
{
  "available": true,
  "mode": "live",
  "matchId": 42369,
  "battleId": "42369:5m",
  "assetA": "NEARUSDT",
  "assetB": "TAOUSDT",
  "scoreA": 5,
  "scoreB": 12,
  "interestScore": 78,
  "selectionReasons": ["balanced_score", "high_volatility"],
  "matchStatus": "Ongoing",
  "battleStatus": "live",
  "isFinished": false,
  "replayAvailable": true,
  "winnerSymbol": null,
  "startTimeUtc": "2026-10-25T10:30:00Z",
  "endTimeUtc": "2026-10-25T12:00:00Z",
  "remainingSeconds": 1200,
  "playbackUrl": "https://criptoversus.com/pt/tv/candle/42369/near-vs-tao",
  "finalResultDisplaySeconds": 10,
  "statusPollingSeconds": 10,
  "skipReason": null,
  "generatedAtUtc": "2026-10-25T11:40:00Z"
}
```

Sem conteudo (`available: false`):

```json
{
  "available": false,
  "mode": "none",
  "matchId": null,
  "playbackUrl": null,
  "skipReason": "no_content",
  "finalResultDisplaySeconds": 10,
  "statusPollingSeconds": 10,
  "generatedAtUtc": "2026-10-25T11:40:00Z"
}
```

Campos e semantica:

- `mode`: `live` (partida ao vivo), `replay` (partida encerrada com replay
  integro) ou `none` (tela de espera). `live` com `isFinished: true` significa
  "resultado final em exibicao" (janela de `finalResultDisplaySeconds`); uma
  selecao nova nunca devolve partida encerrada como LIVE.
- `battleStatus`: status real do arcade (`live`, `finished`, `waiting`,
  `delayed`, `waiting-confirmation`, `incomplete`, `market-unavailable`,
  `unavailable`).
- `isFinished`: encerramento **real** da partida (status terminal, `EndTime`
  alcancado ou duracao maxima). Nao e o fecho de um candle de cinco minutos.
- `winnerSymbol`: simbolo vencedor quando o resultado e definitivo; `null` em
  empate ou enquanto indefinido.
- `remainingSeconds`: tempo restante da partida em `live`; `null` em `replay`
  (a posicao de reproducao e do player).
- `playbackUrl`: URL publica real da pagina de TV da batalha. Navegar ate ela.
- `selectionReasons` (LIVE): `balanced_score`, `high_volatility`,
  `lead_alternations`, `recent_activity`, `long_remaining`, `popular_assets`.
  (REPLAY: vocabulario social existente, ex. `comeback`, `balanced_score`.)
- `skipReason` quando `available: false`: `no_content`, `disabled` ou
  `source_unavailable`.

Codigos HTTP: `200` com `available: true|false`; `503` quando
`skipReason = source_unavailable` (falha temporaria de origem).

## Contrato de `GET /api/tv/candle-battle/{matchId}/broadcast-status`

```json
{
  "matchId": 42369,
  "mode": "live",
  "matchStatus": "Ongoing",
  "battleStatus": "live",
  "isFinished": false,
  "replayAvailable": true,
  "winnerSymbol": null,
  "startTimeUtc": "2026-10-25T10:30:00Z",
  "endTimeUtc": "2026-10-25T12:00:00Z",
  "remainingSeconds": 1200,
  "shouldSwitch": false,
  "switchReason": null,
  "generatedAtUtc": "2026-10-25T11:40:00Z"
}
```

`switchReason` quando `shouldSwitch: true`:

| Valor | Significado |
|---|---|
| `final_result_displayed` | partida encerrada e janela de resultado final concluida |
| `replay_budget_elapsed` | orcamento de exibicao do replay concluido |
| `live_available` | LIVE adequada disponivel em ponto seguro do replay |
| `replay_serving_unknown` | servidor nao sabe quando o replay comecou (pos-reinicio) |
| `match_ended` | conteudo sem exibicao (partida cancelada ou sem replay) |
| `no_content` | nada a exibir para esse matchId |

Codigos HTTP: `200`, `404` (partida inexistente), `400` (matchId invalido),
`503` (falha temporaria).

## Regras do diretor

1. **Prioridade**: LIVE adequada > REPLAY disponivel > tela de espera.
2. **Estabilidade**: a partida em exibicao nao e trocada porque outra passou a
   pontuar mais. Ela permanece ate o encerramento real, preserva a animacao final
   e o vencedor por `finalResultDisplaySeconds` e so entao e substituida.
3. **Replay**: nao e interrompido por consultas periodicas. Permanece ate
   `replayBudget` (padrao 240 s) ou, com `AllowLiveInterruptReplay`, ate o ponto
   seguro (`replayMinimumDisplaySeconds`, padrao 120 s) quando existe LIVE
   adequada. O historico anti-repeticao (`replayHistorySize`, padrao 20) evita
   reexibir o mesmo replay continuamente; replays ainda nao exibidos tem
   prioridade.
4. **Falhas**: resposta `5xx` ou `source_unavailable` e transitoria — **nao**
   encerrar a transmissao nem trocar de partida. Manter o conteudo atual, aplicar
   backoff (sugerido: 15 s, 30 s, 60 s, maximo 120 s) e voltar a consultar.
   Resposta `200` com `available: false` e conteudo legitimo (tela de espera).

## Adaptacao do stream.py versao 8

O layout aprovado da v8 nao muda. O transmissor continua capturando somente a
pagina isolada da Candle Battle (Playwright + Chrome isolado) e enviando frames
ao FFmpeg (1280x720, captura sincronizada a 10 FPS, RTMPS ativo o tempo todo).
Nenhuma captura de audio e necessaria.

Fluxo de integracao:

1. Consultar `GET /api/tv/candle-battle/next` (sem `currentMatchId` no inicio).
2. Se `available: false` — manter tela de espera e reconsultar a cada
   `statusPollingSeconds` (nao reiniciar FFmpeg).
3. Se `available: true` — abrir `playbackUrl` no Chrome isolado (navegacao, nao
   reload do processo).
4. Quando `mode = "replay"` — apos a pagina carregar, acionar o controle de
   replay da propria pagina (`page.click('[data-cb-action="replay"]')`) para
   iniciar a reproducao; em `mode = "live"` a pagina ja acompanha a partida.
5. A cada `statusPollingSeconds`, consultar
   `GET /api/tv/candle-battle/{matchId}/broadcast-status` da partida atual.
6. Enquanto `shouldSwitch: false` — continuar exibindo e enviando frames.
7. Quando `shouldSwitch: true` — consultar
   `GET /api/tv/candle-battle/next?currentMatchId={matchId}`.
8. Se a resposta trouxer o mesmo `matchId`/`mode`, permanecer. Se trouxer outro
   conteudo, navegar o Chrome para o novo `playbackUrl` sem reiniciar FFmpeg e
   voltar ao passo 5.
9. `5xx`/timeout: manter o quadro atual, backoff e repetir o passo 7/5.

Pseudocodigo do loop principal:

```python
# stream.py v8 (adaptacao sugerida) - a stream key nunca entra no codigo fonte
current = None
backoff = 15
while streaming:
    if current is None:
        nxt = get_json(f"{API}/api/tv/candle-battle/next")
        if not nxt["available"]:
            show_waiting_screen(); sleep(nxt.get("statusPollingSeconds", 10)); continue
        current = nxt
        navigate(current["playbackUrl"])
        if current["mode"] == "replay":
            page.click('[data-cb-action="replay"]')
        backoff = 15
    else:
        sleep(current.get("statusPollingSeconds", 10))
        try:
            status = get_json(f"{API}/api/tv/candle-battle/{current['matchId']}/broadcast-status")
        except TransientError:
            sleep(backoff); backoff = min(backoff * 2, 120); continue
        if not status["shouldSwitch"]:
            backoff = 15
            continue
        try:
            nxt = get_json(
                f"{API}/api/tv/candle-battle/next?currentMatchId={current['matchId']}")
        except TransientError:
            sleep(backoff); backoff = min(backoff * 2, 120); continue
        if nxt["available"] and nxt["matchId"] == current["matchId"] and nxt["mode"] == current["mode"]:
            current = nxt  # mesmo conteudo: atualizar contadores
            continue
        if nxt["available"]:
            current = nxt
            navigate(current["playbackUrl"])
            if current["mode"] == "replay":
                page.click('[data-cb-action="replay"]')
        else:
            current = None  # tela de espera
        backoff = 15
```

Detalhes importantes:

- A conexao RTMPS permanece ativa durante toda a troca; apenas a pagina capturada
  muda.
- `matchId` igual com `isFinished: true` ainda e o mesmo conteudo (resultado final
  em exibicao). Nao reiniciar a pagina nesse caso.
- `shouldSwitch` e a unica autoridade de troca. Nao trocar por contagem propria
  de tempo enquanto `shouldSwitch` for `false` (protege a animacao final).
- Em `replay_servingUnknown` (`switchReason = replay_serving_unknown`), usar a
  deteccao propria de fim de replay da pagina como alternativa.

## Configuracao da API

Secao `CandleBattleBroadcast` em `appsettings.json` (sem segredos):

| Chave | Padrao | Efeito |
|---|---:|---|
| `Enabled` | true | habilita o diretor |
| `PreferLive` | true | LIVE antes de REPLAY |
| `AllowReplayFallback` | true | usa REPLAY quando nao ha LIVE |
| `AllowLiveInterruptReplay` | true | LIVE pode promover replay em ponto seguro |
| `MinimumLiveRemainingSeconds` | 600 | tempo minimo restante para nova LIVE |
| `FinalResultDisplaySeconds` | 10 | janela do resultado final |
| `SelectionCacheSeconds` | 15 | cache de resposta sem conteudo |
| `StatusPollingSeconds` | 10 | intervalo sugerido de polling |
| `ReplayHistorySize` | 20 | historico anti-repeticao |
| `ReplayDisplaySeconds` | 240 | orcamento de exibicao do replay |
| `ReplayMinimumDisplaySeconds` | 120 | ponto seguro para promover LIVE |
| `ReplayLookbackHours` | 24 | janela de busca de replays |
| `MaxReplayCandidates` | 25 | maximo de replays avaliados |
| `MatchDurationMinutes` | 90 | duracao usada quando `EndTime` nao existe |
| `PublicBaseUrl` | (opcional) | origem da URL publica |
| `PlaybackCulture` | `pt` | cultura padrao da URL publica |
| `WeightBalance` ... `WeightAssetRecognition` | 25/20/20/15/10/10 | pesos da pontuacao LIVE |
| `SignificantCandleMovementPercent` | 3 | referencia de volatilidade |
| `ComfortableRemainingSeconds` | 1800 | referencia de tempo restante |
| `MaxExpectedLeadAlternations` | 3 | referencia de alternancias |
| `ActivityWindowMinutes` | 20 | janela de atividade recente |
| `RecentVolatilityRounds` | 6 | rounds usados na volatilidade recente |

Valores fora de faixa sao limitados a intervalos seguros pelo servico.

## Exemplos PowerShell

```powershell
# 1) Proximo conteudo (inicio de transmissao)
Invoke-RestMethod -Uri "https://api.criptoversus.com/api/tv/candle-battle/next"

# 2) Proximo conteudo mantendo a partida atual em exibicao
Invoke-RestMethod -Uri "https://api.criptoversus.com/api/tv/candle-battle/next?currentMatchId=42369&culture=pt"

# 3) Status de transmissao de uma partida
Invoke-RestMethod -Uri "https://api.criptoversus.com/api/tv/candle-battle/42369/broadcast-status"

# 4) Acompanhamento com tratamento de indisponibilidade
$api = "https://api.criptoversus.com"
$current = $null
while ($true) {
    try {
        if (-not $current) {
            $next = Invoke-RestMethod -Uri "$api/api/tv/candle-battle/next"
            if (-not $next.available) { Start-Sleep -Seconds 10; continue }
            $current = $next
            Write-Host "Exibir $($current.mode) matchId=$($current.matchId) -> $($current.playbackUrl)"
            continue
        }
        Start-Sleep -Seconds $current.statusPollingSeconds
        $status = Invoke-RestMethod -Uri "$api/api/tv/candle-battle/$($current.matchId)/broadcast-status"
        if (-not $status.shouldSwitch) { continue }
        $next = Invoke-RestMethod -Uri "$api/api/tv/candle-battle/next?currentMatchId=$($current.matchId)"
        if ($next.available -and $next.matchId -eq $current.matchId -and $next.mode -eq $current.mode) { continue }
        $current = if ($next.available) { $next } else { $null }
        if ($current) { Write-Host "Trocar para $($current.mode) matchId=$($current.matchId) -> $($current.playbackUrl)" }
    } catch {
        Write-Warning "API indisponivel; manter transmissao e reconsultar"
        Start-Sleep -Seconds 15
    }
}
```

## Limitacoes

- O estado de sessao (conteudo atual, inicio de exibicao e historico de replays)
  e mantido em memoria por processo da API; em implantacao com multiplas replicas
  cada replica mantem o proprio historico.
- `SelectionCacheSeconds` tambem limita a repeticao de varreduras quando nao ha
  conteudo; uma LIVE recem-criada pode levar ate esse intervalo para aparecer
  enquanto a tela de espera esta ativa.
- A duracao real da reproducao de um replay depende do player da pagina; o
  orcamento `ReplayDisplaySeconds` e o limite maximo de permanencia, nao uma
  medicao de playback.
- Reconhecimento de ativos usa o catalogo existente `TvPopularSymbols`
  (BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX, LINK, SUI) por simbolo base; nao ha
  ranking arbitrario novo.
- Nao ha captura de audio nesta integracao. A stream key do Pump.fun nunca deve
  entrar em codigo fonte, configuracao da API ou logs.
