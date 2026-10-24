# Candle Battle — animações de combate (Fase 2)

Implementação de 24/10/2026. Expande as animações dos lutadores durante os 90
minutos de partida sem tocar em pontuação autoritativa, regras de compra/venda,
dados OHLC, histórico de mercado, duração de candle ou duração de partida.

A cena final cinematográfica (`MATCH_FINISHED` … `SOCIAL_FINAL_POSE`) continua
intacta e com precedência total sobre os novos beats.

Princípio central: **o vencedor é sempre `Round.winner`**, resolvido por
`CandleBattlesResolver` (`((Close - Open) / Open) * 100` com desempate por
força). O renderer nunca decide resultado pelo tamanho do sprite, pelo sinal de
uma diferença visual ou por uma regra própria. Tudo o que os beats fazem é
*apresentar* esse resultado.

---

## Fase A — Inventário dos assets

Auditoria reproduzível: `python tools/candle-battles/audit-frames.py`. Ela
compara os pixels recortados de cada célula e emite
`tools/candle-battles/frame-audit.json` (usado pelos testes).

### `modular.png` (1536 × 6144)

| Métrica | Valor |
|---|---|
| Frames nomeados | 163 |
| Desenhos distintos | **26** |
| Conjuntos duplicados | 14 |

Duplicações confirmadas:

| Sequência | Nomeados | Desenhos distintos | Observação |
|---|---|---|---|
| `idle` | 1 | 1 | — |
| `run` | 8 | 3 | `1=5`, `2=4=6=8`, `3=7` |
| `punch` | 6 | 3 | `1=4` (igual ao `idle`), `3=6` |
| `break` | 8 | **1** | **os 8 quadros são idênticos entre si e ao `idle`** |
| `recover` | 3 | 3 | `1=hit`, `2=victory`, `3=idle` |

- As variantes `neutral` / `up` / `down` são **cópias do mesmo desenho**:
  151 frames compartilham arte em 14 grupos. O runtime já ignora isso e usa
  sempre `neutral` (comentário em `renderer.ts`).
- Arte realmente única por lado: `idle`, `walk_a`, `walk_b`, `lunge`, `punch`,
  `hit`, `victory` — **7 desenhos por personagem, 14 no total**.
- `ACTION_FRAME_COUNTS` em `renderer.ts` (`break: 1`) já reconhece que `break`
  tem um único quadro.

### `candle-finishers.png` (1536 × 2048)

| Métrica | Valor |
|---|---|
| Frames nomeados | 55 |
| Desenhos distintos | **43** |
| Conjuntos duplicados | 10 |

Duplicações confirmadas (item 11 da entrega):

| Grupo idêntico | Frames |
|---|---|
| A | `hurt-stagger-1` = `knockout-1` |
| B | `hurt-stagger-2` = `knockout-2` |
| C | `hurt-stagger-3` = `knockout-3` = `dizzy-1` |
| D | `dizzy-2` = `knockout-4` |
| E | `defeated-idle-1` = `dizzy-3` |

(leia-se `finisher-{side}-…`; os dois lados têm exatamente as mesmas colisões)

Consequências práticas, por lado (16 desenhos únicos):

- `charge` 3/3 distintos, `attack` 4/4 distintos, `victory-loop` 3/3 distintos.
- `hurt-stagger` **não tem arte própria**: os 3 quadros são reaproveitados de `knockout`.
- `dizzy` **não tem arte própria**: reaproveita `knockout-3`, `knockout-4` e `defeated-idle-1`.
- `knockout-4` e `defeated-idle-1` são os únicos quadros exclusivos do ciclo de queda.

### Assets registrados mas nunca usados

| Frame | Atlas | Situação |
|---|---|---|
| `overlay-spark` | candle-finishers | **não registrado** — agora usado como partícula de impacto |
| `overlay-dust` | candle-finishers | **não registrado** — agora usado como poeira de recuo |
| `overlay-ring` | candle-finishers | **não registrado** — agora usado como onda de impacto |
| `overlay-trail` | candle-finishers | **não registrado** — agora usado como rastro de combo |

