import assert from "node:assert/strict";

import {
    detectPreferredCulture,
    matchSupportedCulture,
    readPersistedCulture,
    setPreferredCulture,
    syncPreferredCulture
} from "./culturePreference.mjs";

const supportedLanguages = [
    { route: "en", culture: "en-US", aliases: ["en-us"] },
    { route: "pt", culture: "pt-BR", aliases: ["pt-br"] },
    { route: "zh", culture: "zh-CN", aliases: ["zh-cn", "zh-hans", "zh-hans-cn"] },
    { route: "es", culture: "es-ES", aliases: ["es-es"] },
    { route: "fr", culture: "fr-FR", aliases: ["fr-fr"] },
    { route: "de", culture: "de-DE", aliases: ["de-de"] },
    { route: "it", culture: "it-IT", aliases: ["it-it"] },
    { route: "ja", culture: "ja-JP", aliases: ["ja-jp"] }
];

function testMatchesBrowserLanguagesInOrder() {
    assert.equal(matchSupportedCulture(["pt-BR", "en-US"], supportedLanguages), "pt");
    assert.equal(matchSupportedCulture(["en-US", "pt-BR"], supportedLanguages), "en");
    assert.equal(matchSupportedCulture(["de-DE", "pt-BR"], supportedLanguages), "de");
    assert.equal(matchSupportedCulture(["fr-FR"], supportedLanguages), "fr");
    assert.equal(matchSupportedCulture(["it-IT"], supportedLanguages), "it");
    assert.equal(matchSupportedCulture(["ja-JP"], supportedLanguages), "ja");
}

function testMatchesBaseOnlyLanguages() {
    assert.equal(matchSupportedCulture(["pt"], supportedLanguages), "pt");
    assert.equal(matchSupportedCulture(["es"], supportedLanguages), "es");
    assert.equal(matchSupportedCulture(["fr"], supportedLanguages), "fr");
    assert.equal(matchSupportedCulture(["de"], supportedLanguages), "de");
}

function testRegionalVariantsFallBackToSupportedLanguage() {
    assert.equal(matchSupportedCulture(["pt-PT"], supportedLanguages), "pt");
    assert.equal(matchSupportedCulture(["es-MX"], supportedLanguages), "es");
    assert.equal(matchSupportedCulture(["de-AT"], supportedLanguages), "de");
    assert.equal(matchSupportedCulture(["zh-TW"], supportedLanguages), "zh");
}

function testUnknownLanguagesReturnNull() {
    assert.equal(matchSupportedCulture(["xx-YY", "zz"], supportedLanguages), null);
    assert.equal(matchSupportedCulture([], supportedLanguages), null);
    assert.equal(matchSupportedCulture(null, supportedLanguages), null);
}

function testFirstSupportedLanguageIsNotAssumedToBeTheDefault() {
    const reversed = [...supportedLanguages].reverse();
    assert.equal(matchSupportedCulture(["xx"], reversed), null);
    assert.equal(matchSupportedCulture(["pt-BR"], reversed), "pt");
}

function withBrowserStorage(storedValue, cookieValue, callback) {
    const storage = new Map();
    if (storedValue) {
        storage.set("cv_culture", storedValue);
    }

    const originalLocalStorage = globalThis.localStorage;
    const originalDocument = globalThis.document;
    const originalNavigator = globalThis.navigator;

    let cookie = cookieValue ? `cv_culture=${encodeURIComponent(cookieValue)}` : "";
    const cookies = [];

    globalThis.localStorage = {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value))
    };
    globalThis.document = {
        get cookie() {
            return cookie;
        },
        set cookie(value) {
            cookies.push(value);
            const pair = value.split(";")[0];
            const [name, ...rest] = pair.split("=");
            if (name.trim() === "cv_culture") {
                cookie = `cv_culture=${rest.join("=")}`;
            }
        }
    };

    try {
        callback({ storage, cookies });
    } finally {
        globalThis.localStorage = originalLocalStorage;
        globalThis.document = originalDocument;
        globalThis.navigator = originalNavigator;
    }
}

function testSyncPersistsDetectedBrowserLanguageOnFirstVisit() {
    withBrowserStorage(null, null, ({ storage }) => {
        globalThis.navigator = { languages: ["pt-BR", "en-US"], language: "pt-BR" };

        const result = syncPreferredCulture(supportedLanguages);

        assert.equal(result, "pt");
        assert.equal(storage.get("cv_culture"), "pt");
        assert.equal(storage.get("cv_culture_source"), "auto");
    });
}

function testSyncDoesNotOverwriteManualChoice() {
    withBrowserStorage("de", "de", ({ storage }) => {
        globalThis.navigator = { languages: ["pt-BR", "en-US"], language: "pt-BR" };

        const result = syncPreferredCulture(supportedLanguages);

        assert.equal(result, "de");
        assert.equal(storage.get("cv_culture"), "de");
    });
}

function testManualChoiceSurvivesReload() {
    withBrowserStorage(null, null, ({ storage }) => {
        setPreferredCulture("ja");
        assert.equal(storage.get("cv_culture"), "ja");
        assert.equal(storage.get("cv_culture_source"), "manual");
        assert.equal(readPersistedCulture(), "ja");
    });
}

function testSyncMirrorsStoredPreferenceToCookie() {
    withBrowserStorage("pt", null, ({ storage }) => {
        globalThis.navigator = { languages: ["de-DE"], language: "de-DE" };

        const result = syncPreferredCulture(supportedLanguages);

        assert.equal(result, "pt");
        assert.equal(storage.get("cv_culture"), "pt");
    });
}

function testDetectUsesNavigatorLanguages() {
    const detected = detectPreferredCulture(supportedLanguages, ["es-MX", "en-US"]);
    assert.equal(detected, "es");
}

testMatchesBrowserLanguagesInOrder();
testMatchesBaseOnlyLanguages();
testRegionalVariantsFallBackToSupportedLanguage();
testUnknownLanguagesReturnNull();
testFirstSupportedLanguageIsNotAssumedToBeTheDefault();
testSyncPersistsDetectedBrowserLanguageOnFirstVisit();
testSyncDoesNotOverwriteManualChoice();
testManualChoiceSurvivesReload();
testSyncMirrorsStoredPreferenceToCookie();
testDetectUsesNavigatorLanguages();

console.log("culturePreference tests passed");
