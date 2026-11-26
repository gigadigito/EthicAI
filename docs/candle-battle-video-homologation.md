# Candle Battle Video — homologação manual na VPS

Esta sequência não publica, não chama o modo `publish`, não ativa n8n e não altera
o Arena Pressure. Execute os blocos numa sessão SSH já autenticada. Os valores de
credenciais permanecem nas variáveis de ambiente existentes e nunca devem ser
impressos.

## 1. Transferência para área isolada

Na máquina que contém o checkout, defina apenas o host/alias SSH já usado pela equipe:

```bash
export VPS_HOST='<alias-ssh-existente>'
ssh "$VPS_HOST" 'install -d -m 750 /home/admin/stacks/binance-square/homologation/candle-battle-tools /home/admin/stacks/binance-square/homologation/candle-battle-publications'
scp CriptoVersus/tools/candle-battles/{capture-full-candle-battle.mjs,browserless-video-function.mjs,candle-battle-publish.sh,publication-utils.mjs,prepare-homologation.mjs} "$VPS_HOST":/home/admin/stacks/binance-square/homologation/candle-battle-tools/
scp CriptoVersus/tools/arena-pressure/capture-media.mjs "$VPS_HOST":/home/admin/stacks/binance-square/homologation/candle-battle-tools/capture-media.mjs
ssh "$VPS_HOST" 'chmod 750 /home/admin/stacks/binance-square/homologation/candle-battle-tools/candle-battle-publish.sh; chmod 640 /home/admin/stacks/binance-square/homologation/candle-battle-tools/*.mjs'
```

A rota Web e o runtime gerado também precisam estar presentes numa instância Web de
homologação. Não substitua a instância de produção. Publique `CriptoVersus.Web` para
o diretório de staging segundo o procedimento operacional existente e confirme que
essa instância usa `ArenaPressureCapture:Enabled=true` e a chave de captura já
gerenciada pelo ambiente.

## 2. Verificações sem efeitos externos

Na VPS:

```bash
export HOMO=/home/admin/stacks/binance-square/homologation
export TOOLS="$HOMO/candle-battle-tools"
bash -n "$TOOLS/candle-battle-publish.sh"
node --check "$TOOLS/capture-full-candle-battle.mjs"
node --check "$TOOLS/browserless-video-function.mjs"
node --test "$TOOLS/publication-utils.test.mjs"  # somente se o teste também foi copiado
ffmpeg -version | head -1
ffprobe -version | head -1
node --version
```

Inspecione a CLI real do publicador sem executá-lo:

```bash
PUBLISHER=/home/admin/stacks/binance-square/scripts/post-video.mjs
test -f "$PUBLISHER"
grep -nE -- "--text-file|--text([^A-Za-z-]|$)|process[.]argv|parseArgs|app_share_cvid" "$PUBLISHER"
sed -n '1,240p' "$PUBLISHER" | sed -n '/process[.]argv\|parseArgs\|--text/p'
```

Se o código provar `--text-file`, futuramente configure
`BINANCE_POST_VIDEO_TEXT_FLAG=--text-file`. Se provar somente `--text`, use
`BINANCE_POST_VIDEO_TEXT_FLAG=--text`. Não configure a variável durante esta
homologação; assim o modo `publish` permanece bloqueado antes de criar lock.

## 3. Browserless e lock global

Use o mesmo diretório de saída do Arena apenas para o lock compartilhado:

```bash
export BROWSERLESS_CAPTURE_ROOT=/tmp/arena-pressure-phase2/out
export CANDLE_BATTLE_PUBLICATIONS_ROOT="$HOMO/candle-battle-publications"
export CANDLE_BATTLE_TOOLS_ROOT="$TOOLS"
bash "$TOOLS/candle-battle-publish.sh" preflight
test ! -e "$BROWSERLESS_CAPTURE_ROOT/browserless-preview.lock" || echo 'capture_busy: aguarde; não remova o lock'
curl --fail --silent --show-error --max-time 5 "${ARENA_PRESSURE_BROWSERLESS_URL%/}/pressure" >/dev/null && echo browserless_available
```

`capture_busy` com exit 3 é transitório. Não cria job, reserva ou lock de publicação.

## 4. Seleção de partida real

O endpoint público aplica as mesmas verificações de candles confirmados, regra,
placar, continuidade e publicação já existente:

```bash
curl --fail --silent --show-error \
  'https://api.criptoversus.com/api/social/candle-battle/highlight?lookbackHours=48&language=pt-BR&includeRounds=true' \
  -o "$HOMO/highlight.json"
jq '{hasHighlight,skipReason,selected:(.highlight|{matchId,status,battleStatus,replayAvailable,canPost,skipReason,scoreA,scoreB,confrontationCount,expectedConfrontations,assetA:.assetA.symbol,assetB:.assetB.symbol})}' "$HOMO/highlight.json"
jq -e '.hasHighlight==true and .highlight.status=="Completed" and .highlight.battleStatus=="finished" and .highlight.replayAvailable==true and .highlight.canPost==true and (.highlight.rounds|length)==.highlight.confrontationCount and all(.highlight.rounds[]; .left.confirmed==true and .right.confirmed==true)' "$HOMO/highlight.json"
jq '.highlight' "$HOMO/highlight.json" > "$HOMO/battle.json"
export MATCH_ID="$(jq -r '.matchId' "$HOMO/battle.json")"
```

