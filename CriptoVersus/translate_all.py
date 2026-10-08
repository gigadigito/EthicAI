#!/usr/bin/env python3
"""Generate complete Italian (it-IT) translation for CriptoVersus."""
import json, os, sys

base = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, base)

en_path = os.path.join(base, "i18n.en-US.json")
out_path = os.path.join(base, "i18n.it-IT.json")

with open(en_path, "r", encoding="utf-8") as f:
    en = json.load(f)

# Import all translation parts
from translate_part1 import T as T1
from translate_part2 import T2
from translate_part3 import T3
from translate_part4 import T4
from translate_part5 import T5
from translate_part6 import T6

# Merge all translations
T = {}
T.update(T1)
T.update(T2)
T.update(T3)
T.update(T4)
T.update(T5)
T.update(T6)

# Add remaining translations that weren't in parts
def add(p, d):
    for k, v in d.items():
        T[f"{p}.{k}"] = v

# statsMatches
add("statsMatches.seo", {"title":"CriptoVersus Statistiche Partite","description":"Sfoglia le partite crypto pubbliche, filtra per stato e revisiona i risultati degli asset nell'arena."})
add("statsMatches.hero", {"eyebrow":"Hub pubblico delle partite","title":"Statistiche Partite","subtitle":"Cerca battaglie pubbliche, ispeziona le classifiche recenti e confronta i risultati per asset.","backToStats":"Torna alle statistiche","openTeams":"Apri squadre"})
add("statsMatches.filters", {"searchLabel":"Cerca per coin o squadra","searchPlaceholder":"BTC, ETH, STRAX, TON...","statusLabel":"Stato"})
add("statsMatches.filters.status", {"all":"Tutte","ongoing":"In diretta","completed":"Finita","pending":"In attesa","cancelled":"Annullata"})
add("statsMatches.states", {"loadingTitle":"Caricamento partite pubbliche","loadingBody":"Raccolta delle classifiche pubbliche e della cronologia recente delle battaglie.","errorTitle":"Partite temporaneamente non disponibili","errorBody":"Non \u00e8 stato possibile caricare l'archivio pubblico delle partite in questo momento.","emptyTitle":"Nessuna partita trovata","emptyBody":"Prova un altro asset, squadra o filtro di stato."})
add("statsMatches.summary", {"totalMatches":"Partite totali","completed":"Finita","live":"In diretta","assets":"Asset tracciati"})
add("statsMatches.matches", {"eyebrow":"Archivio recente","title":"Ultime partite pubbliche","description":"Apri qualsiasi pagina partita e revisiona le classifiche pubbliche pi\u00f9 recenti.","openMatch":"Apri partita"})
add("statsMatches.matches.columns", {"match":"Partita","score":"Punteggio","status":"Stato","date":"Data","link":"Link"})
add("statsMatches.teams", {"eyebrow":"Performance degli asset","title":"Vittorie, sconfitte e pareggi per asset","description":"Riepiloghi pubblici degli asset derivati dall'insieme attuale di partite filtrate."})
add("statsMatches.teams.columns", {"asset":"Asset","matches":"Partite","wins":"Vittorie","draws":"Pareggi","losses":"Sconfitte","goals":"Goal","winRate":"Tasso di Vittoria"})
add("statsMatches.status", {"completed":"Finita","ongoing":"In diretta","pending":"In attesa","cancelled":"Annullata","unknown":"Sconosciuto"})

