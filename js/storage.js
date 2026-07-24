(function () {
  var SCHOOL_ID_KEY = "ss_school_id_persistent";
  var API_KEY_KEY = "ss_api_key_persistent";
  var TOKEN_KEY = "ss_auth_token";
  var DEMO_EMAILS = ["admin@sagarsoft.com","teacher@sagarsoft.com","student@sagarsoft.com","parent@sagarsoft.com"];
  var cachedDatabase = null;
  var config = { apiBaseUrl: "", schoolId: "", apiKey: "", authToken: "" };

  var cfg = window.SagarSoftOnlineConfig || {};
  if (cfg.apiBaseUrl) config.apiBaseUrl = String(cfg.apiBaseUrl).replace(/\/+$/, "");
  if (cfg.schoolId) config.schoolId = String(cfg.schoolId);
  if (cfg.apiKey) config.apiKey = String(cfg.apiKey);

  function persistCredentials(schoolId, apiKey, authToken) {
    try {
      if (schoolId) localStorage.setItem(SCHOOL_ID_KEY, schoolId);
      if (apiKey) localStorage.setItem(API_KEY_KEY, apiKey);
      if (authToken) localStorage.setItem(TOKEN_KEY, authToken);
    } catch (_e) {}
  }

  function loadPersistedCredentials() {
    try {
      var sid = localStorage.getItem(SCHOOL_ID_KEY);
      var ak = localStorage.getItem(API_KEY_KEY);
      var tk = localStorage.getItem(TOKEN_KEY);
      if (sid) config.schoolId = String(sid);
      if (ak) config.apiKey = String(ak);
      if (tk) config.authToken = String(tk);
    } catch (_e) {}
  }

  loadPersistedCredentials();

  var _cachedHeaders = null;
  var _headersApiKey = "";
  var _headersAuthToken = "";
  function headers() {
    if (_cachedHeaders && _headersApiKey === config.apiKey && _headersAuthToken === config.authToken) return _cachedHeaders;
    var h = { "Content-Type": "application/json" };
    if (config.apiKey) h["x-sagarsoft-api-key"] = config.apiKey;
    if (config.authToken) h["Authorization"] = "Bearer " + config.authToken;
    _cachedHeaders = h; _headersApiKey = config.apiKey; _headersAuthToken = config.authToken;
    return h;
  }
  function invalidateHeadersCache() { _cachedHeaders = null; }

  var pendingSyncs = 0;
  var lastSyncFailed = false;
  var _activeFetchControllers = [];
  var _isCancelled = false;
  var _cachedIsDemo = null;

  function isDemoUser() {
    if (_cachedIsDemo !== null) return _cachedIsDemo;
    var _session = null;
    try { _session = JSON.parse(sessionStorage.getItem("sagarsoft_session") || localStorage.getItem("sagarsoft_session") || "null"); } catch (_e) {}
    _cachedIsDemo = _session && DEMO_EMAILS.indexOf(String(_session.email || "").toLowerCase()) !== -1;
    return _cachedIsDemo;
  }
  function resetDemoCache() { _cachedIsDemo = null; }

  function abortAllRequests() {
    _isCancelled = true;
    _activeFetchControllers.forEach(function (c) { try { c.abort(); } catch (_e) {} });
    _activeFetchControllers = [];
  }

  var _pendingRequests = {};

  async function apiFetch(path, options) {
    if (!config.apiBaseUrl) throw new Error("API base URL not configured.");
    if (_isCancelled) throw new Error("Request cancelled.");

    var method = (options && options.method) || "GET";
    var bodyStr = options && options.body ? options.body : "";
    var dedupeKey = method + ":" + path + ":" + bodyStr;
    if (method !== "GET" && _pendingRequests[dedupeKey]) {
      return _pendingRequests[dedupeKey];
    }

    var maxRetries = (options && options.retries != null) ? options.retries : (method === "GET" ? 2 : 1);
    var attempt = 0;
    var lastErr = null;

    while (attempt <= maxRetries) {
      var controller = new AbortController();
      _activeFetchControllers.push(controller);
      var timeoutMs = (options && options.timeoutMs) || 90000;
      var timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        var fetchOpts = {
          headers: headers(),
          signal: controller.signal
        };
        if (options && options.method) fetchOpts.method = options.method;
        if (options && options.body) fetchOpts.body = options.body;
        var response = await fetch(config.apiBaseUrl + path, fetchOpts);
        clearTimeout(timeoutId);
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok || !payload.success) {
          var errMsg = payload.message || "API request failed.";
          var err = new Error(errMsg);
          err.statusCode = response.status;
          err.serverMessage = errMsg;
          if (response.status >= 500 && attempt < maxRetries) {
            lastErr = err;
            attempt++;
            await new Promise(function (r) { setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 8000)); });
            continue;
          }
          throw err;
        }
        lastSyncFailed = false;
        if (method !== "GET") delete _pendingRequests[dedupeKey];
        return payload;
      } catch (err) {
        clearTimeout(timeoutId);
        var isNetwork = err.name === "AbortError" || err.message === "Failed to fetch" || err.message === "NetworkError";
        if (isNetwork && attempt < maxRetries) {
          lastErr = err;
          attempt++;
          await new Promise(function (r) { setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 8000)); });
          continue;
        }
        if (method !== "GET") delete _pendingRequests[dedupeKey];
        throw err;
      } finally {
        var idx = _activeFetchControllers.indexOf(controller);
        if (idx >= 0) _activeFetchControllers.splice(idx, 1);
      }
    }
    if (lastErr) throw lastErr;
  }

  function retrySyncLater(database, attempt) {
    attempt = attempt || 0;
    var maxRetries = 5;
    if (attempt >= maxRetries) {
      lastSyncFailed = true;
      pendingSyncs = Math.max(0, pendingSyncs - 1);
      return;
    }
    var delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    setTimeout(function () {
      if (!config.apiBaseUrl || !config.schoolId) return;
      apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
        method: "POST",
        body: JSON.stringify({ database: database }),
        timeoutMs: 120000
      }).then(function () {
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        lastSyncFailed = false;
      }).catch(function () {
        retrySyncLater(database, attempt + 1);
      });
    }, delay);
  }

  const defaultDatabase = {
    school: {
      name: "SagarSoft Public School",
      address: "Online Campus, Education City",
      phone: "+91 00000 00000",
      email: "info@sagarsoftschool.local",
      rulesRegulations: ""
    },
    settings: { theme: "light", sidebarCollapsed: false },
    generalSettings: {
      instituteProfile: {
        logo: "",
        name: "SagarSoft Public School",
        slogan: "Learning Today, Leading Tomorrow",
        phone: "+91 00000 00000",
        psra: "",
        address: "Online Campus, Education City",
        country: "Pakistan"
      },
      feeParticulars: {},
      feeStructures: {},
      discountPolicies: [],
      bankAccounts: [],
      rulesAndRegulations: { students: "", employees: "" },
      accountSettings: { username: "", password: "" },
      licenseSettings: {}
    },
    users: [
      { id: "USR-SUPER-001", name: "SagarSoft Super Admin", email: "aleemsagar@gmail.com", password: "", role: "superadmin", phone: "", active: true }
    ],
    students: [],
    teachers: [],
    classes: [],
    subjects: [],
    attendance: [],
    fees: [],
    activityLogs: [],
    notifications: [],
    exams: [],
    timetable: [],
    homework: [],
    certificates: [],
    employees: [],
    salaryPayments: [],
    accountsLedger: [],
    notices: [],
    events: [],
    smsTemplates: [],
    accountActivity: []
  };

  function normalizeDatabase(db) {
    if (!db || typeof db !== "object") return JSON.parse(JSON.stringify(defaultDatabase));
    if (!db.school) db.school = JSON.parse(JSON.stringify(defaultDatabase.school));
    if (!db.settings) db.settings = { theme: "light", sidebarCollapsed: false };
    if (!db.generalSettings) db.generalSettings = JSON.parse(JSON.stringify(defaultDatabase.generalSettings));
    if (!db.generalSettings.instituteProfile) db.generalSettings.instituteProfile = JSON.parse(JSON.stringify(defaultDatabase.generalSettings.instituteProfile));
    if (!db.generalSettings.accountSettings) db.generalSettings.accountSettings = { username: "", password: "" };
    if (!db.generalSettings.licenseSettings) db.generalSettings.licenseSettings = {};
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.students)) db.students = [];
    if (!Array.isArray(db.teachers)) db.teachers = [];
    if (!Array.isArray(db.classes)) db.classes = [];
    if (!Array.isArray(db.subjects)) db.subjects = [];
    if (!Array.isArray(db.attendance)) db.attendance = [];
    if (!Array.isArray(db.fees)) db.fees = [];
    if (!Array.isArray(db.activityLogs)) db.activityLogs = [];
    if (!Array.isArray(db.notifications)) db.notifications = [];
    if (!Array.isArray(db.exams)) db.exams = [];
    if (!Array.isArray(db.timetable)) db.timetable = [];
    if (!Array.isArray(db.homework)) db.homework = [];
    if (!Array.isArray(db.certificates)) db.certificates = [];
    if (!Array.isArray(db.employees)) db.employees = [];
    if (!Array.isArray(db.salaryPayments)) db.salaryPayments = [];

    if (db.teachers.length > 0 && db.employees.length !== db.teachers.length) {
      db.employees = db.teachers.slice();
    } else if (db.employees.length > 0 && db.teachers.length !== db.employees.length) {
      db.teachers = db.employees.slice();
    }
    if (!Array.isArray(db.accountsLedger)) db.accountsLedger = [];
    if (!Array.isArray(db.notices)) db.notices = [];
    if (!Array.isArray(db.events)) db.events = [];
    if (!Array.isArray(db.smsTemplates)) db.smsTemplates = [];
    if (!Array.isArray(db.accountActivity)) db.accountActivity = [];

    db.fees = db.fees.map(function (feeItem) {
      return Object.assign({}, feeItem, {
        month: feeItem.month || feeItem.feeMonth || "",
        feeMonth: feeItem.feeMonth || feeItem.month || "",
        totalAmount: Number(feeItem.totalAmount || feeItem.amount || 0),
        deposit: Number(feeItem.deposit || 0),
        remaining: Number(feeItem.remaining || 0)
      });
    });

    return db;
  }

  function getDatabase() {
    if (cachedDatabase) return structuredClone(cachedDatabase);
    return structuredClone(defaultDatabase);
  }

  var _loadingOverlay = null;
  var _loadingLabel = null;
  var _loadingBar = null;
  var _loadingCancelBtn = null;
  var _loadingSlowTimer = null;
  function cacheLoadingElements() {
    _loadingOverlay = document.getElementById("sagarsoft-loading-overlay");
    _loadingLabel = document.getElementById("sagarsoft-loading-text");
    _loadingBar = document.getElementById("sagarsoft-loading-bar");
    _loadingCancelBtn = document.getElementById("sagarsoft-loading-cancel");
  }

  function showLoading(text) {
    _isCancelled = false;
    if (!_loadingOverlay) cacheLoadingElements();
    if (_loadingOverlay) {
      _loadingOverlay.classList.remove("ss-slow");
      _loadingOverlay.style.display = "flex";
      _loadingOverlay.style.touchAction = "none";
      requestAnimationFrame(function(){ _loadingOverlay.style.opacity = "1"; });
      try { document.body.style.overflow = "hidden"; document.body.style.touchAction = "none"; } catch(_e) {}
    }
    if (_loadingLabel) { _loadingLabel.textContent = text || ""; }
    if (_loadingBar) { _loadingBar.style.display = text ? "block" : "none"; }
    if (_loadingCancelBtn) { _loadingCancelBtn.style.display = text ? "inline-block" : "none"; }

    if (_loadingSlowTimer) { clearTimeout(_loadingSlowTimer); _loadingSlowTimer = null; }
    var isSlowConnection = false;
    if (navigator.connection && navigator.connection.effectiveType) {
      var et = navigator.connection.effectiveType;
      if (et === "slow-2g" || et === "2g" || et === "3g") isSlowConnection = true;
    }
    if (isSlowConnection && _loadingOverlay) {
      _loadingOverlay.classList.add("ss-slow");
    } else if (_loadingOverlay) {
      _loadingSlowTimer = setTimeout(function() {
        _loadingOverlay.classList.add("ss-slow");
      }, 8000);
    }
  }

  function hideLoading() {
    if (!_loadingOverlay) cacheLoadingElements();
    if (_loadingCancelBtn) { _loadingCancelBtn.style.display = "none"; }
    if (_loadingSlowTimer) { clearTimeout(_loadingSlowTimer); _loadingSlowTimer = null; }
    if (_loadingOverlay) {
      _loadingOverlay.classList.remove("ss-slow");
      _loadingOverlay.style.opacity = "0";
      setTimeout(function () {
        if (_loadingOverlay) _loadingOverlay.style.display = "none";
        try { document.body.style.overflow = ""; document.body.style.touchAction = ""; } catch(_e) {}
      }, 250);
    } else {
      try { document.body.style.overflow = ""; document.body.style.touchAction = ""; } catch(_e) {}
    }
  }

  function cancelLoading() {
    _isCancelled = true;
    abortAllRequests();
    hideLoading();
    _isCancelled = false;
  }

  var _saveDbTimer = null;
  var _pendingSave = false;
  var _saveMutex = null;
  var _reloadInProgress = false;

  function acquireSaveMutex() {
    if (_saveMutex) return _saveMutex.then(function () { return acquireSaveMutex(); });
    var resolve;
    _saveMutex = new Promise(function (r) { resolve = r; });
    return Promise.resolve(resolve);
  }

  function releaseSaveMutex() {
    _saveMutex = null;
  }

  async function flushPendingSync() {
    if (_saveDbTimer) { clearTimeout(_saveDbTimer); _saveDbTimer = null; }
    if (isDemoUser()) { _pendingSave = false; return; }
    if (_pendingSave && cachedDatabase && config.apiBaseUrl && config.schoolId) {
      _pendingSave = false;
      pendingSyncs++;
      try {
        await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
          method: "POST",
          body: JSON.stringify({ database: cachedDatabase }),
          timeoutMs: 120000
        });
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        lastSyncFailed = false;
        showSyncBadge("synced");
      } catch (err) {
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        lastSyncFailed = true;
        showSyncBadge("failed");
        retrySyncLater(cachedDatabase, 0);
      }
    }
  }

  var _syncBadgeEl = null;
  var _syncBadgeTimer = null;
  function showSyncBadge(status) {
    if (!_syncBadgeEl) _syncBadgeEl = document.getElementById("sagarsoft-sync-badge");
    if (!_syncBadgeEl) {
      _syncBadgeEl = document.createElement("div");
      _syncBadgeEl.id = "sagarsoft-sync-badge";
      _syncBadgeEl.style.cssText = "position:fixed;bottom:16px;right:16px;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;z-index:99999;transition:opacity 0.3s;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
      document.body.appendChild(_syncBadgeEl);
    }
    if (status === "syncing") {
      _syncBadgeEl.textContent = "Syncing...";
      _syncBadgeEl.style.background = "#e3f2fd";
      _syncBadgeEl.style.color = "#1976d2";
    } else if (status === "synced") {
      _syncBadgeEl.textContent = "Synced";
      _syncBadgeEl.style.background = "#e8f5e9";
      _syncBadgeEl.style.color = "#2e7d32";
    } else if (status === "failed") {
      _syncBadgeEl.textContent = "Sync failed";
      _syncBadgeEl.style.background = "#fce4ec";
      _syncBadgeEl.style.color = "#c62828";
    }
    _syncBadgeEl.style.opacity = "1";
    if (_syncBadgeTimer) clearTimeout(_syncBadgeTimer);
    _syncBadgeTimer = setTimeout(function () { _syncBadgeEl.style.opacity = "0"; }, 2500);
  }

  function scheduleServerSync() {
    if (_saveDbTimer) clearTimeout(_saveDbTimer);
    _pendingSave = true;
    showSyncBadge("syncing");
    _saveDbTimer = setTimeout(function () {
      _saveDbTimer = null;
      _pendingSave = false;
      if (_isCancelled) { showSyncBadge("synced"); return; }
      var effectiveSchoolId = config.schoolId;
      if (!effectiveSchoolId) {
        try {
          effectiveSchoolId = localStorage.getItem(SCHOOL_ID_KEY) || "";
          if (effectiveSchoolId) config.schoolId = effectiveSchoolId;
        } catch (_e) {}
      }
      if (!config.apiBaseUrl || !effectiveSchoolId || !cachedDatabase) {
        showSyncBadge("failed");
        return;
      }
      if (isDemoUser()) { showSyncBadge("synced"); return; }
      pendingSyncs++;
      apiFetch("/api/database/" + encodeURIComponent(effectiveSchoolId), {
        method: "POST",
        body: JSON.stringify({ database: cachedDatabase }),
        timeoutMs: 120000
      }).then(function () {
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        lastSyncFailed = false;
        showSyncBadge("synced");
      }).catch(function (err) {
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        lastSyncFailed = true;
        console.error("[SagarSoft Sync] Failed:", err && err.message ? err.message : err);
        showSyncBadge("failed");
        retrySyncLater(cachedDatabase, 0);
      });
    }, 1500);
  }

  function saveDatabase(database) {
    if (_isCancelled) return cachedDatabase;
    cachedDatabase = normalizeDatabase(database);
    if (database && database.generalSettings && database.generalSettings.licenseSettings) {
      var ls = database.generalSettings.licenseSettings;
      if (ls.schoolId) {
        config.schoolId = String(ls.schoolId);
        persistCredentials(ls.schoolId, ls.websiteApiKey || "", config.authToken || "");
        invalidateHeadersCache();
      }
      if (ls.websiteApiKey) { config.apiKey = String(ls.websiteApiKey); invalidateHeadersCache(); }
    }
    if (!config.schoolId) {
      try {
        var sid = localStorage.getItem(SCHOOL_ID_KEY);
        if (sid) config.schoolId = String(sid);
      } catch (_e) {}
    }
    if (config.apiBaseUrl && config.schoolId) {
      _pendingSave = true;
      scheduleServerSync();
    }
    return cachedDatabase;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", function () {
      if (_pendingSave && cachedDatabase && config.apiBaseUrl && config.schoolId) {
        try {
          var payload = JSON.stringify({ database: cachedDatabase });
          var url = config.apiBaseUrl + "/api/database/" + encodeURIComponent(config.schoolId);
          navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
          _pendingSave = false;
          if (_saveDbTimer) { clearTimeout(_saveDbTimer); _saveDbTimer = null; }
        } catch (_e) {}
      }
    });
  }

  function updateDatabase(updater) {
    var database = getDatabase();
    var updatedDatabase = updater(structuredClone(database));
    return saveDatabase(updatedDatabase);
  }

  async function loadDatabaseFromServer(opts) {
    if (!config.apiBaseUrl || !config.schoolId) return null;
    if (_isCancelled) return null;
    var showOverlay = opts && opts.showLoading !== false;
    if (showOverlay) showLoading("Loading data from server...");
    var attempts = 0;
    var maxAttempts = 3;
    while (attempts < maxAttempts && !_isCancelled) {
      attempts++;
      try {
        var payload = await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), { timeoutMs: 60000 });
        if (payload && payload.database) {
          var db = normalizeDatabase(payload.database);
          if (!_isCancelled) cachedDatabase = db;
          hideLoading();
          window.dispatchEvent(new CustomEvent("sagarsoft:database-loaded", { detail: { source: "server" } }));
          return db;
        }
      } catch (_e) {
        if (_isCancelled) break;
        if (attempts < maxAttempts) {
          await new Promise(function (r) { setTimeout(r, Math.min(1000 * attempts, 3000)); });
        }
      }
    }
    hideLoading();
    return null;
  }

  async function reloadDatabase() {
    _reloadInProgress = true;
    var db = await loadDatabaseFromServer();
    _reloadInProgress = false;
    return db;
  }

  async function flushRemoteSave() {
    if (cachedDatabase && config.apiBaseUrl && config.schoolId) {
      try {
        await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
          method: "POST",
          body: JSON.stringify({ database: cachedDatabase }),
          timeoutMs: 30000
        });
      } catch (_e) {}
    }
  }

  async function preloadDatabaseForLogin() {
    loadPersistedCredentials();
    if (config.apiBaseUrl && config.schoolId) {
      try {
        var db = await loadDatabaseFromServer();
        if (db) return db;
      } catch (_e) {}
    }
    return null;
  }

  function isSyncPending() { return pendingSyncs > 0 || lastSyncFailed; }
  function isSyncFailed() { return lastSyncFailed; }

  function retrySyncNow() {
    if (cachedDatabase && config.apiBaseUrl && config.schoolId) {
      retrySyncLater(cachedDatabase, 0);
    }
  }

  window.addEventListener("focus", function () {
    if (lastSyncFailed && config.apiBaseUrl && config.schoolId) {
      retrySyncLater(cachedDatabase || defaultDatabase, 0);
    }
  });

  window.addEventListener("online", function () {
    if (config.apiBaseUrl && config.schoolId) {
      loadDatabaseFromServer({ showLoading: false });
    }
  });

  var _isLoginPage = (typeof window !== "undefined" && window.location && window.location.pathname && window.location.pathname.indexOf("login") >= 0);
  if (!_isLoginPage && config.apiBaseUrl && config.schoolId) {
    loadDatabaseFromServer({ showLoading: false });
  }

  function setSchoolId(schoolId) {
    if (schoolId) {
      config.schoolId = String(schoolId);
      persistCredentials(schoolId, config.apiKey, config.authToken);
      invalidateHeadersCache();
    }
  }

  function setAuthToken(token) {
    if (token) {
      config.authToken = String(token);
      persistCredentials(config.schoolId, config.apiKey, token);
      invalidateHeadersCache();
    }
  }

  function getConfig() {
    return { apiBaseUrl: config.apiBaseUrl, schoolId: config.schoolId, apiKey: config.apiKey, authToken: config.authToken };
  }

  function clearCache() {
    cachedDatabase = null;
    config.schoolId = localStorage.getItem(SCHOOL_ID_KEY) || "";
    config.apiKey = localStorage.getItem(API_KEY_KEY) || "";
    config.authToken = localStorage.getItem(TOKEN_KEY) || "";
    invalidateHeadersCache();
    resetDemoCache();
  }

  async function saveSettingToServer(key, value) {
    if (!config.apiBaseUrl || !config.schoolId) return false;
    if (isDemoUser()) return true;
    try {
      await apiFetch("/api/school-settings/" + encodeURIComponent(config.schoolId) + "/" + encodeURIComponent(key), {
        method: "PUT",
        body: JSON.stringify(value),
        timeoutMs: 60000
      });
      return true;
    } catch (_e) { return false; }
  }

  async function saveSettingItemsToServer(key, items) {
    if (!config.apiBaseUrl || !config.schoolId) return false;
    if (isDemoUser()) return true;
    try {
      await apiFetch("/api/school-settings/" + encodeURIComponent(config.schoolId) + "/" + encodeURIComponent(key), {
        method: "PUT",
        body: JSON.stringify(items),
        timeoutMs: 60000
      });
      return true;
    } catch (_e) { return false; }
  }

  async function saveRecord(table, record, operation) {
    if (!config.apiBaseUrl || !config.schoolId) return false;
    if (isDemoUser()) return true;
    var schoolId = encodeURIComponent(config.schoolId);
    var tbl = encodeURIComponent(table);
    try {
      if (operation === "delete") {
        await apiFetch("/api/data/" + schoolId + "/" + tbl + "/" + encodeURIComponent(record.id), {
          method: "DELETE",
          timeoutMs: 30000
        });
      } else if (operation === "update") {
        await apiFetch("/api/data/" + schoolId + "/" + tbl + "/" + encodeURIComponent(record.id), {
          method: "PUT",
          body: JSON.stringify({ record: record }),
          timeoutMs: 30000
        });
      } else {
        await apiFetch("/api/data/" + schoolId + "/" + tbl, {
          method: "POST",
          body: JSON.stringify({ record: record }),
          timeoutMs: 30000
        });
      }
      return true;
    } catch (_e) { return false; }
  }

  async function saveRecordsBulk(table, records, operation) {
    if (!records || !records.length) return true;
    var results = [];
    for (var i = 0; i < records.length; i++) {
      results.push(await saveRecord(table, records[i], operation));
    }
    return results.every(function (r) { return r; });
  }

  async function loadRecords(table) {
    if (!config.apiBaseUrl || !config.schoolId) return null;
    try {
      var resp = await apiFetch("/api/data/" + encodeURIComponent(config.schoolId) + "/" + encodeURIComponent(table), { timeoutMs: 60000 });
      if (resp && resp.success && Array.isArray(resp.data)) {
        return resp.data.map(function (row) { return row.data || row; });
      }
      return null;
    } catch (_e) { return null; }
  }

  async function saveProfileToServer(data) {
    if (!config.apiBaseUrl || !config.schoolId) return false;
    if (isDemoUser()) return true;
    try {
      await apiFetch("/api/school-profile/" + encodeURIComponent(config.schoolId), {
        method: "PUT",
        body: JSON.stringify(data),
        timeoutMs: 60000
      });
      return true;
    } catch (_e) { return false; }
  }

  async function loadSchoolProfile() {
    if (!config.apiBaseUrl || !config.schoolId) return null;
    try {
      var resp = await apiFetch("/api/school-profile/" + encodeURIComponent(config.schoolId), { timeoutMs: 30000 });
      return resp || null;
    } catch (_e) { return null; }
  }

  async function loadSettingItemsFromServer(key) {
    if (!config.apiBaseUrl || !config.schoolId) return null;
    try {
      var resp = await apiFetch("/api/school-settings/" + encodeURIComponent(config.schoolId) + "/" + encodeURIComponent(key), { timeoutMs: 30000 });
      return resp || null;
    } catch (_e) { return null; }
  }

  function updateCachedDatabase(db) {
    if (!db || typeof db !== "object") return;
    cachedDatabase = normalizeDatabase(db);
  }

  function getSchoolId() { return config.schoolId; }

  window.SagarSoftDB = {
    getDatabase: getDatabase,
    saveDatabase: saveDatabase,
    updateCachedDatabase: updateCachedDatabase,
    flushPendingSync: flushPendingSync,
    updateDatabase: updateDatabase,
    loadDatabaseFromServer: loadDatabaseFromServer,
    reloadDatabase: reloadDatabase,
    flushRemoteSave: flushRemoteSave,
    clearCache: clearCache,
    setSchoolId: setSchoolId,
    setAuthToken: setAuthToken,
    getConfig: getConfig,
    getSchoolId: getSchoolId,
    defaultDatabase: defaultDatabase,
    isSyncPending: isSyncPending,
    isSyncFailed: isSyncFailed,
    retrySyncNow: retrySyncNow,
    preloadDatabaseForLogin: preloadDatabaseForLogin,
    showLoading: showLoading,
    hideLoading: hideLoading,
    cancelLoading: cancelLoading,
    showSyncBadge: showSyncBadge,
    saveSettingToServer: saveSettingToServer,
    saveSettingItemsToServer: saveSettingItemsToServer,
    saveRecord: saveRecord,
    saveRecordsBulk: saveRecordsBulk,
    loadRecords: loadRecords,
    saveProfileToServer: saveProfileToServer,
    loadSchoolProfile: loadSchoolProfile,
    loadSettingItemsFromServer: loadSettingItemsFromServer,
    isCancelled: function () { return _isCancelled; },
    resetCancel: function () { _isCancelled = false; }
  };
})();