Não faça `reserve` nesta fase.

## 5. Firecrawl e legenda

Utilize a credencial Firecrawl já carregada na sessão, sem exibi-la:

```bash
curl --fail --silent --show-error 'https://api.firecrawl.dev/v2/scrape' \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" -H 'Content-Type: application/json' \
  --data '{"url":"https://www.binance.com/en/square/trends","formats":["markdown"],"maxAge":0}' \
  -o "$HOMO/trends.json"
JOB="$HOMO/candle-battle-publications/candle-battle-video-v1-$MATCH_ID"
install -d -m 750 "$JOB"
node "$TOOLS/prepare-homologation.mjs" --battle "$HOMO/battle.json" --trends "$HOMO/trends.json" --output "$JOB/post.txt" | tee "$JOB/caption-audit.json"
grep -oE '\$[A-Z0-9]+' "$JOB/post.txt" | sort | uniq -c
tail -2 "$JOB/post.txt"
```

Devem existir exatamente duas cashtags, uma ocorrência de cada, e a última linha de
hashtags deve conter somente a tendência validada e `#CriptoVersus`.

## 6. Captura experimental, sem publicação

As variáveis `ARENA_PRESSURE_BROWSERLESS_URL`, `ARENA_PRESSURE_CAPTURE_BASE_URL` e
`ARENA_PRESSURE_CAPTURE_KEY` devem apontar para Browserless e Web de homologação.

```bash
env CANDLE_BATTLE_PUBLICATIONS_ROOT="$HOMO/candle-battle-publications" \
    CANDLE_BATTLE_TOOLS_ROOT="$TOOLS" \
    BROWSERLESS_CAPTURE_ROOT=/tmp/arena-pressure-phase2/out \
    bash "$TOOLS/candle-battle-publish.sh" capture "$MATCH_ID" v1 | tee "$JOB/capture-command.log"
test "$(cat "$JOB/state.txt")" = captured
test ! -e "$JOB/publish-attempt.lock"
test -s "$JOB/video.mp4"
```

Nunca execute `candle-battle-publish.sh publish` nesta fase.

## 7. Validação técnica e visual

```bash
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames \
  -show_entries format=duration,size -of json "$JOB/video.mp4" | tee "$JOB/ffprobe.json"
jq -e '.streams[0].codec_name=="h264" and .streams[0].width==1280 and .streams[0].height==720 and .streams[0].pix_fmt=="yuv420p" and .streams[0].r_frame_rate=="30/1" and (.streams[0].nb_read_frames|tonumber)==3600 and ((.format.duration|tonumber)-120|fabs)<=0.11' "$JOB/ffprobe.json"
ffmpeg -v error -xerror -i "$JOB/video.mp4" -f null -
install -d -m 750 "$JOB/review"
ffmpeg -v error -ss 2   -i "$JOB/video.mp4" -frames:v 1 "$JOB/review/start.png"
ffmpeg -v error -ss 60  -i "$JOB/video.mp4" -frames:v 1 "$JOB/review/middle.png"
ffmpeg -v error -ss 118 -i "$JOB/video.mp4" -frames:v 1 "$JOB/review/end.png"
sha256sum "$JOB/video.mp4" "$JOB/review/"*.png | tee "$JOB/sha256.txt"
```

Compare os três quadros com `battle.json`: símbolos, ordem de rounds, placar parcial,
empates, mudanças de liderança e resultado final. O final deve mostrar FINALIZADA e
o placar de `scoreA:scoreB`. Ausência de Money Flow histórico é esperada e correta.

## 8. Locks, recibos e limpeza sem postagem

O parser de recibos é coberto por testes locais. Na VPS, teste apenas fixtures:

```bash
node --input-type=module - "$TOOLS/publication-utils.mjs" <<'NODE'
import {pathToFileURL} from 'node:url';
const {parseBinanceReceipt}=await import(pathToFileURL(process.argv[2]));
for(const fixture of [
 {app_share_cvid:'https://app.binance.com/uni-qr/cvid/12345?l=pt-BR'},
 {url:'https://www.binance.com/en/square/post/9988'},
 {success:true}
]) console.log(parseBinanceReceipt(fixture));
NODE
test ! -e "$JOB/publish-attempt.lock"
env CANDLE_BATTLE_PUBLICATIONS_ROOT="$HOMO/candle-battle-publications" CANDLE_BATTLE_TOOLS_ROOT="$TOOLS" \
  bash "$TOOLS/candle-battle-publish.sh" cleanup-posted "$MATCH_ID" v1 --dry-run || test $? -eq 5
```

A limpeza deve ser recusada porque o job está `captured`, não `posted`. Preserve
vídeo, relatório, legenda e logs para revisão. Não simule `posted` num job real.