Esses quatro frames são VFX de arena, não decalques de corpo. Ficam num
registro próprio (`IMPACT_FX_KINDS` / `IMPACT_FX_FRAMES` em `renderer.ts`) com
âncora e escala próprias, e **não** entram em `OVERLAY_KINDS`
(bandage/bruise/star), cujo contrato de testes é preservado.

---

## Fase B — Beats realmente implementados

Módulo novo: `wwwroot/js/candle-battles/combat-animations.ts`.

Os nomes seguem a tabela da entrega. **Nenhum beat é registrado com quadros
idênticos** e **nenhum fica parado**: ou troca desenhos reais, ou move o sprite
por transformação. Ambos são verificados por teste.

### Combate (§2)

| Beat | Prioridade | Sequência | Janela | fps | Movimento verificável |
|---|---|---|---|---|---|
| `combat_idle` | IDLE 10 | `idle` | 1..1 | — | respiração (`bob` .12, `breath` .004) |
| `combat_guard` | GUARD 50 | `punch` | 1..2 | 5 | guarda erguida + ajuste de braço (2 desenhos) + tremor |
| `combat_dodge` | GUARD 50 | `recover` | 1..1 | — | recuo 1.5 + inclinação + poeira |
| `combat_jab` | ATTACK 60 | `punch` | 2..3 | 20 | investida curta + `spark` |
| `combat_heavy_punch` | ATTACK 60 | `punch` | 1..3 | 12 | investida 2.3 + tremor + `ring` + flash + shake de câmera |
| `combat_combo` | ATTACK 60 | `punch` | 2..3 | 24 | 2 avanços + `trail` |
| `combat_counter` | ATTACK 60 | `recover` | 1..2 | 14 | recuo e contra-ataque (2 desenhos) + `spark` |
| `combat_block` | GUARD 50 | `punch` | 1..2 | 8 | recuo 0.8 + guarda 0.85 + `dust` |
| `combat_hit_light` | RECOVER 40 | `recover` | 1..1 | — | recuo 0.55 + piscar breve |
| `combat_hit_heavy` | HEAVY 80 | `recover` | 1..1 | — | recuo 1.9 + cambaleio + `ring` + flash 0.55 |
| `combat_recover` | RECOVER 40 | `recover` | 1..3 | 8 | 3 desenhos (`hit`→`victory`→`idle`) |
| `combat_pushback` | HEAVY 80 | `recover` | 1..1 | — | recuo 2.4 + inclinação + `dust` |

### Personalidade (§6)

| Beat | Prioridade | Sequência | Janela | fps | Movimento verificável |
|---|---|---|---|---|---|
| `taunt` | 20 | `recover` | 2..2 | — | pose de vitória + bob .26 + inclinação |
| `confident_idle` | 10 | `idle` | 1..1 | — | postura ereta, bob baixo |
| `nervous_idle` | 10 | `punch` | 1..2 | 7 | tremor alto (shake .55) + 2 desenhos |
| `exhausted_idle` | 10 | `run` | 1..2 | 2 | respiração profunda (bob .34) + 2 desenhos |
| `ready_stance` | 10 | `punch` | 1..3 | 4 | guarda 0.7 + passo de aproximação + 3 desenhos |
| `surprised` | 20 | `recover` | 1..1 | — | sobressalto para trás + `ring` |
| `comeback` | 20 | `recover` | 2..3 | 6 | avanço 1.25 + `spark` + 2 desenhos |

Janelas multi-frame sempre abrangem **desenhos distintos** — verificado por
pixel em `combat-animations.test.mjs` contra `frame-audit.json`.

### Movimentação contínua (§3)

