// Insercao pontual de `social.priceCrossover` no objeto `social` RAIZ de cada i18n.<cultura>.json.
// A insercao e TEXTUAL (offset), para preservar integralmente a formatacao existente do arquivo.
import { readFileSync, writeFileSync } from "node:fs";

const translations = {
    "en-US": {
        "seo.title": "Price Battle — Historical Match | CriptoVersus",
        "seo.titleWithMatch": "Price Battle: {0} vs {1} | CriptoVersus",
        "seo.description": "Historical Price Battle chart built from the official match record. Relative performance of both assets, crossover markers and the official result.",
        "hero.utcNote": "Historical match",
        "chart.title": "Price Battle",
        "chart.versus": "VS",
        "chart.ariaLabel": "Normalized relative-performance curves for both assets with crossover markers",
        "chart.empty": "Not enough historical data to rebuild the chart.",
        "summary.ariaLabel": "Official result and comparative statistics",
        "summary.officialScore": "Official score",
        "summary.officialWinner": "Official winner",
        "summary.draw": "Draw",
        "metrics.ariaLabel": "Comparative metrics",
        "metrics.performanceDifference": "Performance gap",
        "metrics.relevantCrossovers": "Relevant crossovers",
        "metrics.chartRoundPoints": "Chart points (visual)",
        "metrics.comeback": "Comeback",
        "metrics.comebackValue": "Yes",
        "states.loadingTitle": "Loading the Price Battle record",
        "states.loadingBody": "Fetching the historical series and the official result for this match.",
        "states.errorTitle": "Price Battle temporarily unavailable",
        "states.errorBody": "The historical record for this match could not be loaded right now.",
        "states.notFoundBody": "Match not found.",
        "states.notPublishableTitle": "Not publishable",
        "states.notPublishableGeneric": "This match cannot be published with the current data.",
        "states.notPublishableNotFinished": "The match is not officially finished yet.",
        "states.notPublishableAlreadyPublished": "This match has already been published.",
        "states.notPublishableReserved": "This match is reserved by another publication.",
        "states.notPublishableReconciliation": "A previous publication has an unknown outcome and must be reconciled first.",
        "states.notPublishableDataQuality": "The historical data is not reliable enough to publish.",
        "states.notPublishableNoChart": "The chart cannot be rebuilt from the stored history.",
        "states.notPublishableNoBaseline": "The reference price for normalization is missing.",
        "footer.disclaimer": "Historical match record. Not financial advice."
    },
    "pt-BR": {
        "seo.title": "Price Battle — Partida histórica | CriptoVersus",
        "seo.titleWithMatch": "Price Battle: {0} vs {1} | CriptoVersus",
        "seo.description": "Gráfico histórico do Price Battle construído a partir do registro oficial da partida. Desempenho relativo dos dois ativos, marcadores de cruzamento e resultado oficial.",
        "hero.utcNote": "Partida histórica",
        "chart.title": "Price Battle",
        "chart.versus": "VS",
        "chart.ariaLabel": "Curvas normalizadas de desempenho relativo dos dois ativos com marcadores de cruzamento",
        "chart.empty": "Dados históricos insuficientes para reconstruir o gráfico.",
        "summary.ariaLabel": "Resultado oficial e estatísticas comparativas",
        "summary.officialScore": "Placar oficial",
        "summary.officialWinner": "Vencedor oficial",
        "summary.draw": "Empate",
        "metrics.ariaLabel": "Métricas comparativas",
        "metrics.performanceDifference": "Diferença de desempenho",
        "metrics.relevantCrossovers": "Cruzamentos relevantes",
        "metrics.chartRoundPoints": "Pontos do gráfico (visual)",
        "metrics.comeback": "Reviravolta",
        "metrics.comebackValue": "Sim",
        "states.loadingTitle": "Carregando o registro do Price Battle",
        "states.loadingBody": "Buscando a série histórica e o resultado oficial desta partida.",
        "states.errorTitle": "Price Battle temporariamente indisponível",
        "states.errorBody": "Não foi possível carregar o registro histórico desta partida agora.",
        "states.notFoundBody": "Partida não encontrada.",
        "states.notPublishableTitle": "Não publicável",
        "states.notPublishableGeneric": "Esta partida não pode ser publicada com os dados atuais.",
        "states.notPublishableNotFinished": "A partida ainda não está oficialmente encerrada.",
        "states.notPublishableAlreadyPublished": "Esta partida já foi publicada.",
        "states.notPublishableReserved": "Esta partida está reservada por outra publicação.",
        "states.notPublishableReconciliation": "Uma publicação anterior tem resultado desconhecido e precisa ser reconciliada primeiro.",
        "states.notPublishableDataQuality": "Os dados históricos não são confiáveis o suficiente para publicar.",
        "states.notPublishableNoChart": "O gráfico não pode ser reconstruído a partir do histórico armazenado.",
        "states.notPublishableNoBaseline": "O preço de referência para a normalização está ausente.",
        "footer.disclaimer": "Registro histórico da partida. Não constitui recomendação financeira."
    },
    "zh-CN": {
        "seo.title": "Price Battle — 历史比赛 | CriptoVersus",
        "seo.titleWithMatch": "Price Battle: {0} vs {1} | CriptoVersus",
        "seo.description": "基于官方比赛记录构建的历史 Price Battle 图表。两种资产的相对表现、交叉标记和官方结果。",
        "hero.utcNote": "历史比赛",
        "chart.title": "Price Battle",
        "chart.versus": "VS",
        "chart.ariaLabel": "两种资产的归一化相对表现曲线及交叉标记",
        "chart.empty": "历史数据不足，无法重建图表。",
        "summary.ariaLabel": "官方结果与对比统计",
        "summary.officialScore": "官方比分",
        "summary.officialWinner": "官方获胜者",
        "summary.draw": "平局",
        "metrics.ariaLabel": "对比指标",
        "metrics.performanceDifference": "表现差距",
        "metrics.relevantCrossovers": "有效交叉次数",
        "metrics.chartRoundPoints": "图表得分（视觉）",
        "metrics.comeback": "逆转",
        "metrics.comebackValue": "是",
        "states.loadingTitle": "正在加载 Price Battle 记录",
        "states.loadingBody": "正在获取该场比赛的历史序列和官方结果。",
        "states.errorTitle": "Price Battle 暂时不可用",
        "states.errorBody": "暂时无法加载该场比赛的历史记录。",
        "states.notFoundBody": "未找到比赛。",
        "states.notPublishableTitle": "不可发布",
        "states.notPublishableGeneric": "当前数据下无法发布此场比赛。",
        "states.notPublishableNotFinished": "比赛尚未正式结束。",
        "states.notPublishableAlreadyPublished": "此场比赛已发布。",
        "states.notPublishableReserved": "此场比赛已被其他发布占用。",
        "states.notPublishableReconciliation": "此前的发布结果未知，需要先进行核对。",
        "states.notPublishableDataQuality": "历史数据不足以可靠发布。",
        "states.notPublishableNoChart": "无法根据存储的历史数据重建图表。",
        "states.notPublishableNoBaseline": "缺少归一化的参考价格。",
        "footer.disclaimer": "比赛历史记录。不构成投资建议。"
    },
    "es-ES": {
        "seo.title": "Price Battle — Partida histórica | CriptoVersus",
        "seo.titleWithMatch": "Price Battle: {0} vs {1} | CriptoVersus",
        "seo.description": "Gráfico histórico del Price Battle construido a partir del registro oficial de la partida. Rendimiento relativo de ambos activos, marcadores de cruce y resultado oficial.",
        "hero.utcNote": "Partida histórica",
        "chart.title": "Price Battle",
        "chart.versus": "VS",
        "chart.ariaLabel": "Curvas normalizadas de rendimiento relativo de ambos activos con marcadores de cruce",
        "chart.empty": "Datos históricos insuficientes para reconstruir el gráfico.",
        "summary.ariaLabel": "Resultado oficial y estadísticas comparativas",
        "summary.officialScore": "Marcador oficial",
        "summary.officialWinner": "Ganador oficial",
        "summary.draw": "Empate",
        "metrics.ariaLabel": "Métricas comparativas",
        "metrics.performanceDifference": "Diferencia de rendimiento",
        "metrics.relevantCrossovers": "Cruces relevantes",
        "metrics.chartRoundPoints": "Puntos del gráfico (visual)",
        "metrics.comeback": "Remontada",
        "metrics.comebackValue": "Sí",
        "states.loadingTitle": "Cargando el registro del Price Battle",
        "states.loadingBody": "Obteniendo la serie histórica y el resultado oficial de esta partida.",
        "states.errorTitle": "Price Battle no disponible temporalmente",
        "states.errorBody": "No se pudo cargar el registro histórico de esta partida ahora.",
        "states.notFoundBody": "Partida no encontrada.",
        "states.notPublishableTitle": "No publicable",
        "states.notPublishableGeneric": "Esta partida no se puede publicar con los datos actuales.",
        "states.notPublishableNotFinished": "La partida aún no ha terminado oficialmente.",
        "states.notPublishableAlreadyPublished": "Esta partida ya ha sido publicada.",
        "states.notPublishableReserved": "Esta partida está reservada por otra publicación.",
        "states.notPublishableReconciliation": "Una publicación anterior tiene un resultado desconocido y debe reconciliarse primero.",
        "states.notPublishableDataQuality": "Los datos históricos no son lo suficientemente fiables para publicar.",
        "states.notPublishableNoChart": "El gráfico no se puede reconstruir a partir del historial almacenado.",
        "states.notPublishableNoBaseline": "Falta el precio de referencia para la normalización.",
        "footer.disclaimer": "Registro histórico de la partida. No constituye asesoramiento financiero."
    },
    "fr-FR": {
        "seo.title": "Price Battle — Match historique | CriptoVersus",
        "seo.titleWithMatch": "Price Battle : {0} vs {1} | CriptoVersus",
        "seo.description": "Graphique historique du Price Battle construit à partir du registre officiel du match. Performance relative des deux actifs, marqueurs de croisement et résultat officiel.",
        "hero.utcNote": "Match historique",
        "chart.title": "Price Battle",
        "chart.versus": "VS",
        "chart.ariaLabel": "Courbes normalisées de performance relative des deux actifs avec marqueurs de croisement",
        "chart.empty": "Données historiques insuffisantes pour reconstruire le graphique.",
        "summary.ariaLabel": "Résultat officiel et statistiques comparatives",
        "summary.officialScore": "Score officiel",
        "summary.officialWinner": "Vainqueur officiel",
        "summary.draw": "Égalité",
        "metrics.ariaLabel": "Métriques comparatives",
        "metrics.performanceDifference": "Écart de performance",
        "metrics.relevantCrossovers": "Croisements pertinents",
        "metrics.chartRoundPoints": "Points du graphique (visuel)",
        "metrics.comeback": "Retournement",
        "metrics.comebackValue": "Oui",
        "states.loadingTitle": "Chargement du registre du Price Battle",
        "states.loadingBody": "Récupération de la série historique et du résultat officiel de ce match.",
        "states.errorTitle": "Price Battle temporairement indisponible",
        "states.errorBody": "Impossible de charger l'historique de ce match pour le moment.",
        "states.notFoundBody": "Match introuvable.",
        "states.notPublishableTitle": "Non publiable",
        "states.notPublishableGeneric": "Ce match ne peut pas être publié avec les données actuelles.",
        "states.notPublishableNotFinished": "Le match n'est pas encore officiellement terminé.",
        "states.notPublishableAlreadyPublished": "Ce match a déjà été publié.",
        "states.notPublishableReserved": "Ce match est réservé par une autre publication.",
        "states.notPublishableReconciliation": "Une publication précédente a un résultat inconnu et doit d'abord être réconciliée.",
        "states.notPublishableDataQuality": "Les données historiques ne sont pas assez fiables pour publier.",
        "states.notPublishableNoChart": "Le graphique ne peut pas être reconstruit à partir de l'historique stocké.",
        "states.notPublishableNoBaseline": "Le prix de référence pour la normalisation est absent.",
        "footer.disclaimer": "Registre historique du match. Ne constitue pas un conseil financier."
    },
    "de-DE": {
        "seo.title": "Price Battle — Historischer Match | CriptoVersus",
        "seo.titleWithMatch": "Price Battle: {0} vs {1} | CriptoVersus",
        "seo.description": "Historisches Price-Battle-Diagramm aus dem offiziellen Matchprotokoll. Relative Entwicklung beider Assets, Kreuzungsmarker und offizielles Ergebnis.",
        "hero.utcNote": "Historischer Match",
        "chart.title": "Price Battle",
        "chart.versus": "VS",
        "chart.ariaLabel": "Normalisierte Kurven der relativen Entwicklung beider Assets mit Kreuzungsmarkern",
        "chart.empty": "Nicht genügend historische Daten, um das Diagramm nachzubilden.",
        "summary.ariaLabel": "Offizielles Ergebnis und Vergleichsstatistiken",
        "summary.officialScore": "Offizieller Spielstand",
        "summary.officialWinner": "Offizieller Sieger",
        "summary.draw": "Unentschieden",
        "metrics.ariaLabel": "Vergleichsmetriken",
        "metrics.performanceDifference": "Entwicklungsabweichung",
        "metrics.relevantCrossovers": "Relevante Kreuzungen",
        "metrics.chartRoundPoints": "Diagrammpunkte (visuell)",
        "metrics.comeback": "Kehrtwende",
        "metrics.comebackValue": "Ja",
        "states.loadingTitle": "Price-Battle-Protokoll wird geladen",
        "states.loadingBody": "Historische Reihe und offizielles Ergebnis dieses Matches werden abgerufen.",
        "states.errorTitle": "Price Battle vorübergehend nicht verfügbar",
        "states.errorBody": "Das historische Protokoll dieses Matches konnte gerade nicht geladen werden.",
        "states.notFoundBody": "Match nicht gefunden.",
        "states.notPublishableTitle": "Nicht veröffentlichenbar",
        "states.notPublishableGeneric": "Dieser Match kann mit den aktuellen Daten nicht veröffentlicht werden.",
        "states.notPublishableNotFinished": "Der Match ist noch nicht offiziell beendet.",
        "states.notPublishableAlreadyPublished": "Dieser Match wurde bereits veröffentlicht.",
        "states.notPublishableReserved": "Dieser Match ist für eine andere Veröffentlichung reserviert.",
        "states.notPublishableReconciliation": "Eine frühere Veröffentlichung hat ein unbekanntes Ergebnis und muss zuerst abgeglichen werden.",
        "states.notPublishableDataQuality": "Die historischen Daten sind nicht zuverlässig genug für eine Veröffentlichung.",
        "states.notPublishableNoChart": "Das Diagramm kann aus dem gespeicherten Verlauf nicht nachgebildet werden.",
        "states.notPublishableNoBaseline": "Der Referenzpreis für die Normalisierung fehlt.",
        "footer.disclaimer": "Historisches Matchprotokoll. Keine Finanzberatung."
    },
    "it-IT": {
        "seo.title": "Price Battle — Partita storica | CriptoVersus",
        "seo.titleWithMatch": "Price Battle: {0} vs {1} | CriptoVersus",
        "seo.description": "Grafico storico del Price Battle costruito dal registro ufficiale della partita. Performance relativa dei due asset, marcatori di incrocio e risultato ufficiale.",
        "hero.utcNote": "Partita storica",
        "chart.title": "Price Battle",
        "chart.versus": "VS",
        "chart.ariaLabel": "Curve normalizzate della performance relativa dei due asset con marcatori di incrocio",
        "chart.empty": "Dati storici insufficienti per ricostruire il grafico.",
        "summary.ariaLabel": "Risultato ufficiale e statistiche comparative",
        "summary.officialScore": "Punteggio ufficiale",
        "summary.officialWinner": "Vincitore ufficiale",
        "summary.draw": "Pareggio",
        "metrics.ariaLabel": "Metriche comparative",
        "metrics.performanceDifference": "Differenza di performance",
        "metrics.relevantCrossovers": "Incroci rilevanti",
        "metrics.chartRoundPoints": "Punti del grafico (visivo)",
        "metrics.comeback": "Rimonta",
        "metrics.comebackValue": "Sì",
        "states.loadingTitle": "Caricamento del registro del Price Battle",
        "states.loadingBody": "Recupero della serie storica e del risultato ufficiale di questa partita.",
        "states.errorTitle": "Price Battle temporaneamente non disponibile",
        "states.errorBody": "Non è stato possibile caricare il registro storico di questa partita.",
        "states.notFoundBody": "Partita non trovata.",
        "states.notPublishableTitle": "Non pubblicabile",
        "states.notPublishableGeneric": "Questa partita non può essere pubblicata con i dati attuali.",
        "states.notPublishableNotFinished": "La partita non è ancora ufficialmente conclusa.",
        "states.notPublishableAlreadyPublished": "Questa partita è già stata pubblicata.",
        "states.notPublishableReserved": "Questa partita è riservata da un'altra pubblicazione.",
        "states.notPublishableReconciliation": "Una pubblicazione precedente ha un esito sconosciuto e deve prima essere riconciliata.",
        "states.notPublishableDataQuality": "I dati storici non sono sufficientemente affidabili per la pubblicazione.",
        "states.notPublishableNoChart": "Il grafico non può essere ricostruito dalla cronologia memorizzata.",
        "states.notPublishableNoBaseline": "Manca il prezzo di riferimento per la normalizzazione.",
        "footer.disclaimer": "Registro storico della partita. Non costituisce consulenza finanziaria."
    },
    "ja-JP": {
        "seo.title": "Price Battle — 過去の試合 | CriptoVersus",
        "seo.titleWithMatch": "Price Battle: {0} vs {1} | CriptoVersus",
        "seo.description": "公式の試合記録から作成した Price Battle の過去チャート。2つの資産の相対的な推移、クロスマーカー、公式結果を表示します。",
        "hero.utcNote": "過去の試合",
        "chart.title": "Price Battle",
        "chart.versus": "VS",
        "chart.ariaLabel": "クロスマーカー付きの2資産の正規化された相対推移カーブ",
        "chart.empty": "履歴データが不足しているためチャートを再構築できません。",
        "summary.ariaLabel": "公式結果と比較統計",
        "summary.officialScore": "公式スコア",
        "summary.officialWinner": "公式勝者",
        "summary.draw": "引き分け",
        "metrics.ariaLabel": "比較指標",
        "metrics.performanceDifference": "パフォーマンス差",
        "metrics.relevantCrossovers": "有意なクロス",
        "metrics.chartRoundPoints": "チャートポイント（視覚）",
        "metrics.comeback": "逆転",
        "metrics.comebackValue": "あり",
        "states.loadingTitle": "Price Battle の記録を読み込んでいます",
        "states.loadingBody": "この試合の履歴系列と公式結果を取得しています。",
        "states.errorTitle": "Price Battle は一時的に利用できません",
        "states.errorBody": "この試合の履歴記録を現在読み込めませんでした。",
        "states.notFoundBody": "試合が見つかりません。",
        "states.notPublishableTitle": "公開不可",
        "states.notPublishableGeneric": "現在のデータではこの試合を公開できません。",
        "states.notPublishableNotFinished": "試合はまだ公式に終了していません。",
        "states.notPublishableAlreadyPublished": "この試合はすでに公開されています。",
        "states.notPublishableReserved": "この試合は別の公開によって予約されています。",
        "states.notPublishableReconciliation": "以前の公開の結果が不明なため、先に照合が必要です。",
        "states.notPublishableDataQuality": "履歴データの信頼性が不足しているため公開できません。",
        "states.notPublishableNoChart": "保存された履歴からチャートを再構築できません。",
        "states.notPublishableNoBaseline": "正規化の基準価格がありません。",
        "footer.disclaimer": "試合の履歴記録です。投資助言ではありません。"
    }
};

