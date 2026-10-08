#!/usr/bin/env python3
"""Fix remaining untranslated strings in it-IT.json."""
import json, os

base = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(base, "i18n.it-IT.json")

with open(path, "r", encoding="utf-8") as f:
    it = json.load(f)

# Fix roadmap.brandPillars arrays (these are objects, not matched by path lookup)
pillars_it = [
    {"icon": "\u2726", "accent": "purple", "title": "Competizione", "subtitle": "Tra asset digitali"},
    {"icon": "\u2197", "accent": "green", "title": "Strategia", "subtitle": "Performance e tempismo"},
    {"icon": "\u2b22", "accent": "cyan", "title": "Tecnologia", "subtitle": "Infrastruttura blockchain"},
    {"icon": "\U0001F3C6", "accent": "gold", "title": "Classifica", "subtitle": "Punteggio e progressione"},
    {"icon": "\u25ce", "accent": "purple", "title": "Globale", "subtitle": "Arena decentralizzata"}
]
if "roadmap" in it and "brandPillars" in it["roadmap"]:
    it["roadmap"]["brandPillars"] = pillars_it

# Fix roadmap.statusCards arrays
status_cards_it = [
    {"title": "Sviluppo attivo", "description": "La piattaforma si evolve continuamente con rilasci pubblici e perfezionamenti operativi.", "tag": "Attivo"},
    {"title": "Partite crypto automatizzate", "description": "Cicli basati sul mercato tra asset con tracciamento del punteggio e aggiornamenti continui.", "tag": "Automazione"},
    {"title": "Cronologia pubblica", "description": "I risultati e il contesto delle partite diventano sempre pi\u00f9 visibili per audit e revisione.", "tag": "Trasparenza"},
    {"title": "Regole in evoluzione", "description": "I modelli di punteggio e le dinamiche economiche sono ancora in fase di test e perfezionamento.", "tag": "Iterazione"},
    {"title": "Pronto per l'espansione internazionale", "description": "Routing, SEO e supporto ai fusi orari locali vengono plasmati per pi\u00f9 regioni.", "tag": "i18n-ready"}
]
if "roadmap" in it and "statusCards" in it["roadmap"]:
    it["roadmap"]["statusCards"] = status_cards_it

# Fix roadmap.phases arrays
phases_it = [
    {"phaseLabel": "Fase 1", "title": "Fondamento della Piattaforma", "status": "InProgress", "description": "Fondamento operativo per le partite pubbliche, i cicli iniziali e il flusso di gioco guidato dal mercato.", "items": ["Creazione di partite tra coin", "Integrazione dati di mercato", "Vista partita in diretta", "Cronologia partite completate", "Registrazione risultati e punteggio"], "sortOrder": 1},
    {"phaseLabel": "Fase 2", "title": "Trasparenza e Auditabilit\u00e0", "status": "InProgress", "description": "Superfici pubbliche che spiegano come si evolve ogni partita e come i risultati possono essere revisionati.", "items": ["Pagina cronologia pubblica", "Pagina dettaglio partita pubblica", "Visualizzazione chiara di punteggio, performance e risultato", "Miglioramenti SEO", "Metadati pubblici per partita", "Registri eventi della partita per futura auditabilit\u00e0"], "sortOrder": 2},
    {"phaseLabel": "Fase 3", "title": "Regole di Punteggio Avanzate", "status": "Planned", "description": "Logica di partita pi\u00f9 ricca progettata per rimanere spiegabile e guidata dai dati.", "items": ["Punteggio per differenza percentuale", "Punteggio per incroci sul grafico", "Punteggio per finestre di volume", "Log degli eventi della partita", "Fondamento per un futuro commentatore IA"], "sortOrder": 3},
    {"phaseLabel": "Fase 4", "title": "Economia Ciclica", "status": "Planned", "description": "Evoluzione verso un modello di pool competitivo pi\u00f9 sperimentale.", "items": ["Partecipazione automatica ai cicli futuri", "Migliore controllo dell'equilibrio", "Riduzione delle perdite improvvise", "Un modello pi\u00f9 vicino a un pool competitivo che a una scommessa tradizionale", "Simulazioni e messa a punto prima della produzione pi\u00f9 ampia"], "sortOrder": 4},
    {"phaseLabel": "Fase 5", "title": "Internazionalizzazione", "status": "Planned", "description": "Routing e struttura dei contenuti preparati per l'espansione multilingue.", "items": ["Route i18n", "Contenuti in portoghese e inglese", "Hreflang", "SEO internazionale", "Fuso orario locale per regione"], "sortOrder": 5},
    {"phaseLabel": "Fase 6", "title": "Integrazione Blockchain", "status": "Experimental", "description": "Un livello on-chain sperimentale focalizzato sull'auditabilit\u00e0 e sull'infrastruttura dove ha senso.", "items": ["Integrazione Solana Devnet/Mainnet", "Selezioni e saldi on-chain dove appropriato", "Separazione tra logica off-chain e settlement on-chain", "Maggiore auditabilit\u00e0 pubblica"], "sortOrder": 6},
    {"phaseLabel": "Fase 7", "title": "Commento IA ed Esperienza", "status": "Future", "description": "Miglioramenti dell'esperienza costruiti su dati di partita verificabili e cronologia pubblica.", "items": ["Commentatore automatizzato delle partite", "Riepiloghi post-partita", "Momenti salienti della partita", "Spiegazioni degli eventi decisivi", "Condivisione social"], "sortOrder": 7}
]
if "roadmap" in it and "phases" in it["roadmap"]:
    it["roadmap"]["phases"] = phases_it