Entre confrontos (`FORMING_CANDLE` / `WAITING_MARKET`) o beat vem de
`personalityFor(...)` e cobre os movimentos pedidos:

| Pedido | Onde acontece |
|---|---|
| Respiração | `bob` / `breath` de `combat_idle`, `exhausted_idle` |
| Mudança de postura | `tilt` em todos os beats |
| Movimento dos braços | janelas `punch` 1..2 / 1..3 |
| Ajuste da guarda | canal `guard` (`ready_stance`, `combat_guard`) |
| Pequenos passos | `run` 1..2 em `exhausted_idle` |
| Aproximação do oponente | canal `lunge` (`ready_stance`, `comeback`, ataques) |
| Recuo defensivo | canal `recoil` (`nervous_idle`, `combat_dodge`, `combat_pushback`) |
| Provocação ocasional | `taunt` (eventos `win_streak` / `dominant_win`) |
| Recuperação após ataque | `combat_recover` |

---

## Fase C — Reação ao resultado real e a eventos de partida

### Resultado do confronto

`resolveCombatState` recebe `role` (`winner` / `loser` / `draw` / `none`) vindo
diretamente de `Round.winner`. Testes cobrem os três casos pedidos:

| Caso | Comportamento verificado |
|---|---|
| Verde maior vs verde menor | o de maior variação percentual pressiona; o outro recua |
| Vermelho vs verde | o verde vence pela regra existente; o vermelho reage à derrota |
| Vermelho grande vs vermelho pequeno | o menor vence; o grande é empurrado para trás |
| Vermelho grande vs verde pequeno | o verde mantém a vantagem; o tamanho do corpo não decide |

O teste `a large red candle never looks superior just because its body is
bigger` constrói um candle vermelho com corpo gigante contra um verde minúsculo
e afirma `recoil > lunge` no lado vermelho.

### Impacto proporcional (§5)

`impactLevel({pressure, opponentPressure, strength, opponentStrength, hit, role})`
→ `none | light | medium | heavy`:

```
gap        = |pressure - opponentPressure|
strengthGap= |strength - opponentStrength| / 100
base       = gap*.5 + strengthGap*.3 + hit*.2
score      = base * (loser 1.15 | winner .55 | draw .8 | none 1)
heavy ≥ .62 · medium ≥ .38 · light ≥ .16 · none abaixo
```

Se **qualquer** entrada não for finita, o resultado é `none` — apresentação
neutra, nada é inventado.

Efeitos por nível:

| Nível | Recuo | Expressão | Partículas | Tremor | Flash |
|---|---|---|---|---|---|
| leve | 0.55 | piscar | — | baixo | 0.22 |
| médio | 1.9 / 2.4 | dor (pose `hit`) | 2 | médio | 0.30 |
| forte | 1.9 + cambaleio | dor (pose `hit`) | 4 + `ring` | alto (shake .9) | 0.55 + shake de câmera |

A pose `hit` (`recover-1`) é o único desenho de dor disponível — ver
"Assets pendentes".

### Eventos de partida (§8)

`game.ts` marca `roundEvent` em `BLOCK_LOCKING` a partir de dados reais
(`TerritoryManager` + força oficial + diferença de cruschamento):

| Evento | Gatilho real | Beat |
|---|---|---|
| `lead_change` | a liderança do placar virou neste round | `surprised` |
| `win_streak` | `territory.streak >= 3` | `taunt` |
| `recovery` | `territory.special === 'comeback'` | `comeback` |
| `dominant_win` | `|leftStrength - rightStrength| >= crushingDifference` | `taunt` |
| `match_closing` | restam ≤ 2 rounds | `exhausted_idle` (perdedor) / `confident_idle` (vencedor) |

Nenhum evento de mercado é inventado: sem esses dados o beat volta ao idle.

---

## Prioridade e transições (§9)

