export function setPreferredCulture(culture) {
    try {
        localStorage.setItem('cv_culture', culture);
    } catch (e) { }

    document.cookie = `cv_culture=${encodeURIComponent(culture)}; path=/; max-age=31536000; SameSite=Lax`;
}