# Fix roadmap.principles arrays
principles_it = [
    {"title": "Trasparenza prima della scala", "description": "Spiega come funziona il sistema prima di cercare di accelerare la distribuzione.", "tag": "Principio"},
    {"title": "Regole chiare prima della monetizzazione", "description": "L'evoluzione del prodotto dovrebbe rimanere leggibile prima di diventare pi\u00f9 ampia.", "tag": "Principio"},
    {"title": "Sicurezza prima dell'automazione", "description": "Automatizza i flussi solo dopo che sono sufficientemente validati.", "tag": "Principio"},
    {"title": "Cronologia pubblica prima delle classifiche", "description": "Rendi i risultati osservabili prima di aggiungere livelli competitivi pi\u00f9 grandi.", "tag": "Principio"},
    {"title": "Dati verificabili prima della narrativa", "description": "Qualsiasi futuro livello narrativo dovrebbe basarsi su log, eventi e risultati.", "tag": "Principio"}
]
if "roadmap" in it and "principles" in it["roadmap"]:
    it["roadmap"]["principles"] = principles_it

# Fix tv.commentary.templates arrays
templates = it.get("tv", {}).get("commentary", {}).get("templates", {})

templates["balanced"] = [
    "{2} e {3} sono ancora appaiati, ma il Momentum sta iniziando a propendere per {0}.",
    "La classifica \u00e8 serrata e l'arena \u00e8 ancora aperta, con {0} che mantiene solo un fragile vantaggio.",
    "Questa partita \u00e8 bloccata per ora, eppure una mossa pulita pu\u00f2 spostare la pressione verso {0}.",
    "{2} versus {3} resta bilanciato, e la prossima spinta di mercato potrebbe riscrivere completamente la lettura.",
    "Nessun lato ha aperto l'arena, e questo tiene {0} sotto costante pressione.",
    "Una classifica stretta e percentuali vicine tengono viva questa arena a ogni tick.",
    "Non c'\u00e8 quasi nulla tra questi due lati in questo momento, il che rende il prossimo swing critico.",
    "{0} ha il vantaggio sulla carta, ma questa arena sta ancora negoziando come una battaglia di una mossa."
]
templates["comeback"] = [
    "Il vantaggio ha cambiato lato e {0} possiede improvvisamente il Momentum dell'arena.",
    "{0} ha capovolto la partita, e il broadcast ora sembra una storia di rimonta in diretta.",
    "Quello che sembrava stabile un attimo fa \u00e8 ora un'inversione, con {0} che prende la linea frontale.",
    "{0} ha appena trasformato la pressione in controllo e cambiato il tono della partita.",
    "L'arena ha un nuovo leader, e {0} sta ora costringendo {1} a reagire.",
    "{0} ha ripreso il vantaggio, dando a questa battaglia la forma di una rimonta.",
    "Un cambio di leadership \u00e8 appena arrivato, e {0} ora porta la narrativa pi\u00f9 forte.",
    "{1} aveva il controllo, ma {0} ha contrattaccato e rubato il vantaggio."
]
templates["pressureRising"] = [
    "{0} sta iniziando a premere in avanti, e l'arena sta iniziando a seguire quel ritmo.",
    "L'impulso di mercato sta propendendo di pi\u00f9 verso {0}, anche con la classifica ancora sotto pressione.",
    "{0} sta costruendo una sequenza migliore e costringendo l'arena a rispettare quella scalata.",
    "Questa partita si sta stringendo attorno a {0}, che ora sta spingendo il ritmo della classifica.",
    "La pressione sta crescendo sul lato di {0}, e la prossima mossa potrebbe trasformarla in danno sulla classifica.",
    "{0} sta accumulando le reazioni pi\u00f9 forti in questo momento e tirando la partita nella sua corsia.",
    "Il ritmo si sta spostando verso {0}, e {1} ha bisogno di una risposta rapidamente.",
    "{0} sta accelerando al momento giusto, il che sta cambiando la sensazione dell'arena."
]
templates["dominance"] = [
    "{0} sta giocando dal davanti e tiene questa arena sotto chiaro controllo.",
    "Il divario nella classifica sta crescendo, e {0} sta ora trasformando la pressione in comando.",
    "{0} ha aperto un vero distacco in questa partita e sta dettando il ritmo.",
    "Questa \u00e8 un'arena controllata in questo momento, con {0} che sostiene un forte vantaggio.",
    "{1} ha ancora tempo, ma {0} sta rendendo questa classifica unilaterale.",
    "{0} non sta solo guidando; sta controllando la struttura della partita.",
    "Il vantaggio sta diventando sostanziale, e {0} sta ora operando da una posizione di comfort.",
    "{0} mantiene il vantaggio abbastanza ampio da rendere questa arena sempre pi\u00f9 controllata."
]
templates["quietPool"] = [
    "{2} e {3} stanno ancora aspettando un vero volume del pool, cos\u00ec un ingresso pu\u00f2 resettare il ritmo istantaneamente.",
    "L'arena \u00e8 tecnicamente in diretta, ma il pool resta silenzioso e il prossimo segnale conta pi\u00f9 che mai.",
    "La bassa attivit\u00e0 tiene questa partita sobria per ora, anche se la classifica pu\u00f2 svegliarsi rapidamente.",
    "Non c'\u00e8 ancora molta aggressivit\u00e0 nel pool, il che lascia questa arena aperta a un cambio improvviso.",
    "Questa battaglia sta ancora respirando leggermente, con volume limitato e ritmo cauto.",
    "Il pool \u00e8 lento, la classifica \u00e8 paziente, e una mossa decisiva pu\u00f2 cambiare improvvisamente il tono.",
    "Il volume non si \u00e8 ancora aperto, quindi l'arena sta ancora aspettando un trigger pi\u00f9 forte.",
    "La classifica in diretta \u00e8 calma per ora, ma ci\u00f2 spesso significa che la prossima spinta arriva pi\u00f9 forte."
]
templates["heatedPool"] = [
    "Questa arena si sta scaldando rapidamente, con hotScore a {8} e vera pressione che si costruisce su entrambi i lati.",
    "L'intensit\u00e0 del pool sta crescendo, e questa partita sta iniziando a sembrare una delle finestre pi\u00f9 calde in onda.",
    "L'arena ha ora vero calore, con pressione, volume e competitivit\u00e0 che salgono insieme.",
    "Con hotScore a {8}, questa partita si sta guadagnando l'attenzione premium del broadcast.",
    "Questa non \u00e8 pi\u00f9 una classifica silenziosa; l'arena sta ora negoziando con calore visibile.",
    "Volume e tensione stanno salendo insieme, trasformando questo in una rotazione in diretta pi\u00f9 calda.",
    "La stanza sta diventando pi\u00f9 rumorosa attorno a questa partita, e le metriche lo confermano.",
    "Questa classifica si sta scaldando in un punto principale del broadcast, con l'arena completamente sveglia."
]
templates["finalThriller"] = [
    "L'orologio \u00e8 a {10}, il divario \u00e8 minuscolo, e quest'arena \u00e8 viva fino allo swing finale.",
    "Restano solo {10}, e una mossa pulita pu\u00f2 ancora capovolgere l'intera classifica.",
    "Il tratto finale \u00e8 qui, e il margine stretto tiene ogni secondo pericoloso.",
    "Questa arena sta entrando nel tempo di pressione con quasi nulla che separa i due lati.",
    "Orologio corto, divario breve, tensione in diretta: questa partita si rifiuta ancora di stabilirsi.",
    "La fine sta diventando drammatica, perch\u00e9 questa classifica \u00e8 ancora abbastanza vicina da capovolgersi.",
    "Non c'\u00e8 spazio per respirare in quest'arena, solo {10} e un altro swing.",
    "La partita sta raggiungendo la sua fase pi\u00f9 acuta, e il prossimo movimento pu\u00f2 riscrivere la fine."
]
templates["finalControlled"] = [
    "L'orologio \u00e8 corto a {10}, ma {0} mantiene ancora abbastanza spazio per gestire il finale.",
    "{0} entra nel tratto finale con il controllo, costringendo {1} a rincorrere in ritardo.",
    "Il tempo sta scadendo e {0} ha costruito il tipo di vantaggio che cambia lo script finale.",
    "Questa arena tardiva appartiene ancora a {0}, che sta proteggendo un cuscino significativo.",
    "{1} ha bisogno di qualcosa di immediato, perch\u00e9 {0} sta portando struttura negli ultimi minuti.",
    "L'endgame \u00e8 in corso, e {0} resta al comando della finestra di chiusura.",
    "{0} sta portando un vantaggio costante nella fase finale, rendendo il percorso di rimonta pi\u00f9 sottile.",
    "Con solo {10} rimasti, {0} ha il tipo di controllo che pu\u00f2 chiudere una classifica in diretta."
]
templates["opening"] = [
    "La partita \u00e8 ancora giovane, e entrambi i lati stanno tastando il primo ritmo dell'arena.",
    "All'inizio del ciclo, {2} e {3} stanno ancora scrivendo il capitolo di apertura di questa classifica.",
    "Questa arena sta appena iniziando, con abbastanza tempo rimanente per diversi swing narrativi.",
    "La fase di apertura resta cauta, e entrambi gli asset stanno ancora testando il ritmo in diretta.",
    "C'\u00e8 molto tempo rimasto, il che tiene questa classifica iniziale completamente aperta.",
    "Il primo tratto \u00e8 in corso, e nessun lato si \u00e8 ancora pienamente imposto.",
    "Questa finestra di apertura \u00e8 pi\u00f9 sul posizionamento che sulla separazione, almeno per ora.",
    "L'arena \u00e8 ancora nella sua lettura iniziale, e la mappa della pressione pu\u00f2 cambiare rapidamente."
]
templates["bothDown"] = [
    "Entrambi gli asset sono sotto pressione, ma {0} sta cadendo meno e sta trasformando la resistenza in un vantaggio.",
    "\u00c8 una battaglia difensiva in questo momento, e {0} sta assorbendo meglio il colpo del mercato.",
    "Nessun lato \u00e8 in verde, eppure {0} sta sopravvivendo al calo con pi\u00f9 controllo.",
    "Questa arena si sta decidendo nel rosso, dove {0} si sta reggendo pi\u00f9 pulitamente.",
    "Entrambi i grafici stanno scivolando, ma {0} sta resistendo a quello scivolamento meglio di {1}.",
    "Il mercato sta propendendo negativamente su entrambi i lati, e {0} ne sta facendo il meglio.",
    "Anche sotto pressione congiunta, {0} sta proteggendo pi\u00f9 valore sulla classifica.",
    "Questa \u00e8 una battaglia di controllo dei danni, e {0} sta attualmente facendo quel lavoro meglio."
]
templates["bothUp"] = [
    "Entrambi gli asset stanno salendo, ma {0} sta accelerando di pi\u00f9 e sta trasformando la crescita in pressione.",
    "Questa \u00e8 una classifica aggressiva con entrambi i lati in verde, e {0} sta ancora trovando pi\u00f9 slancio.",
    "L'arena ha un rialzo su entrambi i lati in questo momento, eppure {0} ne sta estraendo di pi\u00f9.",
    "Entrambi i grafici sono positivi, ma {0} sta spingendo la linea di espansione migliore.",
    "Questa battaglia in diretta ha forza su entrambe le estremit\u00e0, e {0} sta attualmente convertendo pi\u00f9 di essa.",
    "La classifica \u00e8 verde in tutta la sfida, con {0} che prende ancora la rotta pi\u00f9 forte verso l'alto.",
    "\u00c8 un duello di mercato in rialzo, e {0} sta vincendo la gara di accelerazione per ora.",
    "Entrambi i lati stanno salendo, ma {0} sta guidando la scalata pi\u00f9 netta."
]
templates["relativeLead"] = [
    "Anche con pressione su entrambi i lati, {0} sta gestendo meglio il mercato e resta in testa.",
    "{0} non ha bisogno di un rally pulito qui; resistere meglio \u00e8 sufficiente per mantenere il vantaggio.",
    "Questa arena si sta vincendo per performance relativa in questo momento, e {0} \u00e8 il migliore sopravvissuto.",
    "{0} sta facendo sembrare la resilienza come controllo su questa classifica.",
    "Il mercato non offre condizioni facili, ma {0} sta ancora difendendo il vantaggio con un migliore equilibrio.",
    "La forza relativa sta portando questa partita, e {0} attualmente possiede quel vantaggio.",
    "{0} non sta staccandosi; sta semplicemente resistendo meglio di {1}.",
    "Il vantaggio appartiene a {0}, che sta trasformando una resistenza pi\u00f9 costante in pressione sulla classifica."
]
templates["goalRecent"] = [
    "{0} ha appena colpito la classifica e iniettato energia fresca nell'arena.",
    "Un nuovo punto arriva per {0}, e l'intero tono di questo broadcast cambia immediatamente.",
    "{0} converte l'ultimo swing in impatto sulla classifica, costringendo {1} a rispondere.",
    "Quel punto cambia la texture in diretta della partita, e {0} ora ha il polso.",
    "{0} ha appena fatto reagire l'arena con un colpo pulito sulla classifica.",
    "La classifica si muove di nuovo, e {0} \u00e8 il lato che celebra l'ultimo impatto.",
    "{0} incassa il momento con un punto che alza la pressione su {1}.",
    "Danno fresco sulla classifica per {0}, e l'arena diventa pi\u00f9 rumorosa attorno a questa partita."
]
templates["cycleEnding"] = [
    "Questa arena sta avvicinandosi al suo ciclo di chiusura, e la forma attuale della classifica sta diventando finale.",
    "La partita sta rallentando, con la narrativa in diretta che inizia a stabilizzarsi attorno a {0}.",
    "L'arena sta chiudendo la sua ultima finestra ora, e ogni segnale rimanente porta peso aggiuntivo.",
    "Questo ciclo si sta avvicinando alla fine, il che rende il vantaggio attuale ancora pi\u00f9 significativo.",
    "La classifica sta transitando verso la sua fine, con poco tempo rimasto per riscrivere lo script.",
    "Il ciclo in diretta \u00e8 quasi chiuso, e l'arena si sta preparando per la prossima transizione.",
    "Questa partita sta raggiungendo il suo ultimo respiro, con la classifica che ora fa la maggior parte del parlare.",
    "La fine del ciclo \u00e8 in vista, e l'attuale mappa della pressione \u00e8 quasi bloccata."
]

if "tv" in it and "commentary" in it["tv"]:
    it["tv"]["commentary"]["templates"] = templates

# Fix top-level title
it["title"] = "Match market"

# Fix statsMatches - these were defined in translate_all.py inline but paths didn't match
# because they were added via T.update() which uses the add() function from each part
# The issue is that translate_all.py added them to T dict but the lookup uses dotted paths
# Let me directly fix the it object

# Fix statsTeams.momentum
if "statsTeams" in it and "momentum" in it["statsTeams"]:
    it["statsTeams"]["momentum"]["struggling"] = "In difficolt\u00e0"
    it["statsTeams"]["momentum"]["volatile"] = "Volatile"

# Fix statsTeamDetail.momentum
if "statsTeamDetail" in it and "momentum" in it["statsTeamDetail"]:
    it["statsTeamDetail"]["momentum"]["volatile"] = "Volatile"

# Many "untranslated" strings are actually brand names or technical terms that SHOULD stay in English
# These include: CriptoVersus Arena, Trading Arena, Home, Token, Dashboard, LIVE, Momentum, etc.
# Let's verify and leave them as-is

with open(path, "w", encoding="utf-8") as f:
    json.dump(it, f, ensure_ascii=False, indent=2)

print("Fix applied successfully")