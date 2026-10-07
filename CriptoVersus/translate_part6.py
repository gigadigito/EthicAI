# Part 6: walletPage, token, reconnect, communityMatch, candleBattleV2, commentary templates
T6 = {}

def add(p, d):
    for k, v in d.items():
        T6[f"{p}.{k}"] = v

# Commentary templates (arrays)
T6["tv.commentary.templates.balanced"] = [
    "{2} e {3} sono ancora appaiati, ma il Momentum sta iniziando a propendere per {0}.",
    "La classifica \u00e8 serrata e l'arena \u00e8 ancora aperta, con {0} che mantiene solo un fragile vantaggio.",
    "Questa partita \u00e8 bloccata per ora, eppure una mossa pulita pu\u00f2 spostare la pressione verso {0}.",
    "{2} versus {3} resta bilanciato, e la prossima spinta di mercato potrebbe riscrivere completamente la lettura.",
    "Nessun lato ha aperto l'arena, e questo tiene {0} sotto costante pressione.",
    "Una classifica stretta e percentuali vicine tengono viva questa arena a ogni tick.",
    "Non c'\u00e8 quasi nulla tra questi due lati in questo momento, il che rende il prossimo swing critico.",
    "{0} ha il vantaggio sulla carta, ma questa arena sta ancora negoziando come una battaglia di una mossa."
]
T6["tv.commentary.templates.comeback"] = [
    "Il vantaggio ha cambiato lato e {0} possiede improvvisamente il Momentum dell'arena.",
    "{0} ha capovolto la partita, e il broadcast ora sembra una storia di rimonta in diretta.",
    "Quello che sembrava stabile un attimo fa \u00e8 ora un'inversione, con {0} che prende la linea frontale.",
    "{0} ha appena trasformato la pressione in controllo e cambiato il tono della partita.",
    "L'arena ha un nuovo leader, e {0} sta ora costringendo {1} a reagire.",
    "{0} ha ripreso il vantaggio, dando a questa battaglia la forma di una rimonta.",
    "Un cambio di leadership \u00e8 appena arrivato, e {0} ora porta la narrativa pi\u00f9 forte.",
    "{1} aveva il controllo, ma {0} ha contrattaccato e rubato il vantaggio."
]
T6["tv.commentary.templates.pressureRising"] = [
    "{0} sta iniziando a premere in avanti, e l'arena sta iniziando a seguire quel ritmo.",
    "L'impulso di mercato sta propendendo di pi\u00f9 verso {0}, anche con la classifica ancora sotto pressione.",
    "{0} sta costruendo una sequenza migliore e costringendo l'arena a rispettare quella scalata.",
    "Questa partita si sta stringendo attorno a {0}, che ora sta spingendo il ritmo della classifica.",
    "La pressione sta crescendo sul lato di {0}, e la prossima mossa potrebbe trasformarla in danno sulla classifica.",
    "{0} sta accumulando le reazioni pi\u00f9 forti in questo momento e tirando la partita nella sua corsia.",
    "Il ritmo si sta spostando verso {0}, e {1} ha bisogno di una risposta rapidamente.",
    "{0} sta accelerando al momento giusto, il che sta cambiando la sensazione dell'arena."
]
T6["tv.commentary.templates.dominance"] = [
    "{0} sta giocando dal davanti e tiene questa arena sotto chiaro controllo.",
    "Il divario nella classifica sta crescendo, e {0} sta ora trasformando la pressione in comando.",
    "{0} ha aperto un vero distacco in questa partita e sta dettando il ritmo.",
    "Questa \u00e8 un'arena controllata in questo momento, con {0} che sostiene un forte vantaggio.",
    "{1} ha ancora tempo, ma {0} sta rendendo questa classifica unilaterale.",
    "{0} non sta solo guidando; sta controllando la struttura della partita.",
    "Il vantaggio sta diventando sostanziale, e {0} sta ora operando da una posizione di comfort.",
    "{0} mantiene il vantaggio abbastanza ampio da rendere questa arena sempre pi\u00f9 controllata."
]
T6["tv.commentary.templates.quietPool"] = [
    "{2} e {3} stanno ancora aspettando un vero volume del pool, cos\u00ec un ingresso pu\u00f2 resettare il ritmo istantaneamente.",
    "L'arena \u00e8 tecnicamente in diretta, ma il pool resta silenzioso e il prossimo segnale conta pi\u00f9 che mai.",
    "La bassa attivit\u00e0 tiene questa partita sobria per ora, anche se la classifica pu\u00f2 svegliarsi rapidamente.",
    "Non c'\u00e8 ancora molta aggressivit\u00e0 nel pool, il che lascia questa arena aperta a un cambio improvviso.",
    "Questa battaglia sta ancora respirando leggermente, con volume limitato e ritmo cauto.",
    "Il pool \u00e8 lento, la classifica \u00e8 paziente, e una mossa decisiva pu\u00f2 cambiare improvvisamente il tono.",
    "Il volume non si \u00e8 ancora aperto, quindi l'arena sta ancora aspettando un trigger pi\u00f9 forte.",
    "La classifica in diretta \u00e8 calma per ora, ma ci\u00f2 spesso significa che la prossima spinta arriva pi\u00f9 forte."
]
T6["tv.commentary.templates.heatedPool"] = [
    "Questa arena si sta scaldando rapidamente, con hotScore a {8} e vera pressione che si costruisce su entrambi i lati.",
    "L'intensit\u00e0 del pool sta crescendo, e questa partita sta iniziando a sembrare una delle finestre pi\u00f9 calde in onda.",
    "L'arena ha ora vero calore, con pressione, volume e competitivit\u00e0 che salgono insieme.",
    "Con hotScore a {8}, questa partita si sta guadagnando l'attenzione premium del broadcast.",
    "Questa non \u00e8 pi\u00f9 una classifica silenziosa; l'arena sta ora negoziando con calore visibile.",
    "Volume e tensione stanno salendo insieme, trasformando questo in una rotazione in diretta pi\u00f9 calda.",
    "La stanza sta diventando pi\u00f9 rumorosa attorno a questa partita, e le metriche lo confermano.",
    "Questa classifica si sta scaldando in un punto principale del broadcast, con l'arena completamente sveglia."
]
T6["tv.commentary.templates.finalThriller"] = [
    "L'orologio \u00e8 a {10}, il divario \u00e8 minuscolo, e quest'arena \u00e8 viva fino allo swing finale.",
    "Restano solo {10}, e una mossa pulita pu\u00f2 ancora capovolgere l'intera classifica.",
    "Il tratto finale \u00e8 qui, e il margine stretto tiene ogni secondo pericoloso.",
    "Questa arena sta entrando nel tempo di pressione con quasi nulla che separa i due lati.",
    "Orologio corto, divario breve, tensione in diretta: questa partita si rifiuta ancora di stabilirsi.",
    "La fine sta diventando drammatica, perch\u00e9 questa classifica \u00e8 ancora abbastanza vicina da capovolgersi.",
    "Non c'\u00e8 spazio per respirare in quest'arena, solo {10} e un altro swing.",
    "La partita sta raggiungendo la sua fase pi\u00f9 acuta, e il prossimo movimento pu\u00f2 riscrivere la fine."
]
T6["tv.commentary.templates.finalControlled"] = [
    "L'orologio \u00e8 corto a {10}, ma {0} mantiene ancora abbastanza spazio per gestire il finale.",
    "{0} entra nel tratto finale con il controllo, costringendo {1} a rincorrere in ritardo.",
    "Il tempo sta scadendo e {0} ha costruito il tipo di vantaggio che cambia lo script finale.",
    "Questa arena tardiva appartiene ancora a {0}, che sta proteggendo un cuscino significativo.",
    "{1} ha bisogno di qualcosa di immediato, perch\u00e9 {0} sta portando struttura negli ultimi minuti.",
    "L'endgame \u00e8 in corso, e {0} resta al comando della finestra di chiusura.",
    "{0} sta portando un vantaggio costante nella fase finale, rendendo il percorso di rimonta pi\u00f9 sottile.",
    "Con solo {10} rimasti, {0} ha il tipo di controllo che pu\u00f2 chiudere una classifica in diretta."
]
T6["tv.commentary.templates.opening"] = [
    "La partita \u00e8 ancora giovane, e entrambi i lati stanno tastando il primo ritmo dell'arena.",
    "All'inizio del ciclo, {2} e {3} stanno ancora scrivendo il capitolo di apertura di questa classifica.",
    "Questa arena sta appena iniziando, con abbastanza tempo rimanente per diversi swing narrativi.",
    "La fase di apertura resta cauta, e entrambi gli asset stanno ancora testando il ritmo in diretta.",
    "C'\u00e8 molto tempo rimasto, il che tiene questa classifica iniziale completamente aperta.",
    "Il primo tratto \u00e8 in corso, e nessun lato si \u00e8 ancora pienamente imposto.",
    "Questa finestra di apertura \u00e8 pi\u00f9 sul posizionamento che sulla separazione, almeno per ora.",
    "L'arena \u00e8 ancora nella sua lettura iniziale, e la mappa della pressione pu\u00f2 cambiare rapidamente."
]
T6["tv.commentary.templates.bothDown"] = [
    "Entrambi gli asset sono sotto pressione, ma {0} sta cadendo meno e sta trasformando la resistenza in un vantaggio.",
    "\u00c8 una battaglia difensiva in questo momento, e {0} sta assorbendo meglio il colpo del mercato.",
    "Nessun lato \u00e8 in verde, eppure {0} sta sopravvivendo al calo con pi\u00f9 controllo.",
    "Questa arena si sta decidendo nel rosso, dove {0} si sta reggendo pi\u00f9 pulitamente.",
    "Entrambi i grafici stanno scivolando, ma {0} sta resistendo a quello scivolamento meglio di {1}.",
    "Il mercato sta propendendo negativamente su entrambi i lati, e {0} ne sta facendo il meglio.",
    "Anche sotto pressione congiunta, {0} sta proteggendo pi\u00f9 valore sulla classifica.",
    "Questa \u00e8 una battaglia di controllo dei danni, e {0} sta attualmente facendo quel lavoro meglio."
]
T6["tv.commentary.templates.bothUp"] = [
    "Entrambi gli asset stanno salendo, ma {0} sta accelerando di pi\u00f9 e sta trasformando la crescita in pressione.",
    "Questa \u00e8 una classifica aggressiva con entrambi i lati in verde, e {0} sta ancora trovando pi\u00f9 slancio.",
    "L'arena ha un rialzo su entrambi i lati in questo momento, eppure {0} ne sta estraendo di pi\u00f9.",
    "Entrambi i grafici sono positivi, ma {0} sta spingendo la linea di espansione migliore.",
    "Questa battaglia in diretta ha forza su entrambe le estremit\u00e0, e {0} sta attualmente convertendo pi\u00f9 di essa.",
    "La classifica \u00e8 verde in tutta la sfida, con {0} che prende ancora la rotta pi\u00f9 forte verso l'alto.",
    "\u00c8 un duello di mercato in rialzo, e {0} sta vincendo la gara di accelerazione per ora.",
    "Entrambi i lati stanno salendo, ma {0} sta guidando la scalata pi\u00f9 netta."
]
T6["tv.commentary.templates.relativeLead"] = [
    "Anche con pressione su entrambi i lati, {0} sta gestendo meglio il mercato e resta in testa.",
    "{0} non ha bisogno di un rally pulito qui; resistere meglio \u00e8 sufficiente per mantenere il vantaggio.",
    "Questa arena si sta vincendo per performance relativa in questo momento, e {0} \u00e8 il migliore sopravvissuto.",
    "{0} sta facendo sembrare la resilienza come controllo su questa classifica.",
    "Il mercato non offre condizioni facili, ma {0} sta ancora difendendo il vantaggio con un migliore equilibrio.",
    "La forza relativa sta portando questa partita, e {0} attualmente possiede quel vantaggio.",
    "{0} non sta staccandosi; sta semplicemente resistendo meglio di {1}.",
    "Il vantaggio appartiene a {0}, che sta trasformando una resistenza pi\u00f9 costante in pressione sulla classifica."
]
T6["tv.commentary.templates.goalRecent"] = [
    "{0} ha appena colpito la classifica e iniettato energia fresca nell'arena.",
    "Un nuovo punto arriva per {0}, e l'intero tono di questo broadcast cambia immediatamente.",
    "{0} converte l'ultimo swing in impatto sulla classifica, costringendo {1} a rispondere.",
    "Quel punto cambia la texture in diretta della partita, e {0} ora ha il polso.",
    "{0} ha appena fatto reagire l'arena con un colpo pulito sulla classifica.",
    "La classifica si muove di nuovo, e {0} \u00e8 il lato che celebra l'ultimo impatto.",
    "{0} incassa il momento con un punto che alza la pressione su {1}.",
    "Danno fresco sulla classifica per {0}, e l'arena diventa pi\u00f9 rumorosa attorno a questa partita."
]
T6["tv.commentary.templates.cycleEnding"] = [
    "Questa arena sta avvicinandosi al suo ciclo di chiusura, e la forma attuale della classifica sta diventando finale.",
    "La partita sta rallentando, con la narrativa in diretta che inizia a stabilizzarsi attorno a {0}.",
    "L'arena sta chiudendo la sua ultima finestra ora, e ogni segnale rimanente porta peso aggiuntivo.",
    "Questo ciclo si sta avvicinando alla fine, il che rende il vantaggio attuale ancora pi\u00f9 significativo.",
    "La classifica sta transitando verso la sua fine, con poco tempo rimasto per riscrivere lo script.",
    "Il ciclo in diretta \u00e8 quasi chiuso, e l'arena si sta preparando per la prossima transizione.",
    "Questa partita sta raggiungendo il suo ultimo respiro, con la classifica che ora fa la maggior parte del parlare.",
    "La fine del ciclo \u00e8 in vista, e l'attuale mappa della pressione \u00e8 quasi bloccata."
]