function findRootSocialInsertOffset(source) {
    // Percorre o JSON para localizar o offset do valor do objeto "social" RAIZ.
    const rootEnd = findMatchingBrace(source, source.indexOf("{"));
    let i = 0;

    while (i < source.length) {
        const keyMatch = /"((?:[^"\\]|\\.)*)"\s*:/.exec(source.slice(i));
        if (!keyMatch) break;

        const key = JSON.parse(`"${keyMatch[1]}"`);
        const afterKey = i + keyMatch[0].length;
        const braceOrValue = source.slice(afterKey).match(/^\s*/)[0].length + afterKey;

        if (source[braceOrValue] === "{" && key === "social") {
            return { start: braceOrValue, isRoot: braceOrValue < rootEnd };
        }

        const next = skipValue(source, braceOrValue);
        if (next <= i) break;
        i = next;

        while (i < source.length && /[\s,]/.test(source[i])) i += 1;
    }

    return null;
}

function findMatchingBrace(source, openIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = openIndex; i < source.length; i += 1) {
        const ch = source[i];

        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') { inString = true; continue; }
        if (ch === "{") depth += 1;
        else if (ch === "}") {
            depth -= 1;
            if (depth === 0) return i;
        }
    }

    return source.length;
}

function skipValue(source, index) {
    let i = index;

    while (i < source.length && /\s/.test(source[i])) i += 1;

    if (source[i] === "{" || source[i] === "[") {
        const close = findMatchingBrace(source, i);
        return close + 1;
    }

    if (source[i] === '"') {
        let escaped = false;
        i += 1;
        while (i < source.length) {
            const ch = source[i];
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') return i + 1;
            i += 1;
        }
        return i;
    }

    while (i < source.length && !/[\s,}\]]/.test(source[i])) i += 1;
    return i;
}

