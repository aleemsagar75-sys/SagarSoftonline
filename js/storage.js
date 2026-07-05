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

  async function apiFetch(path, options) {
    if (!config.apiBaseUrl) throw new Error("API base URL not configured.");
    var controller = new AbortController();
    var timeoutMs = (options && options.timeoutMs) || 90000;
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
        timeoutMs: 90000
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
      { id: "USR-SUPER-001", name: "SagarSoft Super Admin", email: "aleemsagar@gmail.com", password: "", role: "superadmin", phone: "", active: true },
      { id: "USR-ADMIN-DEMO", name: "School Admin", email: "admin@sagarsoft.com", password: "admin123", role: "admin", phone: "+92 300 0000000", active: true },
      { id: "USR-TEACHER-DEMO", name: "Demo Teacher", email: "teacher@sagarsoft.com", password: "teacher123", role: "teacher", phone: "+92 300 0000001", active: true },
      { id: "USR-STUDENT-DEMO", name: "Demo Student", email: "student@sagarsoft.com", password: "student123", role: "student", phone: "+92 300 0000002", active: true },
      { id: "USR-PARENT-DEMO", name: "Demo Parent", email: "parent@sagarsoft.com", password: "parent123", role: "parent", phone: "+92 300 0000003", active: true }
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
    if (overlay) { overlay.style.display = "flex"; }
    if (label) { label.textContent = text || "Saving data..."; }
  }

  function hideLoading() {
    var overlay = document.getElementById("sagarsoft-loading-overlay");
    if (overlay) { overlay.style.display = "none"; }
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
    if (config.apiBaseUrl && config.schoolId) {
      pendingSyncs++;
      showLoading("Saving data to server...");
      apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
        method: "POST",
        body: JSON.stringify({ database: cachedDatabase }),
        timeoutMs: 90000
      }).then(function () {
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        lastSyncFailed = false;
        hideLoading();
      }).catch(function (err) {
        console.warn("Server sync failed, retrying:", err);
        pendingSyncs = Math.max(0, pendingSyncs - 1);
        hideLoading();
        retrySyncLater(cachedDatabase, 0);
      });
    }
    return cachedDatabase;
  }

  function updateDatabase(updater) {
    var database = getDatabase();
    var updatedDatabase = updater(structuredClone(database));
    return saveDatabase(updatedDatabase);
  }

  async function loadDatabaseFromServer() {
    if (!config.apiBaseUrl || !config.schoolId) return null;
    showLoading("Loading data from server...");
    var attempts = 0;
    var maxAttempts = 3;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        var payload = await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), { timeoutMs: 90000 });
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
          timeoutMs: 90000
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

  window.SagarSoftDB = {
    getDatabase: getDatabase,
    saveDatabase: saveDatabase,
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
    hideLoading: hideLoading
  };
})();