# ===== waiting =====
add("tv.waiting", {"topCoinsEyebrow":"Classifica arena","topCoins":"Top coin","statsEyebrow":"Feed arena","latestBattles":"Ultime battaglie","gainersEyebrow":"Impulso di mercato","marketPulse":"Top movers","loadingRanking":"Caricamento classifica...","loadingFeed":"Caricamento feed arena...","loadingMarketPulse":"Caricamento impulso di mercato...","errorRanking":"Caricamento classifica fallito, riprovando...","errorFeed":"Caricamento feed fallito, riprovando...","errorMarketPulse":"Caricamento impulso di mercato fallito, riprovando...","emptyRanking":"Nessun dato classifica in questo momento","emptyFeed":"Nessun dato recente in questo momento","emptyMarketPulse":"Nessun grande movimento di mercato in questo momento"})

# ===== fallback =====
add("tv.fallback", {"closeMatchReason":"Battaglia crypto in diretta serrata con pressione dell'arena attiva.","liveArenaReason":"Battaglia dell'arena guidata dal mercato selezionata per il broadcast in diretta."})

# ===== ticker =====
add("tv.ticker", {"hotMatchDetected":"PARTITA CALDA RILEVATA","momentumShift":"CAMBIO MOMENTUM","fearSurge":"IMPULSO PAURA","arenaPressureRising":"PRESSIONE ARENA IN AUMENTO","liveCryptoBattle":"BATTAGLIA CRYPTO IN DIRETTA","marketVolatilityIncreasing":"VOLATILIT\u00c0 DI MERCATO IN AUMENTO","visitSite":"VISITA CRIPTOVERSUS.COM","liveBattles":"BATTAGLIE CRYPTO IN DIRETTA SU CRIPTOVERSUS.COM","rankings":"CLASSIFICHE E ARENE IN DIRETTA SU CRIPTOVERSUS.COM","matchMarkets":"GUARDA ARENE IN DIRETTA, CLASSIFICHE E MERCATI PARTITA SU CRIPTOVERSUS.COM","dominating":"{0} DOMINANTE","recovering":"{0} IN RECUPERO","finalMinutes":"ULTIMI MINUTI","crowdEnergySpike":"IMPULSO ENERGIA FOLLA","nextBattleAround":"PROSSIMA BATTAGLIA INTORNO ALLE {0}","marketPulseAround":"IMPULSO DI MERCATO INTORNO ALLE {0}"})

