window.userTime = window.userTime || {
    getTimeZone: function () {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
        } catch {
            return "America/Sao_Paulo";
        }
    }
};
