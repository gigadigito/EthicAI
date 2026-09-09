var CvAnalytics = (function () {
    var isInitialized = false;
    var isInternalTraffic = false;

    function init() {
        if (isInitialized) return;
        isInitialized = true;

        try {
            var params = new URLSearchParams(window.location.search);
            if (params.has('cv_source') && params.get('cv_source') === 'internal') {
                isInternalTraffic = true;
            }
            var flag = localStorage.getItem('cv_internal');
            if (flag === '1') {
                isInternalTraffic = true;
            }
        } catch (e) { }
    }

    function trackEvent(eventName, params) {
        init();
        if (isInternalTraffic) return;

        try {
            if (typeof gtag === 'function') {
                gtag('event', eventName, params || {});
            }
        } catch (e) { }
    }

    function trackMatchView(matchId, leftAsset, rightAsset, status, locale, source) {
        trackEvent('match_view', {
            match_id: matchId,
            left_asset: leftAsset,
            right_asset: rightAsset,
            match_status: status,
            locale: locale || 'unknown',
            source: source || 'direct'
        });
    }

    function trackWatchMatch(matchId, leftAsset, rightAsset, locale) {
        trackEvent('watch_match', {
            match_id: matchId,
            left_asset: leftAsset,
            right_asset: rightAsset,
            locale: locale || 'unknown'
        });
    }

    function trackChooseClick(matchId, teamSymbol, side) {
        trackEvent('choose_click', {
            match_id: matchId,
            team_symbol: teamSymbol,
            side: side
        });
    }

    function trackInvestmentModalOpen(matchId, teamSymbol) {
        trackEvent('investment_modal_open', {
            match_id: matchId,
            team_symbol: teamSymbol
        });
    }

    function trackInvestmentStart(matchId, teamSymbol, amountSol) {
        trackEvent('investment_start', {
            match_id: matchId,
            team_symbol: teamSymbol,
            amount_sol: amountSol
        });
    }

    function trackInvestmentComplete(matchId, teamSymbol, amountSol) {
        trackEvent('investment_complete', {
            match_id: matchId,
            team_symbol: teamSymbol,
            amount_sol: amountSol
        });
    }

    function trackShareMatch(matchId, leftAsset, rightAsset) {
        trackEvent('share_match', {
            match_id: matchId,
            left_asset: leftAsset,
            right_asset: rightAsset
        });
    }

    function trackNextMatchClick(matchId) {
        trackEvent('next_match_click', {
            match_id: matchId
        });
    }

    function trackMatchFollow(matchId, leftAsset, rightAsset) {
        trackEvent('match_follow', {
            match_id: matchId,
            left_asset: leftAsset,
            right_asset: rightAsset
        });
    }

    function trackReturnToFollowedMatch(matchId) {
        trackEvent('return_to_followed_match', {
            match_id: matchId
        });
    }

    function trackHomeView() {
        trackEvent('home_view', {});
    }

    function markAsInternal() {
        try {
            localStorage.setItem('cv_internal', '1');
            isInternalTraffic = true;
        } catch (e) { }
    }

    return {
        init: init,
        trackEvent: trackEvent,
        trackMatchView: trackMatchView,
        trackWatchMatch: trackWatchMatch,
        trackChooseClick: trackChooseClick,
        trackInvestmentModalOpen: trackInvestmentModalOpen,
        trackInvestmentStart: trackInvestmentStart,
        trackInvestmentComplete: trackInvestmentComplete,
        trackShareMatch: trackShareMatch,
        trackNextMatchClick: trackNextMatchClick,
        trackMatchFollow: trackMatchFollow,
        trackReturnToFollowedMatch: trackReturnToFollowedMatch,
        trackHomeView: trackHomeView,
        markAsInternal: markAsInternal
    };
})();