# ===== events =====
add("tv.events", {"goalKicker":"Evento goal","goalTitle":"GOAL {0}","leaderChangeKicker":"Cambio leader","leaderChangeTitle":"{0} PRENDE IL VANTAGGIO","leaderChangeBody":"La classifica dell'arena ha appena cambiato lato.","hotMatchKicker":"Cura in diretta","hotMatchTitle":"PARTITA CALDA RILEVATA","hotMatchBody":"Il broadcast si \u00e8 bloccato sulla battaglia dell'arena in diretta pi\u00f9 forte.","momentumReversalKicker":"Segnale momentum","momentumReversalTitle":"INVERSIONE MOMENTUM","momentumReversalBody":"La pressione si \u00e8 invertita e il flusso dell'arena sta cambiando.","fearSurgeKicker":"Segnale di rischio","fearSurgeTitle":"IMPULSO PAURA RILEVATO","fearSurgeBody":"La volatilit\u00e0 e la cautela sono appena salite sulla classifica in diretta.","hotScoreSpikeKicker":"Segnale calore","hotScoreSpikeTitle":"IMPULSO HOT SCORE","hotScoreSpikeBody":"L'intensit\u00e0 dell'arena \u00e8 accelerata in una finestra di broadcast pi\u00f9 forte.","finalMomentsKicker":"Avviso orologio","finalMomentsTitle":"ULTIMI MINUTI","finalMomentsBody":"La battaglia sta entrando nel suo tratto finale."})