# statsRankings
add("statsRankings.seo", {"title":"CriptoVersus Classifiche","description":"Confronta le classifiche pubbliche per vittorie, efficienza, goal e serie imbattute."})
add("statsRankings.hero", {"eyebrow":"Hub pubblico delle classifiche","title":"Statistiche Classifiche","subtitle":"Tabelle classifiche pubbliche multi-metrica per l'arena CriptoVersus.","backToStats":"Torna alle statistiche","openMatches":"Apri partite"})
add("statsRankings.filters", {"searchLabel":"Cerca per asset","searchPlaceholder":"BTC, ETH, STRAX, TON..."})
add("statsRankings.states", {"loadingTitle":"Caricamento classifiche pubbliche","loadingBody":"Calcolo delle tabelle classifiche dai dati pubblici pi\u00f9 recenti delle partite.","errorTitle":"Classifiche temporaneamente non disponibili","errorBody":"Non \u00e8 stato possibile caricare le tabelle classifiche pubbliche in questo momento.","emptyTitle":"Nessuna classifica disponibile ancora","emptyBody":"L'arena ha ancora bisogno di pi\u00f9 partite pubbliche completate per classificare gli asset qui."})
add("statsRankings.summary", {"assets":"Asset classificati","topWins":"Pi\u00f9 vittorie","topEfficiency":"Migliore efficienza","topStreak":"Migliore serie imbattuta"})
add("statsRankings.boards.columns", {"rank":"Posizione","asset":"Asset","matches":"Partite","winRate":"Tasso di Vittoria"})
add("statsRankings.boards.wins", {"eyebrow":"Classifica vittorie","title":"Classifica per vittorie","description":"Asset ordinati per vittorie totali nelle partite pubbliche completate.","metric":"Vittorie"})
add("statsRankings.boards.efficiency", {"eyebrow":"Classifica efficienza","title":"Classifica per efficienza","description":"Tasso di efficienza a tre punti nelle battaglie pubbliche completate.","metric":"Efficienza"})
add("statsRankings.boards.goals", {"eyebrow":"Classifica attacco","title":"Classifica per goal","description":"Asset con il pi\u00f9 alto output di punteggio pubblico.","metric":"Goal"})
add("statsRankings.boards.streak", {"eyebrow":"Classifica Momentum","title":"Classifica per serie imbattuta","description":"Serie imbattute attuali basate sulla cronologia pi\u00f9 recente delle partite completate.","metric":"Serie"})

# statsRecords
add("statsRecords.seo", {"title":"CriptoVersus Record","description":"Rivedi i pi\u00f9 grandi record pubblici, vittorie schiaccianti e partite storiche eccezionali nell'arena."})
add("statsRecords.hero", {"eyebrow":"Hub pubblico dei record","title":"Statistiche Record","subtitle":"Milestone pubbliche e classifiche storiche dall'arena CriptoVersus.","backToStats":"Torna alle statistiche","openRankings":"Apri classifiche"})
add("statsRecords.states", {"loadingTitle":"Caricamento record pubblici","loadingBody":"Scansione delle partite pubbliche completate alla ricerca di record eccezionali e milestone.","errorTitle":"Record temporaneamente non disponibili","errorBody":"Non \u00e8 stato possibile caricare la tabella dei record pubblici in questo momento.","emptyTitle":"Nessun record disponibile ancora","emptyBody":"L'arena ha ancora bisogno di pi\u00f9 partite pubbliche completate prima che i record possano essere evidenziati."})
add("statsRecords.summary", {"longestWinStreak":"Serie di vittorie pi\u00f9 lunga","biggestBlowout":"Vittoria pi\u00f9 schiacciante","mostGoals":"Pi\u00f9 goal in una partita","bestCampaign":"Migliore campagna"})
add("statsRecords.records", {"eyebrow":"Milestone","title":"Tabella record dell'arena","description":"Record calcolati temporaneamente dal frontend basati sui dati pubblici esistenti delle partite.","openMatch":"Apri partita"})
add("statsRecords.records.cards", {"longestWinStreak":"Serie di vittorie pi\u00f9 lunga","longestWinStreakDetail":"Migliori vittorie consecutive di un asset pubblico dell'arena.","biggestBlowout":"Vittoria pi\u00f9 schiacciante","biggestBlowoutDetail":"Maggior differenza goal registrata in una partita pubblica.","mostGoals":"Pi\u00f9 goal in una partita","mostGoalsDetail":"Punteggio combinato pi\u00f9 alto pubblicato su una classifica pubblica.","bestCampaign":"Migliore campagna","bestCampaignDetail":"Migliore tasso di efficienza tra gli asset con un campione pubblico significativo.","worstCampaign":"Peggiore campagna","worstCampaignDetail":"Tasso di efficienza pi\u00f9 basso tra gli asset pubblici indicizzati."})
add("statsRecords.history", {"eyebrow":"Partite storiche","title":"Partite storiche rilevanti","description":"Classifiche ad alto impatto che vale la pena rivedere dall'archivio pubblico.","openMatch":"Apri partita"})
add("statsRecords.history.columns", {"match":"Partita","score":"Punteggio","note":"Perch\u00e9 \u00e8 importante","link":"Link"})
add("statsRecords.history.notes", {"blowout":"Vittoria pi\u00f9 schiacciante pubblica registrata.","mostGoals":"Partita pubblica con pi\u00f9 punti finora.","closeClassic":"Battaglia serrata ad alto punteggio con energia classica.","highImpact":"Partita pubblica ad alto impatto dall'archivio storico."})