```
FINISHER / KNOCKOUT   100   (cinemática final — renderer)
HEAVY_HIT              80   combat_hit_heavy, combat_pushback
COMBAT_ATTACK          60   combat_jab, combat_heavy_punch, combat_combo, combat_counter
BLOCK / DODGE          50   combat_block, combat_guard, combat_dodge
RECOVER                40   combat_recover, combat_hit_light
TAUNT                  20   taunt, surprised, comeback
COMBAT_IDLE            10   combat_idle, confident_idle, nervous_idle, exhausted_idle, ready_stance
```

Regras, implementadas em `CombatSequencer` e `COMBAT_TRANSITIONS`:

- Prioridade **menor nunca interrompe** maior.
- Empate só troca se a tabela de transições permitir.
- Beats com `durationMs` expiram e liberam o slot; beats de idle (`durationMs 0`)
  só saem quando um beat de prioridade igual ou maior chega.
- Repetir o mesmo beat **renova o movimento sem reiniciar a idade**, então um
  `combat_hit_heavy` de 900 ms não é esticado a cada tick.
- `setCombatPlan` é **recusado** enquanto `resultRole` ou `finalState` estiverem
  ativos, então um idle jamais rouba o quadro de um golpe especial, impacto,
  knockout ou da pose de captura fixada.

---

## Candle, replay e captura (§7, §12)

### Retorno à postura de combate após o round

O beat de resultado usa `loop: true` porque as fases de batalha são curtas, mas
`FORMING_CANDLE` fica ativo **até o próximo candle de cinco minutos fechar** —
até 5 minutos no LIVE. Sem limite, o perdedor ficava em `dizzy` (cujos três
quadros são poses de caído) no chão durante toda a espera.

`ROUND_RESULT_RETURN_MS` (1200 ms, em `model.ts`) limita por quanto tempo o beat
continua segurando depois que o lutador volta ao seu canto. Ao expirar,
`CandleRenderer.releaseResultBeat` limpa o beat e o lutador volta à postura de
combate (§7 passo 7). **A cinemática final continua segurando para sempre** —
só o beat de resultado é limitado.

Verificado em `fighters get back on their feet after the round-result reaction`:

| Instante | Perdedor | Vencedor |
|---|---|---|
| durante a reação | `finisher-left-dizzy-1` | `finisher-right-victory-loop-1` |
| após 1200 ms | `fighter-left-neutral-idle-1` | `fighter-right-neutral-idle-1` |
| `SOCIAL_FINAL_POSE` (60 s depois) | `defeated-idle` preservado | — |

- `frameAt(plan, tempo)` e `transformAt(plan, tempo, …)` são **funções puras do
  relógio de simulação** (`game.ts` avança `time` com a velocidade de replay).
  1x, 2x, 5x e 10x caem exatamente nos mesmos desenhos e transformações.
- Pausa congela (`update` retorna antes de avançar o relógio).
- Busca temporal (`seekRound`) zera sequenciadores e planos; o próximo tick
  reconstrói o estado.
- `alignToPhase` mantém o beat na sequência que a fase já possui
  (`run` em `APPROACHING`, `punch` em `ATTACKING`/`COLLISION`), preservando o
  contrato de captura que fixa `captureTarget` numa fase.
- `freezePose` congela no `captureFrame` do plano; `transformAt` com estado
  congelado zera o flash e a transformação, então o pôster fica estável.
- Movimento reduzido (`setReducedMotion`) desliga a transformação e mantém só o
  quadro estável — acessibilidade preservada.
- Nada disso altera `candle-battles-capture-frozen`, `data-capture-frame`,
  `data-social-ready` ou `candle-battles-finished`.

---

## Fase D — Assets pendentes

**Não foi criado nenhum sprite novo.** Os beats acima foram implementados com a
arte existente, conforme a entrega pede. A especificação abaixo cobre o que
realmente falta.

### Especificação — `candle-combat-extended.png`