# ===== narration =====
add("tv.narration", {"goalText":"{0} ROMPE LA DIFESA","goalSubtitle":"{0} contro {1}","leaderText":"{0} DOMINANTE","leaderSubtitle":"Leader cambiato dopo un nuovo swing dell'arena","devGrowText":"PRESSIONE IN AUMENTO","devGrowSubtitle":"Demo broadcast per animazione crescita","devZoomBurstText":"AQUILONE GOAL","devZoomBurstSubtitle":"Pressione dell'arena convertita in punteggio","devGlitchText":"CAMBIO MOMENTUM","devGlitchSubtitle":"La pressione di inversione sta salendo rapidamente","devNeonFlashText":"IMPULSO LIQUIDIT\u00c0","devNeonFlashSubtitle":"Evento diagnostico flash neon","devShockwaveText":"ULTIMI MINUTI","devShockwaveSubtitle":"L'arena sta entrando nel tempo di pressione","devScreenImpactText":"MASSIMA ROTTURA","devScreenImpactSubtitle":"Test stress cinematografico ad impatto completo","devMassiveBreakoutSubtitle":"L'arena sta detonando nel tempo di pressione","devDiagonalSwipeText":"BTC ROMPE LA DIFESA","devDiagonalSwipeSubtitle":"Test ingresso diagonale","devSplitRevealText":"RIMONTA INIZIATA","devSplitRevealSubtitle":"Evento diagnostico reveal diviso","devHologramRevealText":"PARTITA CALDA RILEVATA","devHologramRevealSubtitle":"Evento diagnostico reveal ologramma","devPulseText":"ARENA INSTABILE","devPulseSubtitle":"Evento diagnostico impulso","hotMatchDetectedText":"PARTITA CALDA RILEVATA","hotMatchDetectedSubtitle":"{0} vs {1} ha appena acceso l'arena","momentumShiftText":"CAMBIO MOMENTUM","momentumShiftSubtitle":"Rimonta {0} iniziata","fearSpikeText":"ARENA INSTABILE","fearSpikeSubtitle":"Impulso paura rilevato nel flusso ordini in diretta","hotScoreSpikeText":"IMPULSO LIQUIDIT\u00c0","hotScoreSpikeSubtitle":"Hot score in salita a {0}","finalMinutePushText":"SPINTA ULTIMO MINUTO","finalMinutePushSubtitle":"{0} rimanenti nel ciclo in diretta"})

