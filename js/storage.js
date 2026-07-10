(function () {
  var STORAGE_KEY = "ss_db_local";
  var SCHOOL_ID_KEY = "ss_school_id_persistent";
  var API_KEY_KEY = "ss_api_key_persistent";
  var TOKEN_KEY = "ss_auth_token";
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

  function headers() {
    var h = { "Content-Type": "application/json" };
    if (config.apiKey) h["x-sagarsoft-api-key"] = config.apiKey;
    if (config.authToken) h["Authorization"] = "Bearer " + config.authToken;
    return h;
  }

  var pendingSyncs = 0;
  var lastSyncFailed = false;
  var _loadingController = null;

  async function apiFetch(path, options) {
    if (!config.apiBaseUrl) throw new Error("API base URL not configured.");
    var controller = new AbortController();
    var timeoutMs = (options && options.timeoutMs) || 30000;
    var timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
      var response = await fetch(config.apiBaseUrl + path, Object.assign({
        headers: headers(),
        signal: controller.signal
      }, options));
      clearTimeout(timeoutId);
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok || !payload.success) throw new Error(payload.message || "API request failed.");
      lastSyncFailed = false;
      return payload;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
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
        timeoutMs: 30000
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

  function showLoading(text) {
    var overlay = document.getElementById("sagarsoft-loading-overlay");
    var label = document.getElementById("sagarsoft-loading-text");
    var bar = document.getElementById("sagarsoft-loading-bar");
    var cancelBtn = document.getElementById("sagarsoft-loading-cancel");
    if (overlay) { overlay.style.display = "flex"; requestAnimationFrame(function(){ overlay.style.opacity = "1"; }); }
    if (label) { label.textContent = text || ""; }
    if (bar) { bar.style.display = text ? "block" : "none"; }
    if (cancelBtn) { cancelBtn.style.display = text ? "inline-block" : "none"; }
    _loadingController = new AbortController();
  }

  function hideLoading() {
    var overlay = document.getElementById("sagarsoft-loading-overlay");
    var cancelBtn = document.getElementById("sagarsoft-loading-cancel");
    if (cancelBtn) { cancelBtn.style.display = "none"; }
    if (overlay) {
      overlay.style.opacity = "0";
      setTimeout(function () { overlay.style.display = "none"; }, 250);
    }
  }

  function cancelLoading() {
    if (_loadingController) { _loadingController.abort(); _loadingController = null; }
    hideLoading();
  }

  var _saveDbTimer = null;
  var _pendingSave = false;

  async function flushPendingSync() {
    if (_saveDbTimer) { clearTimeout(_saveDbTimer); _saveDbTimer = null; }
    if (_pendingSave && cachedDatabase && config.apiBaseUrl && config.schoolId) {
      _pendingSave = false;
      pendingSyncs++;
      try {
        await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
          method: "POST",
          body: JSON.stringify({ database: cachedDatabase }),
          timeoutMs: 30000
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

  var _syncBadgeTimer = null;
  function showSyncBadge(status) {
    var badge = document.getElementById("sagarsoft-sync-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "sagarsoft-sync-badge";
      badge.style.cssText = "position:fixed;bottom:16px;right:16px;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;z-index:99999;transition:opacity 0.3s;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
      document.body.appendChild(badge);
    }
    if (status === "syncing") {
      badge.textContent = "Syncing...";
      badge.style.background = "#e3f2fd";
      badge.style.color = "#1976d2";
    } else if (status === "synced") {
      badge.textContent = "Synced";
      badge.style.background = "#e8f5e9";
      badge.style.color = "#2e7d32";
    } else if (status === "failed") {
      badge.textContent = "Sync failed";
      badge.style.background = "#fce4ec";
      badge.style.color = "#c62828";
    }
    badge.style.opacity = "1";
    if (_syncBadgeTimer) clearTimeout(_syncBadgeTimer);
    _syncBadgeTimer = setTimeout(function () { badge.style.opacity = "0"; }, 2500);
  }

  function scheduleServerSync() {
    if (_saveDbTimer) clearTimeout(_saveDbTimer);
    _pendingSave = true;
    showSyncBadge("syncing");
    _saveDbTimer = setTimeout(function () {
      _saveDbTimer = null;
      _pendingSave = false;
      var effectiveSchoolId = config.schoolId;
      if (!effectiveSchoolId) {
        try {
          effectiveSchoolId = localStorage.getItem(SCHOOL_ID_KEY) || "";
          if (effectiveSchoolId) config.schoolId = effectiveSchoolId;
        } catch (_e) {}
      }
      if (!config.apiBaseUrl || !effectiveSchoolId || !cachedDatabase) {
        console.warn("[SagarSoft Sync] Skipped: apiBaseUrl=" + !!config.apiBaseUrl + " schoolId=" + effectiveSchoolId + " db=" + !!cachedDatabase);
        showSyncBadge("failed");
        return;
      }
      var _session = null;
      try { _session = JSON.parse(sessionStorage.getItem("sagarsoft_session") || localStorage.getItem("sagarsoft_session") || "null"); } catch (_e) {}
      var _demoEmails = ["admin@sagarsoft.com","teacher@sagarsoft.com","student@sagarsoft.com","parent@sagarsoft.com"];
      var _isDemo = _session && _demoEmails.indexOf(String(_session.email || "").toLowerCase()) !== -1;
      if (_isDemo) { showSyncBadge("synced"); return; }
      pendingSyncs++;
      apiFetch("/api/database/" + encodeURIComponent(effectiveSchoolId), {
        method: "POST",
        body: JSON.stringify({ database: cachedDatabase }),
        timeoutMs: 30000
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

  function saveDatabaseImmediate(database, showIndicator) {
    cachedDatabase = normalizeDatabase(database);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedDatabase)); } catch (_e) {}
    if (database && database.generalSettings && database.generalSettings.licenseSettings) {
      var ls = database.generalSettings.licenseSettings;
      if (ls.schoolId) { config.schoolId = String(ls.schoolId); persistCredentials(ls.schoolId, ls.websiteApiKey || "", config.authToken || ""); }
      if (ls.websiteApiKey) config.apiKey = String(ls.websiteApiKey);
    }
    if (config.apiBaseUrl && config.schoolId) {
      var _session = null;
      try { _session = JSON.parse(sessionStorage.getItem("sagarsoft_session") || localStorage.getItem("sagarsoft_session") || "null"); } catch (_e) {}
      var _demoEmails = ["admin@sagarsoft.com","teacher@sagarsoft.com","student@sagarsoft.com","parent@sagarsoft.com"];
      var _isDemo = _session && _demoEmails.indexOf(String(_session.email || "").toLowerCase()) !== -1;
      if (_isDemo) return;
      if (showIndicator) showSyncBadge("syncing");
      pendingSyncs++;
      apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
        method: "POST",
        body: JSON.stringify({ database: cachedDatabase }),
        timeoutMs: 30000
      }).then(function () {
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        lastSyncFailed = false;
        if (showIndicator) showSyncBadge("synced");
      }).catch(function (err) {
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        if (showIndicator) showSyncBadge("failed");
        retrySyncLater(cachedDatabase, 0);
      });
    }
    return cachedDatabase;
  }

  function saveDatabase(database) {
    cachedDatabase = normalizeDatabase(database);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedDatabase)); } catch (_e) {}
    if (database && database.generalSettings && database.generalSettings.licenseSettings) {
      var ls = database.generalSettings.licenseSettings;
      if (ls.schoolId) {
        config.schoolId = String(ls.schoolId);
        persistCredentials(ls.schoolId, ls.websiteApiKey || "", config.authToken || "");
      }
      if (ls.websiteApiKey) config.apiKey = String(ls.websiteApiKey);
    }
    if (!config.schoolId) {
      try {
        var sid = localStorage.getItem(SCHOOL_ID_KEY);
        if (sid) config.schoolId = String(sid);
      } catch (_e) {}
    }
    if (config.apiBaseUrl && config.schoolId) {
      _pendingSave = true;
      flushPendingSync().catch(function () {});
    }
    return cachedDatabase;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", function () {
      if (_pendingSave && cachedDatabase && config.apiBaseUrl && config.schoolId) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", config.apiBaseUrl + "/api/database/" + encodeURIComponent(config.schoolId), false);
        xhr.setRequestHeader("Content-Type", "application/json");
        if (config.apiKey) xhr.setRequestHeader("x-sagarsoft-api-key", config.apiKey);
        if (config.authToken) xhr.setRequestHeader("Authorization", "Bearer " + config.authToken);
        try { xhr.send(JSON.stringify({ database: cachedDatabase })); } catch (_e) {}
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
    var showOverlay = opts && opts.showLoading !== false;
    if (showOverlay) showLoading("Loading data from server...");
    var attempts = 0;
    var maxAttempts = 3;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        var payload = await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), { timeoutMs: 30000 });
        if (payload && payload.database) {
          var db = normalizeDatabase(payload.database);
          cachedDatabase = db;
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (_e) {}
          hideLoading();
          window.dispatchEvent(new CustomEvent("sagarsoft:database-loaded", { detail: { source: "server" } }));
          return db;
        }
      } catch (_e) {
        if (attempts < maxAttempts) {
          await new Promise(function (r) { setTimeout(r, 3000); });
        }
      }
    }
    hideLoading();
    return null;
  }

  async function reloadDatabase() {
    cachedDatabase = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) {}
    return await loadDatabaseFromServer();
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
      loadDatabaseFromServer();
    }
  });

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

  loadDatabaseFromServer();

  function setSchoolId(schoolId) {
    if (schoolId) {
      config.schoolId = String(schoolId);
      persistCredentials(schoolId, config.apiKey, config.authToken);
    }
  }

  function setAuthToken(token) {
    if (token) {
      config.authToken = String(token);
      persistCredentials(config.schoolId, config.apiKey, token);
    }
  }

  function getConfig() {
    return { apiBaseUrl: config.apiBaseUrl, schoolId: config.schoolId, apiKey: config.apiKey, authToken: config.authToken };
  }

  function clearCache() {
    cachedDatabase = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) {}
    config.schoolId = localStorage.getItem(SCHOOL_ID_KEY) || "";
    config.apiKey = localStorage.getItem(API_KEY_KEY) || "";
    config.authToken = localStorage.getItem(TOKEN_KEY) || "";
  }

  function mergeArraysById(localArr, serverArr) {
    var merged = (serverArr || []).slice();
    (localArr || []).forEach(function (item) {
      if (!item || !item.id) return;
      var idx = merged.findIndex(function (s) { return s && s.id === item.id; });
      if (idx >= 0) {
        merged[idx] = item;
      } else {
        merged.push(item);
      }
    });
    return merged;
  }

  function removeDeletedFromArrays(obj, deletedIds) {
    if (!deletedIds || !deletedIds.length) return obj;
    var idSet = {};
    deletedIds.forEach(function (id) { idSet[String(id)] = true; });
    var arrKeys = ["employees","teachers","students","classes","subjects","attendance","fees","notices","events","activityLogs","smsTemplates","accountActivity","users"];
    arrKeys.forEach(function (key) {
      if (Array.isArray(obj[key])) {
        obj[key] = obj[key].filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
      }
    });
    if (obj.generalSettings) {
      var gsKeys = ["feeInvoices","feeCollections","salaryPayments","accountsLedger","exams","examMarks","timetableEntries","homework","classTests","classTestMarks","questionPapers","certificates"];
      gsKeys.forEach(function (key) {
        if (Array.isArray(obj.generalSettings[key])) {
          obj.generalSettings[key] = obj.generalSettings[key].filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
        }
      });
      if (Array.isArray(obj.generalSettings.timetableWeekdays)) {
        obj.generalSettings.timetableWeekdays = obj.generalSettings.timetableWeekdays.filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
      }
      if (Array.isArray(obj.generalSettings.timetablePeriods)) {
        obj.generalSettings.timetablePeriods = obj.generalSettings.timetablePeriods.filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
      }
      if (Array.isArray(obj.generalSettings.classRooms)) {
        obj.generalSettings.classRooms = obj.generalSettings.classRooms.filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
      }
      if (Array.isArray(obj.generalSettings.examSchedule)) {
        obj.generalSettings.examSchedule = obj.generalSettings.examSchedule.filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
      }
      if (Array.isArray(obj.generalSettings.questionChapters)) {
        obj.generalSettings.questionChapters = obj.generalSettings.questionChapters.filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
      }
      if (Array.isArray(obj.generalSettings.homeworkAssignments)) {
        obj.generalSettings.homeworkAssignments = obj.generalSettings.homeworkAssignments.filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
      }
      if (Array.isArray(obj.generalSettings.certificateTemplates)) {
        obj.generalSettings.certificateTemplates = obj.generalSettings.certificateTemplates.filter(function (item) { return !item || !item.id || !idSet[String(item.id)]; });
      }
    }
    return obj;
  }

  async function forceSave(database) {
    cachedDatabase = normalizeDatabase(database);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedDatabase)); } catch (_e) {}
    if (!config.schoolId) {
      try { var sid = localStorage.getItem(SCHOOL_ID_KEY); if (sid) config.schoolId = String(sid); } catch (_e) {}
    }
    if (!config.apiBaseUrl || !config.schoolId) return false;
    try {
      var deletedIds = cachedDatabase._deletedIds || [];
      var serverDb = null;
      try {
        var getResp = await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), { timeoutMs: 30000 });
        if (getResp && getResp.database) serverDb = getResp.database;
      } catch (_e) {}
      if (serverDb && serverDb._deletedIds && serverDb._deletedIds.length) {
        var serverIdSet = {};
        serverDb._deletedIds.forEach(function (id) { serverIdSet[String(id)] = true; });
        deletedIds.forEach(function (id) { serverIdSet[String(id)] = true; });
        deletedIds = Object.keys(serverIdSet);
      }

      var toSave = cachedDatabase;
      if (serverDb) {
        var merged = JSON.parse(JSON.stringify(serverDb));
        var arrKeys = ["employees","teachers","students","classes","subjects","attendance","fees","notices","events","activityLogs","smsTemplates","accountActivity"];
        arrKeys.forEach(function (key) {
          if (cachedDatabase[key] || merged[key]) {
            merged[key] = mergeArraysById(cachedDatabase[key], merged[key]);
          }
        });
        if (merged.generalSettings) {
          var gs = cachedDatabase.generalSettings || {};
          if (gs.feeInvoices || merged.generalSettings.feeInvoices) merged.generalSettings.feeInvoices = mergeArraysById(gs.feeInvoices, merged.generalSettings.feeInvoices);
          if (gs.feeCollections || merged.generalSettings.feeCollections) merged.generalSettings.feeCollections = mergeArraysById(gs.feeCollections, merged.generalSettings.feeCollections);
          if (gs.salaryPayments || merged.generalSettings.salaryPayments) merged.generalSettings.salaryPayments = mergeArraysById(gs.salaryPayments, merged.generalSettings.salaryPayments);
          if (gs.accountsLedger || merged.generalSettings.accountsLedger) merged.generalSettings.accountsLedger = mergeArraysById(gs.accountsLedger, merged.generalSettings.accountsLedger);
          if (gs.exams || merged.generalSettings.exams) merged.generalSettings.exams = mergeArraysById(gs.exams, merged.generalSettings.exams);
          if (gs.examMarks || merged.generalSettings.examMarks) merged.generalSettings.examMarks = mergeArraysById(gs.examMarks, merged.generalSettings.examMarks);
          if (gs.timetableEntries || merged.generalSettings.timetableEntries) merged.generalSettings.timetableEntries = mergeArraysById(gs.timetableEntries, merged.generalSettings.timetableEntries);
          if (gs.homework || merged.generalSettings.homework) merged.generalSettings.homework = mergeArraysById(gs.homework, merged.generalSettings.homework);
          if (gs.classTests || merged.generalSettings.classTests) merged.generalSettings.classTests = mergeArraysById(gs.classTests, merged.generalSettings.classTests);
          if (gs.classTestMarks || merged.generalSettings.classTestMarks) merged.generalSettings.classTestMarks = mergeArraysById(gs.classTestMarks, merged.generalSettings.classTestMarks);
          if (gs.questionPapers || merged.generalSettings.questionPapers) merged.generalSettings.questionPapers = mergeArraysById(gs.questionPapers, merged.generalSettings.questionPapers);
          if (gs.certificates || merged.generalSettings.certificates) merged.generalSettings.certificates = mergeArraysById(gs.certificates, merged.generalSettings.certificates);
          if (gs.instituteProfile) merged.generalSettings.instituteProfile = Object.assign(merged.generalSettings.instituteProfile || {}, gs.instituteProfile);
          if (gs.accountSettings) merged.generalSettings.accountSettings = Object.assign(merged.generalSettings.accountSettings || {}, gs.accountSettings);
        }
        if (cachedDatabase.users || merged.users) merged.users = mergeArraysById(cachedDatabase.users, merged.users);
        if (cachedDatabase.school) merged.school = Object.assign(merged.school || {}, cachedDatabase.school);
        if (cachedDatabase.settings) merged.settings = Object.assign(merged.settings || {}, cachedDatabase.settings);
        removeDeletedFromArrays(merged, deletedIds);
        toSave = merged;
      }

      toSave._deletedIds = deletedIds;
      cachedDatabase = normalizeDatabase(toSave);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedDatabase)); } catch (_e) {}
      await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
        method: "POST",
        body: JSON.stringify({ database: cachedDatabase }),
        timeoutMs: 60000
      });
      showSyncBadge("synced");
      return true;
    } catch (err) {
      showSyncBadge("failed");
      return false;
    }
  }

  window.SagarSoftDB = {
    getDatabase: getDatabase,
    saveDatabase: saveDatabase,
    saveDatabaseImmediate: saveDatabaseImmediate,
    flushPendingSync: flushPendingSync,
    updateDatabase: updateDatabase,
    loadDatabaseFromServer: loadDatabaseFromServer,
    reloadDatabase: reloadDatabase,
    flushRemoteSave: flushRemoteSave,
    clearCache: clearCache,
    setSchoolId: setSchoolId,
    setAuthToken: setAuthToken,
    getConfig: getConfig,
    defaultDatabase: defaultDatabase,
    isSyncPending: isSyncPending,
    isSyncFailed: isSyncFailed,
    retrySyncNow: retrySyncNow,
    preloadDatabaseForLogin: preloadDatabaseForLogin,
    showLoading: showLoading,
    hideLoading: hideLoading,
    cancelLoading: cancelLoading,
    showSyncBadge: showSyncBadge,
    forceSave: forceSave
  };
})();
