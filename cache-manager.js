/**
 * SagarSoft Cache Manager
 * Enterprise-grade caching for Super Admin data.
 * Cache-first pattern with background sync + optimistic UI.
 */
(function () {
  "use strict";

  var SYNC_INTERVAL = 60000; // 60 seconds
  var SESSION_CACHE_KEY = "sagarsoft_superadmin_cache";

  // ── Cache Store ──────────────────────────────────────────────
  var cache = {
    schools: { data: null, lastSync: 0, version: 0 },
    notifications: { data: null, lastSync: 0, version: 0 },
    history: { data: null, lastSync: 0, version: 0 },
    notices: { data: null, lastSync: 0, version: 0 },
    events: { data: null, lastSync: 0, version: 0 }
  };

  var _syncTimer = null;
  var _listeners = {};
  var _initialLoadDone = { schools: false, notifications: false, history: false };

  // ── Helpers ──────────────────────────────────────────────────
  function getApiBase() {
    var cfg = window.SagarSoftOnlineConfig;
    return (cfg && cfg.apiBaseUrl) ? cfg.apiBaseUrl.replace(/\/+$/, "") : "https://sagarsoftonline.onrender.com";
  }

  function getToken() {
    try {
      return (window.SagarSoftAuth && window.SagarSoftAuth.getServerToken)
        ? window.SagarSoftAuth.getServerToken() || "" : "";
    } catch (_e) { return ""; }
  }

  function fetchJSON(url, options) {
    return fetch(url, options).then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    });
  }

  function arraysChanged(a, b) {
    if (!a || !b) return true;
    if (a.length !== b.length) return true;
    for (var i = 0; i < a.length; i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return true;
    }
    return false;
  }

  // ── Persistent Cache (sessionStorage) ────────────────────────
  function saveToSessionStorage() {
    try {
      var payload = {
        schools: cache.schools,
        notifications: cache.notifications,
        history: cache.history,
        notices: cache.notices,
        events: cache.events
      };
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(payload));
    } catch (_e) { /* quota exceeded - ignore */ }
  }

  function loadFromSessionStorage() {
    try {
      var raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!raw) return;
      var payload = JSON.parse(raw);
      if (payload.schools) cache.schools = payload.schools;
      if (payload.notifications) cache.notifications = payload.notifications;
      if (payload.history) cache.history = payload.history;
      if (payload.notices) cache.notices = payload.notices;
      if (payload.events) cache.events = payload.events;
    } catch (_e) { /* corrupt data - ignore */ }
  }

  // ── Event System ─────────────────────────────────────────────
  function on(event, callback) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(callback);
  }

  function emit(event, data) {
    var handlers = _listeners[event] || [];
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i](data); } catch (_e) { console.error("[Cache] Event handler error:", _e); }
    }
  }

  // ── Schools Cache ────────────────────────────────────────────
  function getSchools() {
    return cache.schools.data || [];
  }

  function fetchSchools(options) {
    var opts = options || {};
    var url = getApiBase() + "/api/admin/schools";
    var headers = { "Authorization": "Bearer " + getToken() };

    return fetchJSON(url, { cache: "no-store", headers: headers })
      .then(function (result) {
        if (!result.success || !Array.isArray(result.schools)) return cache.schools.data || [];
        var newSchools = result.schools;
        var changed = arraysChanged(cache.schools.data, newSchools);
        cache.schools.data = newSchools;
        cache.schools.lastSync = Date.now();
        cache.schools.version++;
        _initialLoadDone.schools = true;
        saveToSessionStorage();
        if (changed) emit("schools-changed", newSchools);
        return newSchools;
      })
      .catch(function (err) {
        console.error("[Cache] fetchSchools error:", err.message);
        if (!_initialLoadDone.schools) {
          emit("schools-error", err);
        }
        return cache.schools.data || [];
      });
  }

  function addSchoolOptimistic(school) {
    if (!cache.schools.data) cache.schools.data = [];
    cache.schools.data.unshift(school);
    cache.schools.version++;
    saveToSessionStorage();
    emit("schools-changed", cache.schools.data);
  }

  function updateSchoolOptimistic(schoolId, updates) {
    if (!cache.schools.data) return;
    for (var i = 0; i < cache.schools.data.length; i++) {
      if (cache.schools.data[i].school_id === schoolId) {
        Object.assign(cache.schools.data[i], updates);
        break;
      }
    }
    cache.schools.version++;
    saveToSessionStorage();
    emit("schools-changed", cache.schools.data);
  }

  function removeSchoolOptimistic(schoolId) {
    if (!cache.schools.data) return;
    cache.schools.data = cache.schools.data.filter(function (s) { return s.school_id !== schoolId; });
    cache.schools.version++;
    saveToSessionStorage();
    emit("schools-changed", cache.schools.data);
  }

  // ── Notifications Cache ──────────────────────────────────────
  function getNotifications() {
    return cache.notifications.data || [];
  }

  function fetchNotifications(options) {
    var opts = options || {};
    var url = getApiBase() + "/api/admin/notifications";
    var headers = { "Authorization": "Bearer " + getToken() };

    return fetchJSON(url, { cache: "no-store", headers: headers })
      .then(function (result) {
        if (!result.success || !Array.isArray(result.notifications)) return cache.notifications.data || [];
        var newNotifs = result.notifications;
        var changed = arraysChanged(cache.notifications.data, newNotifs);
        cache.notifications.data = newNotifs;
        cache.notifications.lastSync = Date.now();
        cache.notifications.version++;
        _initialLoadDone.notifications = true;
        saveToSessionStorage();
        if (changed) emit("notifications-changed", newNotifs);
        return newNotifs;
      })
      .catch(function (err) {
        console.error("[Cache] fetchNotifications error:", err.message);
        if (!_initialLoadDone.notifications) {
          emit("notifications-error", err);
        }
        return cache.notifications.data || [];
      });
  }

  function addNotificationOptimistic(notification) {
    if (!cache.notifications.data) cache.notifications.data = [];
    cache.notifications.data.unshift(notification);
    cache.notifications.version++;
    saveToSessionStorage();
    emit("notifications-changed", cache.notifications.data);
  }

  function clearNotificationsOptimistic() {
    cache.notifications.data = [];
    cache.notifications.version++;
    saveToSessionStorage();
    emit("notifications-changed", []);
  }

  // ── History Cache ────────────────────────────────────────────
  function getHistory() {
    return cache.history.data || [];
  }

  function fetchHistory(options) {
    var opts = options || {};
    var url = getApiBase() + "/api/admin/notifications";
    var headers = { "Authorization": "Bearer " + getToken() };

    return fetchJSON(url, { cache: "no-store", headers: headers })
      .then(function (result) {
        if (!result.success || !Array.isArray(result.notifications)) return cache.history.data || [];
        var newHistory = result.notifications;
        var changed = arraysChanged(cache.history.data, newHistory);
        cache.history.data = newHistory;
        cache.history.lastSync = Date.now();
        cache.history.version++;
        _initialLoadDone.history = true;
        saveToSessionStorage();
        if (changed) emit("history-changed", newHistory);
        return newHistory;
      })
      .catch(function (err) {
        console.error("[Cache] fetchHistory error:", err.message);
        if (!_initialLoadDone.history) {
          emit("history-error", err);
        }
        return cache.history.data || [];
      });
  }

  function clearHistoryOptimistic() {
    cache.history.data = [];
    cache.history.version++;
    saveToSessionStorage();
    emit("history-changed", []);
  }

  // ── Notices Cache (school-level) ───────────────────────────
  var _noticesLoaded = false;

  function getNotices() {
    return cache.notices ? cache.notices.data || [] : [];
  }

  function fetchNotices() {
    var cfg = window.SagarSoftOnlineConfig || window.OnlineConfig || {};
    var schoolId = cfg.schoolId || "";
    if (!schoolId) return Promise.resolve(getNotices());
    var apiBase = (cfg.apiBaseUrl || "").replace(/\/+$/, "") || getApiBase();
    var url = apiBase + "/api/data/" + encodeURIComponent(schoolId) + "/notices";

    return fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json" } })
      .then(function (resp) { return resp.json(); })
      .then(function (result) {
        if (!result.success || !Array.isArray(result.data)) return getNotices();
        var arr = result.data.map(function (row) { return row.data || row; });
        var changed = arraysChanged(cache.notices.data, arr);
        cache.notices.data = arr;
        cache.notices.lastSync = Date.now();
        cache.notices.version++;
        _noticesLoaded = true;
        saveToSessionStorage();
        if (changed) emit("notices-changed", arr);
        return arr;
      })
      .catch(function (err) {
        console.error("[Cache] fetchNotices error:", err.message);
        return getNotices();
      });
  }

  function addNoticeOptimistic(notice) {
    if (!cache.notices.data) cache.notices.data = [];
    cache.notices.data.unshift(notice);
    cache.notices.version++;
    saveToSessionStorage();
    emit("notices-changed", cache.notices.data);
  }

  function updateNoticeOptimistic(noticeId, updates) {
    if (!cache.notices.data) return;
    for (var i = 0; i < cache.notices.data.length; i++) {
      if (cache.notices.data[i].id === noticeId) {
        Object.assign(cache.notices.data[i], updates);
        break;
      }
    }
    cache.notices.version++;
    saveToSessionStorage();
    emit("notices-changed", cache.notices.data);
  }

  function removeNoticeOptimistic(noticeId) {
    if (!cache.notices.data) return;
    cache.notices.data = cache.notices.data.filter(function (n) { return n.id !== noticeId; });
    cache.notices.version++;
    saveToSessionStorage();
    emit("notices-changed", cache.notices.data);
  }

  // ── Events Cache (school-level) ────────────────────────────
  var _eventsLoaded = false;

  function getEvents() {
    return cache.events ? cache.events.data || [] : [];
  }

  function fetchEvents() {
    var cfg = window.SagarSoftOnlineConfig || window.OnlineConfig || {};
    var schoolId = cfg.schoolId || "";
    if (!schoolId) return Promise.resolve(getEvents());
    var apiBase = (cfg.apiBaseUrl || "").replace(/\/+$/, "") || getApiBase();
    var url = apiBase + "/api/data/" + encodeURIComponent(schoolId) + "/events";

    return fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json" } })
      .then(function (resp) { return resp.json(); })
      .then(function (result) {
        if (!result.success || !Array.isArray(result.data)) return getEvents();
        var arr = result.data.map(function (row) { return row.data || row; });
        var changed = arraysChanged(cache.events.data, arr);
        cache.events.data = arr;
        cache.events.lastSync = Date.now();
        cache.events.version++;
        _eventsLoaded = true;
        saveToSessionStorage();
        if (changed) emit("events-changed", arr);
        return arr;
      })
      .catch(function (err) {
        console.error("[Cache] fetchEvents error:", err.message);
        return getEvents();
      });
  }

  function addEventOptimistic(evt) {
    if (!cache.events.data) cache.events.data = [];
    cache.events.data.push(evt);
    cache.events.version++;
    saveToSessionStorage();
    emit("events-changed", cache.events.data);
  }

  function updateEventOptimistic(eventId, updates) {
    if (!cache.events.data) return;
    for (var i = 0; i < cache.events.data.length; i++) {
      if (cache.events.data[i].id === eventId) {
        Object.assign(cache.events.data[i], updates);
        break;
      }
    }
    cache.events.version++;
    saveToSessionStorage();
    emit("events-changed", cache.events.data);
  }

  function removeEventOptimistic(eventId) {
    if (!cache.events.data) return;
    cache.events.data = cache.events.data.filter(function (e) { return e.id !== eventId; });
    cache.events.version++;
    saveToSessionStorage();
    emit("events-changed", cache.events.data);
  }

  // ── Background Sync ──────────────────────────────────────────
  function isSuperAdminUser() {
    try {
      var raw = sessionStorage.getItem("sagarsoft_session") || localStorage.getItem("sagarsoft_session");
      if (raw) {
        var session = JSON.parse(raw);
        return session && session.role === "superadmin";
      }
    } catch (_e) {}
    return false;
  }

  function syncAll() {
    if (isSuperAdminUser()) {
      return Promise.all([
        fetchSchools({ silent: true }),
        fetchNotifications({ silent: true }),
        fetchHistory({ silent: true })
      ]);
    }
    return Promise.all([
      fetchNotices({ silent: true }),
      fetchEvents({ silent: true })
    ]);
  }

  function startBackgroundSync() {
    if (_syncTimer) return;
    _syncTimer = setInterval(function () {
      syncAll();
    }, SYNC_INTERVAL);
  }

  function stopBackgroundSync() {
    if (_syncTimer) {
      clearInterval(_syncTimer);
      _syncTimer = null;
    }
  }

  // ── Manual Refresh ───────────────────────────────────────────
  function refreshAll() {
    return syncAll();
  }

  // ── Initialize ───────────────────────────────────────────────
  function init() {
    loadFromSessionStorage();
    startBackgroundSync();
  }

  // ── Destroy (cleanup) ────────────────────────────────────────
  function destroy() {
    stopBackgroundSync();
    _listeners = {};
  }

  // ── Public API ───────────────────────────────────────────────
  window.SagarSoftCache = {
    init: init,
    destroy: destroy,
    on: on,

    // Schools
    getSchools: getSchools,
    fetchSchools: fetchSchools,
    addSchoolOptimistic: addSchoolOptimistic,
    updateSchoolOptimistic: updateSchoolOptimistic,
    removeSchoolOptimistic: removeSchoolOptimistic,

    // Notifications
    getNotifications: getNotifications,
    fetchNotifications: fetchNotifications,
    addNotificationOptimistic: addNotificationOptimistic,
    clearNotificationsOptimistic: clearNotificationsOptimistic,

    // History
    getHistory: getHistory,
    fetchHistory: fetchHistory,
    clearHistoryOptimistic: clearHistoryOptimistic,

    // Notices (school-level)
    getNotices: getNotices,
    fetchNotices: fetchNotices,
    addNoticeOptimistic: addNoticeOptimistic,
    updateNoticeOptimistic: updateNoticeOptimistic,
    removeNoticeOptimistic: removeNoticeOptimistic,

    // Events (school-level)
    getEvents: getEvents,
    fetchEvents: fetchEvents,
    addEventOptimistic: addEventOptimistic,
    updateEventOptimistic: updateEventOptimistic,
    removeEventOptimistic: removeEventOptimistic,

    // Sync
    syncAll: syncAll,
    refreshAll: refreshAll,
    startBackgroundSync: startBackgroundSync,
    stopBackgroundSync: stopBackgroundSync,

    // Status
    isLoaded: function (key) { return _initialLoadDone[key] || false; },
    getLastSync: function (key) { return cache[key] ? cache[key].lastSync : 0; },
    getVersion: function (key) { return cache[key] ? cache[key].version : 0; }
  };
})();