# ===== walletPage =====
add("walletPage.heading", {"eyebrow":"Il mio wallet","title":"Il mio wallet","body":"Traccia il saldo di sistema, le selezioni e le performance degli asset senza lasciare l'arena."})
add("walletPage.states", {"loading":"Caricamento del tuo wallet...","loadingShort":"Caricamento...","walletRequired":"Accedi con il tuo wallet Solana per vedere le tue selezioni."})
T6["walletPage.fallbackUser"] = "Utente #{0}"
T6["walletPage.walletNetworkBalance"] = "Saldo on-chain"
T6["walletPage.onChainBalanceTitle"] = "Saldo in diretta su {0}"
add("walletPage.openPosition", {"cta":"Scegli Lato","modalTitle":"Scegli una squadra","amountTitle":"Scegli importo selezione","back":"Indietro","close":"Chiudi","searchLabel":"Scegli l'asset","searchPlaceholder":"Cerca per simbolo o nome","loadingAssets":"Caricamento asset idonei...","emptyAssets":"Nessun asset trovato per questa ricerca.","loadAssetsError":"Impossibile caricare gli asset.","priceUnavailable":"Prezzo non disponibile","openingOn":"Stai scegliendo una squadra su {0}","investmentIn":"Scegli {0}","valueInSol":"Valore in SOL","chooseAmount":"Scegli importo selezione","quickValues":"Valori rapidi in SOL","sliderLabel":"Aggiustamento rapido","amountInputLabel":"Importo manuale","walletBalanceLabel":"Saldo wallet","maximumAvailableLabel":"Massimo disponibile","useMax":"Usa max","insufficientBalance":"Saldo insufficiente","insufficientBalanceMessage":"Saldo wallet insufficiente. Hai {0} disponibili per questa operazione.","networkFeeReserve":"Devi mantenere una piccola riserva per la commissione di rete Solana.","custodyWalletLabel":"Wallet custodia","directFundingTitle":"Pagamento on-chain via Phantom.","directFundingLine1":"La tua selezione verr\u00e0 inviata direttamente dal tuo wallet all'arena.","directFundingLine2":"I fondi verranno inviati al wallet custodia di CriptoVersus.","cancel":"Annulla","investing":"Invio selezione...","investCta":"Scegli {0}","invalidAmount":"Inserisci un importo maggiore di zero.","assetBlocked":"Questo asset non \u00e8 aperto per nuova esposizione in questo momento.","availableNow":"Ingresso aperto","blockedNow":"Ingresso bloccato","walletFundingRequired":"Connetti e approva il wallet per usare il saldo on-chain in questa selezione.","walletMismatch":"Il wallet connesso non corrisponde all'account autenticato.","phantomRejected":"La firma o transazione Phantom \u00e8 stata annullata.","duplicateSignature":"Questa transazione \u00e8 gi\u00e0 stata usata. Aggiorna il wallet prima di riprovare se la selezione non \u00e8 apparsa.","statusAwaitingSignature":"In attesa firma Phantom.","statusConfirmingBlockchain":"Conferma trasferimento on-chain.","statusOpeningPosition":"Apertura selezione nel backend.","statusPositionOpened":"Selezione aperta con pagamento confermato.","transactionHash":"Hash transazione: {0}","successInline":"Selezione aperta su {0} con {1}.","successToast":"Selezione aperta su {0} con {1}."})
add("walletPage.openPositions", {"title":"Selezioni Aperte","count":"{0} attive","empty":"Non hai ancora selezioni aperte. Apri una selezione laterale e il tuo capitale inizier\u00e0 a tracciare quell'asset nell'arena.","invested":"Investito","entry":"Ingresso","pnl":"PnL semplice","time":"Tempo selezione","action":"Azione","exitRequested":"Uscita richiesta","closeNow":"Chiudi selezione","requestExit":"Richiedi uscita"})
add("walletPage.seo", {"title":"CriptoVersus Il Mio Wallet","description":"Pagina wallet interna di CriptoVersus per saldi, posizioni, dettagli custodia e cronologia account.","imageAlt":"Pagina wallet CriptoVersus"})
add("walletPage.profile", {"connectedWallet":"Wallet connesso","user":"Utente","lastAccess":"Ultimo accesso"})
add("walletPage.mode", {"operationalMode":"Modalit\u00e0 operativa","offChainCustodyMode":"Modalit\u00e0 Custodia Off-chain"})
add("walletPage.custody", {"wallet":"Wallet custodia","publicAddress":"Indirizzo pubblico","copyWallet":"Copia wallet","explanation":"In questa modalit\u00e0, le scommesse usano solo il saldo interno della banca. I trasferimenti SOL al wallet custodia devono essere riconciliati per diventare saldo interno prima di scommettere.","withdrawalsDisabled":"I prelievi automatici al wallet connesso sono disabilitati in questa modalit\u00e0 per evitare addebiti senza trasferimento on-chain confermato.","copied":"Wallet custodia copiato.","copyFailed":"Impossibile copiare il wallet: {0}"})
add("walletPage.metrics", {"systemBalance":"Saldo di sistema","allocatedCapital":"Capitale allocato","open":"Aperto","exitPositions":"Posizioni di uscita","realizedProfit":"Profitto realizzato","realizedLoss":"Perdita realizzata","realizedNetResult":"Risultato netto realizzato"})
add("walletPage.withdraw", {"releaseExplanation":"Per rilasciare il saldo per il prelievo, finalizza una posizione fuori dal gioco. Se \u00e8 ancora collegata a una partita in corso, l'uscita viene richiesta e il saldo ritorna automaticamente al sistema quando quella partita viene liquidata."})
add("walletPage.actions", {"withdrawToWallet":"Preleva al mio wallet","walletChanged":"Il wallet connesso \u00e8 stato cambiato o disconnesso. Accedi di nuovo con il wallet attuale.","sessionExpired":"La tua sessione \u00e8 scaduta. Accedi di nuovo con il tuo wallet Solana.","walletLoadFailed":"Impossibile caricare il tuo wallet: {0}","modeUnsupported":"La modalit\u00e0 {0} non supporta ancora i prelievi automatici on-chain. Il tuo saldo resta disponibile nel sistema per un futuro tentativo.","walletNotConnected":"Wallet non connesso.","walletMismatch":"Il wallet connesso \u00e8 diverso dall'account autenticato.","custodyWithdrawAuthorized":"Il wallet ha autorizzato il prelievo. Invio del prelievo reale dalla custodia al tuo wallet...","confirmWithdrawError":"Impossibile confermare il prelievo nel wallet.","withdrawCompleted":"Prelievo completato.","transactionSent":"Transazione inviata: {0}","transactionConfirmed":"Transazione confermata: {0}","positionClosed":"La posizione {0} \u00e8 stata chiusa e il saldo \u00e8 tornato al sistema.","positionCloseFailed":"Impossibile chiudere la posizione {0}: {1}","balanceLookupFailed":"Impossibile interrogare il saldo on-chain: {0}","closeRequestedOngoing":"La posizione {0} \u00e8 stata marcata per l'uscita. Perch\u00e9 fa ancora parte di una partita in corso, il saldo verr\u00e0 rilasciato al sistema non appena quella partita verr\u00e0 liquidata.","closeRequestedPending":"La posizione {0} \u00e8 stata marcata per l'uscita. \u00c8 gi\u00e0 collegata a una partita aperta e il saldo verr\u00e0 rilasciato al sistema quando quella partita finir\u00e0.","closeRequestedDefault":"La posizione {0} \u00e8 stata marcata per l'uscita. Il saldo verr\u00e0 rilasciato al sistema quando la partita collegata finir\u00e0.","insufficientBalance":"Saldo insufficiente.","walletLoadUnavailable":"La route Il Mio Wallet non \u00e8 ancora disponibile nell'API in esecuzione. Riavvia il progetto locale CriptoVersus.API o pubblica l'API aggiornata.","validatingConnectedWallet":"Validazione del wallet connesso...","programIdMissing":"Il program id di CriptoVersusBlockchain non \u00e8 configurato per il flusso posizioni wallet."})
add("walletPage.openSelections", {"title":"Selezioni aperte","countOne":"{0} attiva","countOther":"{0} attive","empty":"Non hai ancora selezioni aperte. Apri una selezione dell'arena e i tuoi fondi inizieranno a tracciare quell'asset nell'arena."})
add("walletPage.elapsed", {"days":"{0}g aperta","hours":"{0}h aperta","minutes":"{0}m aperta"})
add("walletPage.history", {"title":"Cronologia per token/squadra","summary":"{0} aperte | {1} liquidate","summaryText":"{0} partite registrate: {1} vinte, {2} perse, {3} aperte.","loadError":"Impossibile caricare le partite: {0}","loading":"Caricamento partite...","emptyResults":"Nessuna partita trovata per questo filtro.","hideMatches":"Nascondi partite","showMatches":"Mostra partite","pageInfo":"Pagina {0} di {1} | {2} partite","pageSummary":"Pagina {0} di {1}","previous":"Precedente","next":"Successivo","vs":"vs","matchNumber":"Partita #{0}","myTeam":"La mia squadra: {0}","winner":"Vincitore: {0}","betAmount":"Puntato","receivedAmount":"Ricevuto","netResult":"Risultato netto","refund":"Rimborso","houseFee":"Commissione casa","financialStatus":"Stato finanziario","showMatchDetails":"Mostra dettagli partita","hideMatchDetails":"Nascondi dettagli partita","start":"Inizio","end":"Fine","matchStatus":"Stato partita","teamAWallets":"Wallet sulla Squadra A","teamBWallets":"Wallet sulla Squadra B","teamABets":"Puntate sulla Squadra A","teamBBets":"Puntate sulla Squadra B","totalTeamA":"Totale sulla Squadra A","totalTeamB":"Totale sulla Squadra B","totalPool":"Pool totale","winningPool":"Pool vincente","losingPool":"Pool perdente","totalDistributed":"Totale distribuito","validDispute":"Disputa finanziaria valida?","yes":"S\u00ec","no":"No","settlementReason":"Motivo settlement","unknown":"Sconosciuto","matchStatusPending":"In attesa","matchStatusOngoing":"In corso","matchStatusCompleted":"Completata","matchStatusCancelled":"Annullata","betPrefix":"Puntato: {0}","resultPrefix":"Risultato: {0}","receivedPrefix":"Ricevuto: {0}"})
add("walletPage.history.metrics", {"allocatedCapital":"Capitale allocato","open":"Aperto","refundedMatches":"Partite rimborsate","realizedNetResult":"Risultato netto realizzato","wonMatches":"Partite vinte","lostMatches":"Partite perse","lastEntry":"Ultimo ingresso"})
add("walletPage.history.filters", {"all":"Tutte","won":"Vinte","lost":"Perse","open":"Aperte","finalized":"Finalizzate"})
add("walletPage.history", {"groupCount":"{0} gruppi","emptyGroups":"Non hai ancora gruppi di investimento."})
T6["walletPage.modal.kicker"] = "ARENA CRYPTO"
add("walletPage.solana", {"close":"Chiudi","connectTitle":"Connetti un wallet su Solana per continuare","connectDescription":"Scegli un wallet supportato per connetterti e accedere senza cambiare il flusso API attuale.","connectedWalletGeneric":"Wallet connesso","connectedWalletNamed":"{0} connesso","availableInBrowser":"Disponibile in questo browser","openInstallPage":"Apri pagina installazione ufficiale","detected":"Rilevato","install":"Installa","disconnect":"Disconnetti","installRequiredTitle":"Installazione richiesta","installRequiredMessage":"Apri la pagina ufficiale {0} e installa il wallet per continuare.","connectingTitle":"Connessione wallet","connectingMessage":"In attesa dell'approvazione di {0} nel tuo browser.","connectionFailedTitle":"Connessione fallita","missingPublicKeyTitle":"Chiave pubblica mancante","missingPublicKeyMessage":"Il wallet si \u00e8 connesso, ma nessuna chiave pubblica \u00e8 stata restituita.","walletConnectedTitle":"Wallet connesso","walletConnectedMessage":"Wallet connesso. Completamento autenticazione...","walletDisconnectedTitle":"Wallet disconnesso","walletDisconnectedMessage":"Puoi connettere qualsiasi wallet Solana supportato di nuovo in qualsiasi momento.","disconnectFailedTitle":"Disconnessione fallita","connectWalletTitle":"Connetti un wallet","connectWalletMessage":"Scegli un wallet Solana prima di continuare.","loginUnavailableTitle":"Login non disponibile","loginUnavailableMessage":"Non \u00e8 stato possibile preparare la firma di login in questo momento. Riprova.","awaitingSignatureTitle":"In attesa firma","awaitingSignatureMessage":"Approva la richiesta di firma nel tuo wallet per completare il login.","loginRejectedTitle":"Login rifiutato","loginRejectedMessage":"Non \u00e8 stato possibile validare la firma del tuo wallet. Riprova.","incompleteLoginTitle":"Login incompleto","incompleteLoginMessage":"L'API ha confermato il login, ma nessun token di sessione \u00e8 stato restituito.","loginCompleteTitle":"Login completato","loginCompleteMessage":"Il tuo wallet \u00e8 stato autenticato con successo.","loginCompleteOnChainMessage":"Il tuo wallet \u00e8 stato autenticato e l'account on-chain \u00e8 stato validato.","loginFailedTitle":"Impossibile completare il login","onChainProgramMissing":"Il program id di CriptoVersusBlockchain non \u00e8 configurato per la modalit\u00e0 attuale.","preparingOnChainTitle":"Preparazione account on-chain","preparingOnChainMessage":"Validazione dell'account wallet corrente nel programma Solana attivo.","onChainReadyTitle":"Account on-chain pronto","onChainReadyMessage":"PDA: {0}","unexpectedError":"Qualcosa di inaspettato \u00e8 successo. Riprova.","errorCanceled":"La connessione \u00e8 stata cancellata nel wallet.","errorProviderNotFound":"Provider wallet non trovato in questo browser.","errorMissingPublicKey":"Il wallet non ha restituito una chiave pubblica valida."})