| Campo | Valor |
|---|---|
| Nome | `candle-combat-extended.png` + `.json` (Phaser JSON Hash) |
| Formato | RGBA8888, transparência real (alpha 0, não cor-chave) |
| Célula | 200 × 200, idêntica a `candle-finishers.png` |
| Layout | 7 colunas × N linhas, `x = 4 + coluna × 208`, `y = 4 + linha × 256` |
| Pivô | `origin(0.5, 1)`, linha de apoio em `y = 197` na célula |
| Personagens | `left` (verde/lime `#c1f20f`) e `right` (teal `#185957`), separados |
| Estilo | pixel art idêntico ao aprovado, mesmas proporções |
| Compatibilidade | Phaser 3.90.0, sem trim, `sourceSize` 200×200 |

Regras: não modificar `modular.png`, `modular.json`, `candle-finishers.png` nem
`candle-finishers.json`. Não duplicar quadros para inflar contagem.

### Inventário dos desenhos ausentes

A tabela lista **desenhos novos**, não frames nomeados. Um beat de 4 frames
precisa de 4 desenhos (ou de menos, se o movimento for intencionalmente curto).

| Beat / animação | Desenhos novos | Lados | Frames por lado | O que falta hoje |
|---|---|---|---|---|
| `combat_guard` | guarda com antebraços cruzados | 2 | 3 | hoje é `punch` 1..2 (andar) + transformação |
| `combat_dodge` | esquiva lateral/abaixada | 2 | 3 | hoje é pose `hit` + recuo |
| `combat_jab` | jab rápido (extensão curta do braço) | 2 | 2 | hoje é `walk_b`↔`punch` |
| `combat_heavy_punch` | soco carregado → impacto | 2 | 4 | hoje é `idle`→`walk_b`→`punch` |
| `combat_combo` | 3 golpes encadeados | 2 | 6 | hoje é `walk_b`↔`punch` em 24 fps |
| `combat_counter` | defesa → contra-golpe | 2 | 4 | hoje é `hit`→`victory` |
| `combat_block` | bloqueio com reação visual | 2 | 3 | hoje é `punch` 1..2 + recuo |
| `combat_hit_light` | impacto leve (rosto/olhos) | 2 | 2 | **não há rosto expressivo** |
| `combat_hit_heavy` | impacto forte (dor, cambaleio) | 2 | 4 | **só existe 1 pose de dor** |
| `combat_recover` | recuperar postura | 2 | 3 | hoje é `hit`→`victory`→`idle` |
| `combat_pushback` | recuo após impacto | 2 | 3 | hoje é pose `hit` + recuo |
| `taunt` | provocação (gesto) | 2 | 3 | hoje é pose `victory` |
| `confident_idle` | postura confiante | 2 | 2 | hoje é `idle` + respiração |
| `nervous_idle` | tensão (ombros, mãos) | 2 | 3 | hoje é tremor procedural |
| `exhausted_idle` | respiração pesada | 2 | 3 | hoje é `run` 1..2 lento |
| `ready_stance` | preparação para o próximo candle | 2 | 3 | hoje é `punch` 1..3 |
| `surprised` | reação a virada | 2 | 2 | hoje é pose `hit` |
| `comeback` | recuperação após desvantagem | 2 | 3 | hoje é `victory`↔`idle` |

Total: **~58 desenhos novos por personagem, ~116 no atlas** (aprox.; pode cair
se sequências curtas de 2 frames bastarem).

### Quadros que precisam ser redesenhados (item 11)

Não duplicar artificialmente. Preservar o comportamento atual até existirem
substitutos válidos.