# statsTeams
add("statsTeams.seo", {"title":"Squadre Arena Crypto - CriptoVersus Classifiche","description":"Esplora le squadre pubbliche dell'arena crypto, le tendenze storiche delle performance, le classifiche e le statistiche delle battaglie nell'ecosistema CriptoVersus."})
add("statsTeams.hero", {"eyebrow":"Directory squadre dell'arena","title":"Squadre Arena Crypto","subtitle":"Esplora le performance pubbliche degli asset crypto nelle battaglie storiche dell'arena CriptoVersus.","seoCopy":"CriptoVersus trasforma gli asset crypto in squadre pubbliche dell'arena con classifiche storiche, performance relative, statistiche pubbliche e record di battaglie indicizzabili nell'ecosistema.","backToStats":"Torna alle statistiche","backToStatsAria":"Torna alla pagina statistiche di CriptoVersus","howArenaWorks":"Come funziona l'arena","howArenaWorksAria":"Leggi come funziona l'arena CriptoVersus","liveDirectory":"Directory in diretta","liveDirectoryHint":"squadre di asset pubbliche indicizzate","totalIndexedBattles":"Battaglie totali indicizzate","totalIndexedBattlesHint":"record pubblici delle partite completate","updatedStatus":"Stato arena in diretta","updatedStatusValue":"Statistiche squadre pubbliche","updatedStatusHint":"aggiornato con la pi\u00f9 recente cronologia pubblica"})
add("statsTeams.states", {"loadingTitle":"Caricamento squadre dell'arena","loadingBody":"Recupero della directory pubblica pi\u00f9 recente delle squadre e dei dati della classifica.","errorTitle":"Squadre temporaneamente non disponibili","errorBody":"Non \u00e8 stato possibile caricare le squadre pubbliche dell'arena in questo momento. Visualizzazione di una tabella vuota stabile.","emptyTitle":"Nessuna squadra pubblica ancora","emptyBody":"L'arena non ha indicizzato abbastanza battaglie pubbliche completate per costruire la directory delle squadre."})
T["statsTeams.summary.ariaLabel"] = "Riepilogo squadre dell'arena"
add("statsTeams.summary.totalAssets", {"label":"Asset Totali","hint":"squadre crypto pubbliche tracciate"})
add("statsTeams.summary.mostDominantAsset", {"label":"Asset Pi\u00f9 Dominante","hint":"attuale leader in prima posizione dell'arena"})
add("statsTeams.summary.highestWinRate", {"label":"Tasso di Vittoria Pi\u00f9 Alto","hint":"migliore percentuale di chiusura pubblica"})
add("statsTeams.summary.mostActiveTeam", {"label":"Squadra Pi\u00f9 Attiva","hint":"pi\u00f9 ampio campione pubblico di partite"})
add("statsTeams.summary.totalBattlesIndexed", {"label":"Battaglie Totali Indicizzate","hint":"battaglie pubbliche completate dell'arena"})
add("statsTeams.search", {"eyebrow":"Cerca nella directory","title":"Trova una squadra crypto","description":"Filtra istantaneamente la tabella pubblica dell'arena per simbolo o nome dell'asset.","label":"Cerca squadre crypto","placeholder":"Cerca squadre crypto...","ariaLabel":"Cerca squadre crypto","noResultsTitle":"Nessuna squadra corrispondente","noResultsBody":"Prova un simbolo diverso o un termine di ricerca pi\u00f9 ampio."})
add("statsTeams.grid", {"eyebrow":"Tabella competitiva","title":"Directory squadre dell'arena","description":"Schede pubbliche premium per le squadre crypto pi\u00f9 forti basate sulle performance storiche delle battaglie CriptoVersus.","rankValue":"Posizione Arena #{0}","viewTeam":"Vedi Squadra","viewTeamAria":"Apri la pagina squadra futura per {0}"})
add("statsTeams.grid.metrics", {"winRate":"Tasso di Vittoria","matches":"Partite","goals":"Goal","averageScore":"Punteggio Medio"})
add("statsTeams.grid.details", {"wins":"Vittorie","losses":"Sconfitte","totalScore":"Punteggio Totale","momentum":"Momentum"})
add("statsTeams.table", {"eyebrow":"Tabella classifica HTML","title":"Top Squadre dell'Arena","description":"Tabella classifica indicizzabile per le squadre pubbliche dell'arena crypto, le tendenze storiche delle performance e le statistiche delle battaglie.","empty":"Nessuna squadra dell'arena disponibile ancora.","assetAria":"Apri la pagina squadra futura per {0}"})
add("statsTeams.table.columns", {"rank":"Posizione","asset":"Asset","matches":"Partite","wins":"Vittorie","losses":"Sconfitte","winRate":"Tasso di Vittoria","averageScore":"Punteggio Medio","totalScore":"Punteggio Totale","momentum":"Momentum"})
add("statsTeams.rivalries", {"eyebrow":"Trame dell'arena","title":"Top Rivalit\u00e0","description":"Accoppiamenti competitivi in evidenza costruiti dalle squadre pi\u00f9 forti dell'arena pubblica.","emptyTitle":"Nessuna rivalit\u00e0 ancora","emptyBody":"Le rivalit\u00e0 appariranno qui una volta che la tabella pubblica delle squadre avr\u00e0 abbastanza dati.","teamAria":"Apri la pagina squadra per {0}"})
add("statsTeams.momentum", {"dominant":"Dominante","hot":"Caldo","rising":"In crescita","aggressive":"Aggressivo","veteran":"Veterano","struggling":"In difficolt\u00e0","volatile":"Volatile"})
add("statsTeams.structuredData", {"breadcrumbStats":"Statistiche","breadcrumbTeams":"Squadre"})