# ===== token =====
add("token.seo", {"title":"CriptoVersus Token Arena | Token Community Ufficiale","description":"Esplora la pagina ufficiale del token CriptoVersus, dettagli contratto, snapshot di mercato e accesso Pump.fun per il token della community dell'arena di battaglie crypto in diretta."})
add("token.hero", {"badge":"Token ufficiale CriptoVersus","title":"CriptoVersus Token Arena","subtitle":"Il token che alimenta l'Arena.","description":"Unisciti alla prima arena di battaglie crypto in diretta. Guarda le battaglie di mercato, scegli la tua squadra e diventa parte dell'ecosistema CriptoVersus."})
add("token.visual", {"bulls":"Tori","bears":"Orsi"})
add("token.action", {"buy":"Compra su Pump.fun","watch":"Guarda Arena in Diretta","copyContract":"Copia Contratto","copied":"Copiato!","viewPump":"Vedi su Pump.fun"})
add("token.contract", {"kicker":"Contratto token","title":"Indirizzo Contratto","network":"Rete","buyTax":"Tassa acquisto","sellTax":"Tassa vendita","qrKicker":"Accesso Pump.fun","qrAlt":"Codice QR per aprire il token CriptoVersus su Pump.fun","qrDescription":"Scansiona questo codice per aprire la pagina ufficiale del token CriptoVersus su Pump.fun dal tuo telefono.","qrAction":"Apri Pump.fun"})
add("token.stats", {"price":"Prezzo Attuale","marketCap":"Capitalizzazione","holders":"Detentori","volume24h":"Volume 24h","liquidity":"Liquidit\u00e0"})
add("token.market", {"loadingTitle":"Caricamento snapshot token","loadingBody":"Preparazione del pannello di mercato pi\u00f9 recente del token per la vista arena.","liveTitle":"Pannello mercato in diretta","liveBody":"Snapshot di mercato aggiornato: {0}","fallbackTitle":"Pannello mercato di fallback","fallbackBody":"I fornitori di mercato non hanno ancora completamente indicizzato questo token. L'arena mantiene la pagina stabile mentre i dati freschi di mercato diventano disponibili.","errorTitle":"Pannello mercato recuperato con fallback","errorBody":"La richiesta di mercato in diretta \u00e8 fallita, quindi l'arena ha mantenuto la pagina online con valori di fallback invece di interrompere l'esperienza.","unavailableTitle":"Indicizzazione mercato in corso","unavailableBody":"Questo token \u00e8 ancora in fase di indicizzazione dai fornitori pubblici di dati di mercato. Le statistiche in diretta appariranno automaticamente una volta che l'indicizzazione sar\u00e0 disponibile.","notIndexedYet":"Dati di mercato non ancora indicizzati","unavailableValue":"Non disponibile"})
add("token.market.supporting", {"updated":"Aggiornato: {0}","contract":"Token ufficiale dell'arena","community":"Conteggio squadre community","window24h":"Finestra rotante 24h","depth":"Profondit\u00e0 pool visibile"})
add("token.utility", {"kicker":"Utilit\u00e0 arena","title":"A cosa serve il token?"})
add("token.utility.items.participate", {"title":"Partecipa all'Arena","description":"Stai pi\u00f9 vicino alle battaglie in diretta, segui l'identit\u00e0 della partita e sostieni il livello di intrattenimento dell'ecosistema."})
add("token.utility.items.community", {"title":"Accesso community","description":"Resta collegato alla folla, ai canali social e alle future attivazioni community attorno a CriptoVersus."})
add("token.utility.items.utility", {"title":"Utilit\u00e0 futura dell'ecosistema","description":"Prepara la struttura della pagina per future utilit\u00e0 legate all'esperienza in evoluzione dell'arena."})
add("token.utility.items.identity", {"title":"Identit\u00e0 battaglie crypto in diretta","description":"Porta il simbolo di un'arena di intrattenimento Web3 costruita attorno alle squadre, alla volatilit\u00e0 e allo spettacolo del mercato in diretta."})
add("token.about", {"kicker":"Informazioni sul token","title":"Informazioni sul token","description":"Questo token \u00e8 un token community sperimentale creato per sostenere l'ecosistema CriptoVersus. Non \u00e8 una promessa di profitto, non \u00e8 consulenza finanziaria, e non \u00e8 una raccomandazione di investimento."})
add("token.notice", {"title":"Avviso Importante","description":"Questo \u00e8 un token di intrattenimento/community sperimentale. Gli asset crypto sono rischiosi. Fai sempre le tue ricerche e non investire mai pi\u00f9 di quanto puoi permetterti di perdere."})
add("token.schema", {"name":"CriptoVersus Token","category":"Token community"})
add("token.schema.properties", {"network":"Rete","contractAddress":"Indirizzo contratto","buyTax":"Tassa acquisto","sellTax":"Tassa vendita"})
add("token.footer", {"kicker":"Chiamata finale","cta":"Scegli la tua squadra. Entra nell'Arena.","button":"Compra Token Ora"})