function buildBlock(entries, indent) {
    // Chaves sao caminhos pontuados ("chart.title") e precisam virar aninhamento real:
    // LocalizationService.GetNode faz split por "." e nao resolve chaves planas.
    const root = {};
    for (const [path, value] of Object.entries(entries)) {
        const segments = path.split(".");
        let current = root;
        for (let i = 0; i < segments.length - 1; i += 1) {
            current[segments[i]] ??= {};
            current = current[segments[i]];
        }
        current[segments[segments.length - 1]] = value;
    }

    return serializeNode(root, indent);
}

function serializeNode(node, indent) {
    const pad = " ".repeat(indent);
    const padInner = " ".repeat(indent + 2);
    const lines = Object.entries(node).map(([key, value]) => {
        const rendered = (value !== null && typeof value === "object")
            ? serializeNode(value, indent + 2)
            : JSON.stringify(value);
        return `${padInner}${JSON.stringify(key)}: ${rendered}`;
    });

    return `{\n${lines.join(",\n")}\n${pad}}`;
}

for (const [culture, entries] of Object.entries(translations)) {
    const path = new URL(`../i18n.${culture}.json`, import.meta.url);
    const source = readFileSync(path, "utf8");

    if (source.includes('"priceCrossover"')) {
        console.log(`${culture}: ja contem priceCrossover, ignorado.`);
        continue;
    }

    const located = findRootSocialInsertOffset(source);
    if (!located || !located.isRoot) {
        throw new Error(`${culture}: nao foi possivel localizar o objeto "social" RAIZ.`);
    }

    // Inserimos logo apos a chave de abertura do objeto social raiz.
    const openBrace = located.start;
    let insertAt = openBrace + 1;

    // Recuo do primeiro campo existente (normalmente 4 espacos).
    const lineStart = source.lastIndexOf("\n", openBrace) + 1;
    const fieldIndent = (source.slice(lineStart).match(/^\s*/)[0].length) + 2;
    const block = buildBlock(entries, fieldIndent);

    const nextCharIndex = source.slice(insertAt).search(/\S/);
    const needsLeadingComma = nextCharIndex >= 0 && source[insertAt + nextCharIndex] !== "}";

    const insertion = `\n${" ".repeat(fieldIndent)}"priceCrossover": ${block}${needsLeadingComma ? "," : ""}`;
    const updated = source.slice(0, insertAt) + insertion + source.slice(insertAt);

    writeFileSync(path, updated, "utf8");
    console.log(`${culture}: priceCrossover inserido (${Object.keys(entries).length} chaves).`);
}