print(f"Total translations loaded: {len(T)}")

# Recursively translate
def translate(obj, path=""):
    if isinstance(obj, dict):
        return {k: translate(v, f"{path}.{k}" if path else k) for k, v in obj.items()}
    if isinstance(obj, list):
        return [translate(item, f"{path}[{i}]") for i, item in enumerate(obj)]
    if isinstance(obj, str):
        return T.get(path, obj)
    return obj

result = translate(en)

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

# Verify key count
def count_keys(obj, prefix=""):
    count = 0
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else k
            count += count_keys(v, p)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            count += count_keys(item, f"{prefix}[{i}]")
    elif isinstance(obj, str):
        count = 1
    return count

total = count_keys(result)
print(f"Total string values in output: {total}")

# Count untranslated (still English)
untranslated = 0
def check_untranslated(en_obj, it_obj, path=""):
    global untranslated
    if isinstance(en_obj, dict) and isinstance(it_obj, dict):
        for k in en_obj:
            if k in it_obj:
                check_untranslated(en_obj[k], it_obj[k], f"{path}.{k}" if path else k)
    elif isinstance(en_obj, list) and isinstance(it_obj, list):
        for i in range(min(len(en_obj), len(it_obj))):
            check_untranslated(en_obj[i], it_obj[i], f"{path}[{i}]")
    elif isinstance(en_obj, str) and isinstance(it_obj, str):
        if en_obj == it_obj and len(en_obj) > 3:
            untranslated += 1

check_untranslated(en, result)
print(f"Untranslated strings (same as English, >3 chars): {untranslated}")
print(f"Written to {out_path}")