# ===== top-level =====
T6["title"] = "Match market"
add("postLogin", {"eyebrow":"Wallet connesso","title":"Vuoi aprire il tuo wallet adesso?","body":"Il tuo wallet \u00e8 stato connesso con successo. Puoi aprire Il Mio Wallet adesso o restare sulla pagina corrente.","stay":"Resta su questa pagina","goToWallet":"Vai al Mio Wallet"})

# ===== reconnect =====
add("reconnect", {"eyebrow":"CRIPTO VERSUS ARENA","title":"Riconnessione all'arena in corso...","connectionLost":"La connessione al server \u00e8 stata persa. Stiamo ripristinando il segnale dell'arena cos\u00ec puoi continuare a seguire la partita.","attempt":"Tentativo","of":"di","retrying":"Riconnessione automatica in corso","failed":"Impossibile riconnettersi automaticamente.","rejected":"La sessione \u00e8 stata rifiutata dal server. Ricarica per entrare di nuovo.","paused":"La riconnessione \u00e8 stata temporaneamente messa in pausa.","reload":"Ricarica ora"})

# ===== communityMatch =====
add("communityMatch", {"eyebrow":"Creazione pubblica","title":"Hai un accoppiamento migliore in mente?","body":"Crea la tua battaglia e sfida la community.","button":"Crea la mia battaglia"})
add("communityMatch.errors", {"unavailable":"La creazione pubblica delle battaglie \u00e8 temporaneamente non disponibile.","invalidAsset":"Scegli due asset validi.","sameAsset":"Scegli due asset diversi.","duplicate":"C'\u00e8 gi\u00e0 una battaglia attiva per questo accoppiamento.","captchaInvalid":"Non \u00e8 stato possibile validare il CAPTCHA. Riprova.","captchaExpired":"Il CAPTCHA \u00e8 scaduto. Confermalo di nuovo per continuare.","rateLimited":"Riprova tra {0} secondi.","network":"Non \u00e8 stato possibile connettersi al server. Riprova.","generic":"Non \u00e8 stato possibile creare la battaglia in questo momento."})
add("communityMatch.modal", {"eyebrow":"Battaglia pubblica","title":"Crea una battaglia","close":"Chiudi","orange":"Lato arancione","cyan":"Lato blu","searchPlaceholder":"Cerca per simbolo o nome","loading":"Caricamento asset...","empty":"Nessun asset disponibile","selectLeft":"Seleziona il lato arancione","selectRight":"Seleziona il lato blu","previewLeft":"Anteprima lato arancione","previewRight":"Anteprima lato blu","submit":"CREA BATTAGLIA","submitting":"Creazione battaglia...","footnote":"Battaglia creata dalla community","captchaRequired":"Conferma il CAPTCHA per continuare.","captchaError":"Non \u00e8 stato possibile validare il CAPTCHA. Riprova.","created":"Battaglia creata con successo!","existing":"C'\u00e8 gi\u00e0 una battaglia attiva per questo accoppiamento.","fallbackError":"Non \u00e8 stato possibile creare la battaglia in questo momento.","unavailable":"La creazione pubblica delle battaglie \u00e8 temporaneamente non disponibile.","sameAsset":"Scegli due asset diversi.","assetUnavailable":"Uno degli asset selezionati non \u00e8 disponibile in questo momento.","invalidAsset":"Scegli due asset validi.","tooManyRequests":"Riprova tra {0} secondi."})

# ===== candleBattleV2 =====
add("candleBattleV2", {"title":"Candle Battle","ariaLabel":"Candle Battle tra {0} e {1}","loading":"Caricamento Candle Battle...","error":"Battaglia non disponibile","errorBody":"Non \u00e8 stato possibile caricare lo stato ufficiale della partita. Riprova.","notFound":"Partita non trovata.","retry":"Riprova","live":"In diretta","reconnecting":"Riconnessione","finished":"Partita finita","waitingMarket":"In attesa del mercato","waitingNext":"In attesa della prossima candela","nextCandles":"Prossime candele","nextCandle":"Prossima candela","forming":"In formazione","score":"Punteggio","points":"punti","point":"Punto","pointFor":"Punto per {0}","draw":"Pareggio","champion":"Campione","officialScore":"Punteggio ufficiale server","blockLegend":"1 blocco quadrato = 1 punto","blocksFor":"Blocchi {1} punti per {0}","navigationLabel":"Navigazione Candle Battle","backToMatch":"Torna alla partita","watchOnTv":"Guarda in TV","seoTitle":"Candle Battle V2 | CriptoVersus","seoDescription":"Guarda i punti delle partite crypto ufficiali diventare blocchi in un'arena competitiva di candele in diretta."})