| Sequência | Problema | Redesenho necessário |
|---|---|---|
| `hurt-stagger` | 3 quadros = cópia exata de `knockout-1..3` | 3 desenhos próprios (reagir ao golpe, não cair) |
| `dizzy` | 3 quadros = `knockout-3`, `knockout-4`, `defeated-idle-1` | 3 desenhos próprios (tontura em pé) |
| `knockout-4` | único exclusivo do ciclo de queda | manter |
| `break` (modular) | 8 quadros idênticos ao `idle` | 1 desenho de quebra/dano real, ou remover a falsa contagem de 8 |
| `run` (modular) | 8 nomeados, 3 desenhos | completar o ciclo de caminhada (ideal 6–8) |
| `punch` (modular) | 6 nomeados, 3 desenhos (`1=4` = idle) | 3 desenhos de soco reais |
| `up`/`down` (modular) | 3 cópias de `neutral` | variantes de direção reais, ou remover as cópias do atlas |

---

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `wwwroot/js/candle-battles/combat-animations.ts` | **novo** — máquina de estados, prioridades, impacto, personalidade, `frameAt`/`transformAt` |
| `wwwroot/js/candle-battles/renderer.ts` | `setCombatPlan`, `clearCombatPlan`, `combatState`, `IMPACT_FX_*`, condução de quadro pelo relógio de simulação |
| `wwwroot/js/candle-battles/game.ts` | `applyCombatBeats`, `noteRoundEvent`, dataset `combatLeft`/`combatRight`/`combatEvent` |
| `tools/candle-battles/audit-frames.py` | **novo** — auditoria de pixels + `frame-audit.json` |
| `tools/candle-battles/frame-audit.json` | **novo** — inventário gerado |
| `tools/candle-battles/build-runtime.mjs` | publica `combat-animations.js` e `dialogue.js`; revisão `20261024d` |
| `Components/Shared/CandleBattlesHost.razor` | import `game.20261024d.js` |
| `CriptoVersus/package.json` | inclui o novo teste de lógica |
| `wwwroot/js/candle-battles/tests/combat-animations.test.mjs` | **novo** — 17 testes |
| `wwwroot/js/candle-battles/tests/visual.spec.mjs` | +3 testes visuais |
| `ARCHITECTURE.md` | fronteira "Candle Battles in-round combat animations" |

Não alterados: `model.ts` (regras/`combatAdvantage`), Worker, DAL, serviços de
mercado, `modular.*`, `candle-finishers.*`, pontuação autoritativa.

## Testes

```
npm run test:candle-battles          → 79 testes (62 pré-existentes + 17 novos)
npm run test:candle-battles:visual   → 32 testes (29 pré-existentes + 3 novos)
```

Cobertura dos novos:

| Pedido | Teste |
|---|---|
| Prioridade | `animation priority follows the delivery ladder…` |
| Transições | `the transition table names an explicit cancellation rule…` |
| Sincronização com o candle | `round beats stay synchronized with the five-minute candle close` |
| Vencedor/perdedor | `the loser always reels, whatever the candle colour or body size` |
| Vermelho grande ≠ superior | `a large red candle never looks superior…` |
| Replay em velocidades | `frame selection is a pure function of the simulation clock…` + visual `combat beat frames follow the simulation clock at every replay speed` |
| Determinismo | `personality beats are occasional, controlled and reproducible` |
| Sem quadros idênticos | `no registered combat beat is built from identical frames` |
| Movimento verificável | visual `combat beats drive real sprite frames and verifiable movement` |
| Sem sprites fora da arena | visual `combat beats stay inside the arena on desktop and mobile` |
| Mobile | idem (viewport 390×844) |
| Candle Finisher preservado | `phase alignment keeps the documented action frames…` + testes 23–29 existentes |
| Captura Social | `frozen captures always land on a real, stable frame` + contratos existentes intactos |

## Evidências visuais

Geradas por `npm run test:candle-battles:visual` em
`tmp/candle-battles-visual-results/`:

- `candle-battles-combat-desktop.png`
- `candle-battles-combat-mobile.png`
- `candle-battle-social-capture-collision.png` (captura fixada em `COLLISION`)
- capturas de finais, overlays e social já existentes
