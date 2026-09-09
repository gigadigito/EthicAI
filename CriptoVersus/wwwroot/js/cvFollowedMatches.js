var CvFollowedMatches = (function () {
    var STORAGE_KEY = 'cv_followed_matches';
    var RECENT_KEY = 'cv_recent_matches';
    var MAX_FOLLOWED = 10;
    var MAX_RECENT = 20;

    function getFollowed() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function getRecent() {
        try {
            var raw = localStorage.getItem(RECENT_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveFollowed(list) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (e) { }
    }

    function saveRecent(list) {
        try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(list));
        } catch (e) { }
    }

    function addRecent(matchId, leftAsset, rightAsset, scoreA, scoreB, status) {
        var recent = getRecent();
        recent = recent.filter(function (m) { return m.matchId !== matchId; });
        recent.unshift({
            matchId: matchId,
            leftAsset: leftAsset,
            rightAsset: rightAsset,
            scoreA: scoreA,
            scoreB: scoreB,
            status: status,
            viewedAt: Date.now()
        });
        if (recent.length > MAX_RECENT) {
            recent = recent.slice(0, MAX_RECENT);
        }
        saveRecent(recent);
    }

    function toggleFollow(matchId, leftAsset, rightAsset) {
        var followed = getFollowed();
        var index = followed.findIndex(function (m) { return m.matchId === matchId; });
        if (index >= 0) {
            followed.splice(index, 1);
            saveFollowed(followed);
            return false;
        }
        followed.unshift({
            matchId: matchId,
            leftAsset: leftAsset,
            rightAsset: rightAsset,
            followedAt: Date.now()
        });
        if (followed.length > MAX_FOLLOWED) {
            followed = followed.slice(0, MAX_FOLLOWED);
        }
        saveFollowed(followed);
        return true;
    }

    function isFollowed(matchId) {
        return getFollowed().some(function (m) { return m.matchId === matchId; });
    }

    function getFollowedMatch(matchId) {
        return getFollowed().find(function (m) { return m.matchId === matchId; }) || null;
    }

    function clearFollowed() {
        saveFollowed([]);
    }

    function clearRecent() {
        saveRecent([]);
    }

    return {
        getFollowed: getFollowed,
        getRecent: getRecent,
        addRecent: addRecent,
        toggleFollow: toggleFollow,
        isFollowed: isFollowed,
        getFollowedMatch: getFollowedMatch,
        clearFollowed: clearFollowed,
        clearRecent: clearRecent
    };
})();
