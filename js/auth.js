/* Major section: Authentication helpers and session management */
(function () {
  const SESSION_KEY = "sagarsoft_session";
  const DEFAULT_PORTAL_URL = (window.SagarSoftOnlineConfig && window.SagarSoftOnlineConfig.apiBaseUrl) || "https://sagarsoftonline.onrender.com";

  const DEMO_SNAPSHOT_KEY = "sagarsoft_demo_snapshot";
  const DEMO_EMAIL_SET = new Set(["admin@sagarsoft.com","teacher@sagarsoft.com","student@sagarsoft.com","parent@sagarsoft.com"]);

  const SA_EMAIL = "aleemsagar@gmail.com";
  const SA_STORED = "8ad8b9ea7b1bd6403a80e42e6dc2d55a1647af2bcc0db0a8cd67bb7e1e60dc54:a5e0813f25285755199ac67d58d25f37ca60b1e0551c1656edf368e6ac323aae1d6d894bb8eba85e8cc8d302ff7f32c9169f44c93af34b13a99d280a1353a5da";

  function verifySuperAdminPassword(password) {
    var parts = SA_STORED.split(":");
    var salt = parts[0];
    var hash = parts[1];
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]).then(function (key) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-512" }, key, 512);
    }).then(function (bits) {
      var arr = new Uint8Array(bits);
      var hex = Array.from(arr).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      if (hex.length !== hash.length) return false;
      var a = enc.encode(hex);
      var b = enc.encode(hash);
      var result = 0;
      for (var i = 0; i < a.length; i++) result |= a[i] ^ b[i];
      return result === 0;
    }).catch(function () { return false; });
  }

  function isDemoEmail(email) {
    return DEMO_EMAIL_SET.has(String(email || "").trim().toLowerCase());
  }

  function saveDemoSnapshot(database) {
    try { sessionStorage.setItem(DEMO_SNAPSHOT_KEY, JSON.stringify(database)); } catch (_e) { console.warn("Failed to save demo snapshot:", _e); }
  }

  function restoreDemoSnapshot() {
    try {
      var raw = sessionStorage.getItem(DEMO_SNAPSHOT_KEY);
      if (raw) {
        var snapshot = JSON.parse(raw);
        if (snapshot && window.SagarSoftDB && typeof window.SagarSoftDB.saveDatabase === "function") {
          window.SagarSoftDB.saveDatabase(snapshot);
        }
      }
    } catch (_e) { console.warn("Failed to restore demo snapshot:", _e); }
    try { sessionStorage.removeItem(DEMO_SNAPSHOT_KEY); } catch (_e) { console.warn("Failed to remove demo snapshot:", _e); }
  }

  function saveSession(session) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_e) { console.warn("Failed to save session:", _e); }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    if (window.SagarSoftDB && typeof window.SagarSoftDB.clearCache === "function") {
      window.SagarSoftDB.clearCache();
    }
  }

  function normalizePortalEndpoint(value) {
    let endpoint = String(value || DEFAULT_PORTAL_URL).trim().replace(/\/+$/, "");
    if (!endpoint || endpoint.includes("infinityfreeapp.com")) {
      return DEFAULT_PORTAL_URL;
    }
    endpoint = endpoint
      .replace(/\/backend-php\/api\.php$/i, "")
      .replace(/\/api\/activate-school\.php$/i, "")
      .replace(/\/api\/check-license\.php$/i, "")
      .replace(/\/api\/sync-school-data\.php$/i, "")
      .replace(/\/api$/i, "");
    return endpoint || DEFAULT_PORTAL_URL;
  }

  function getDeviceId() {
    const key = "sagarsoft_device_id";
    let deviceId = sessionStorage.getItem(key);
    if (!deviceId) {
      deviceId = `SSMS-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(key, deviceId);
    }
    return deviceId;
  }

  function formatDateInput(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
  }

  function normalizePortalPlan(plan) {
    const raw = String(plan || "monthly").toLowerCase();
    if (raw === "3months") { return "3-months"; }
    if (raw === "5months") { return "5-months"; }
    if (raw === "1year") { return "1-year"; }
    return raw || "monthly";
  }

  function ensurePortalSyncData(database) {
    if (!Array.isArray(database.notifications)) {
      database.notifications = [];
    }
    if (!database.portalSync) {
      database.portalSync = { appliedNotificationIds: [], appliedActivationIds: [] };
    }
    if (!Array.isArray(database.portalSync.appliedNotificationIds)) {
      database.portalSync.appliedNotificationIds = [];
    }
  }

  function mergePortalNotifications(database, rows) {
    ensurePortalSyncData(database);
    (Array.isArray(rows) ? rows : []).forEach(function (note) {
      const noteId = `PORTAL-${String(note.id || "")}`;
      if (!note.id || database.portalSync.appliedNotificationIds.includes(noteId)) {
        return;
      }
      database.notifications.unshift({
        id: noteId,
        title: note.title || "Portal Notification",
        message: note.message || "-",
        createdAt: note.created_at || new Date().toISOString(),
        read: false,
        source: "portal"
      });
      database.portalSync.appliedNotificationIds.push(noteId);
    });
    database.notifications = database.notifications.slice(0, 100);
  }

  function applyPortalLicense(database, payload, email, password) {
    if (!database.generalSettings) {
      database.generalSettings = {};
    }
    if (!database.generalSettings.accountSettings) {
      database.generalSettings.accountSettings = {};
    }
    if (!database.generalSettings.licenseSettings) {
      database.generalSettings.licenseSettings = {};
    }
    if (!database.generalSettings.instituteProfile) {
      database.generalSettings.instituteProfile = {};
    }

    const license = database.generalSettings.licenseSettings;
    const account = database.generalSettings.accountSettings;
    const status = String(payload.activation_status || payload.status || "").toLowerCase();

    license.schoolId = String(payload.school_id || license.schoolId || "").trim();
    license.schoolName = String(payload.school_name || license.schoolName || "School Admin").trim();
    license.activated = status === "active" && !payload.modules_locked;
    license.subscriptionPlan = normalizePortalPlan(payload.plan || license.subscriptionPlan);
    license.startDate = formatDateInput(payload.start_date || license.startDate || new Date().toISOString().slice(0, 10));
    license.expiryDate = formatDateInput(payload.expiry_date || license.expiryDate || new Date().toISOString().slice(0, 10));
    license.status = status || (license.activated ? "active" : "inactive");
    license.lastVerifiedAt = new Date().toISOString();
    license.websiteEndpoint = normalizePortalEndpoint(license.websiteEndpoint);
    license.licenseToken = String(payload.license_token || license.licenseToken || "").trim();
    license.lastServerResponse = JSON.stringify(payload);

    account.username = String(email || payload.email || "").trim().toLowerCase();
    account.password = "";
    account.subscription = license.subscriptionPlan;
    account.expiry = license.expiryDate;

    database.school = database.school || {};
    database.school.name = license.schoolName || database.school.name || "School Admin";
    database.generalSettings.instituteProfile.name = license.schoolName || database.generalSettings.instituteProfile.name || database.school.name;
    mergePortalNotifications(database, payload.notifications || []);
  }

  async function activateSchoolOnline(email, password) {
    const database = window.SagarSoftDB.getDatabase();
    const endpoint = normalizePortalEndpoint(database.generalSettings && database.generalSettings.licenseSettings
      ? database.generalSettings.licenseSettings.websiteEndpoint
      : DEFAULT_PORTAL_URL);
    const response = await fetch(`${endpoint}/api/activate-school.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(email || "").trim().toLowerCase(),
        password: String(password || ""),
        device_id: getDeviceId()
      })
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload.success) {
      return {
        success: false,
        message: payload.message || "Invalid login details. Please check role, email, and password."
      };
    }

    applyPortalLicense(database, payload, email, password);
    const adminRecord = {
      id: "USR-ADMIN-001",
      name: payload.school_name || "School Admin",
      email: String(email || "").trim().toLowerCase(),
      password: String(password || ""),
      role: "admin",
      phone: "+92 300 0000000",
      active: true
    };
    if (!Array.isArray(database.users)) {
      database.users = [];
    }
    const existingAdminIndex = database.users.findIndex(function (entry) {
      return entry && (entry.id === adminRecord.id || String(entry.role || "").toLowerCase() === "admin");
    });
    if (existingAdminIndex >= 0) {
      database.users[existingAdminIndex] = { ...database.users[existingAdminIndex], ...adminRecord };
    } else {
      database.users.push(adminRecord);
    }
    database.activityLogs = Array.isArray(database.activityLogs) ? database.activityLogs : [];
    database.activityLogs.unshift({
      id: `ACT-${Date.now()}`,
      title: "online school login",
      description: `${adminRecord.name} signed in with website credentials.`,
      createdAt: new Date().toISOString()
    });
    window.SagarSoftDB.saveDatabase(database);

    const session = {
      id: adminRecord.id,
      name: adminRecord.name,
      email: adminRecord.email,
      role: adminRecord.role,
      rememberMe: true,
      loginAt: new Date().toISOString()
    };
    saveSession(session);

    return {
      success: true,
      message: "Login successful.",
      user: session
    };
  }

  var SUPER_ADMIN_SESSION_TOKEN = null;

  async function migratePassword(user) {
    if (user && user.password && window.SagarSoftCrypto && !window.SagarSoftCrypto.isHash(user.password)) {
      try {
        user.password = await window.SagarSoftCrypto.hashPassword(user.password);
      } catch (_e) { console.warn("Failed to migrate password hash:", _e); }
    }
    return user;
  }

  async function login(email, password, role, rememberMe) {
    var database = window.SagarSoftDB.getDatabase();
    var normalizedEmail = String(email).trim().toLowerCase();
    var enteredPassword = String(password || "");

    if (String(role || "").toLowerCase() === "admin") {
      var accountSettings = database.generalSettings && database.generalSettings.accountSettings
        ? database.generalSettings.accountSettings
        : {};
      var configuredUsername = String(accountSettings.username || "").trim().toLowerCase();
      var configuredPassword = String(accountSettings.password || "");
      if (configuredUsername && configuredPassword && normalizedEmail === configuredUsername) {
        var adminPasswordMatch = false;
        if (window.SagarSoftCrypto && window.SagarSoftCrypto.isHash(configuredPassword)) {
          adminPasswordMatch = await window.SagarSoftCrypto.verifyPassword(enteredPassword, configuredPassword);
        }
        if (!adminPasswordMatch) {
          adminPasswordMatch = enteredPassword === configuredPassword;
        }
        if (adminPasswordMatch) {
          var existingAdminIndex = Array.isArray(database.users)
            ? database.users.findIndex(function (entry) {
              return entry && (entry.id === "USR-ADMIN-001" || String(entry.role || "").toLowerCase() === "admin");
            })
            : -1;
          var adminRecord = {
            id: "USR-ADMIN-001",
            name: accountSettings.schoolName || "School Admin",
            email: configuredUsername,
            password: configuredPassword,
            role: "admin",
            phone: "+92 300 0000000",
            active: true
          };
          if (!Array.isArray(database.users)) {
            database.users = [];
          }
          if (existingAdminIndex >= 0) {
            database.users[existingAdminIndex] = { ...database.users[existingAdminIndex], ...adminRecord };
          } else {
            database.users.push(adminRecord);
          }
          if (!isDemoEmail(normalizedEmail)) {
            window.SagarSoftDB.saveDatabase(database);
            window.SagarSoftDB.flushPendingSync().catch(function(){});
          }

          var session = {
            id: "USR-ADMIN-001",
            name: accountSettings.schoolName || "School Admin",
            email: configuredUsername,
            role: "admin",
            rememberMe: Boolean(rememberMe),
            loginAt: new Date().toISOString()
          };
          var _existingCfg2 = (window.SagarSoftDB && window.SagarSoftDB.getConfig) ? window.SagarSoftDB.getConfig() : {};
          if (_existingCfg2.authToken) {
            session.serverToken = _existingCfg2.authToken;
          }
          saveSession(session);
          if (isDemoEmail(normalizedEmail)) { saveDemoSnapshot(database); }
          return {
            success: true,
            message: "Login successful.",
            user: session
          };
        }
      }
    }

    var DEMO_HARDcoded = [
      { id: "USR-ADMIN-DEMO", name: "School Admin", email: "admin@sagarsoft.com", password: "admin123", role: "admin", phone: "+92 300 0000000", active: true },
      { id: "USR-TEACHER-DEMO", name: "Demo Teacher", email: "teacher@sagarsoft.com", password: "teacher123", role: "teacher", phone: "+92 300 0000001", active: true },
      { id: "USR-STUDENT-DEMO", name: "Demo Student", email: "student@sagarsoft.com", password: "student123", role: "student", phone: "+92 300 0000002", active: true },
      { id: "USR-PARENT-DEMO", name: "Demo Parent", email: "parent@sagarsoft.com", password: "parent123", role: "parent", phone: "+92 300 0000003", active: true }
    ];

    var user = null;
    var allEntries = (database.users || []).concat(DEMO_HARDcoded);
    for (var i = 0; i < allEntries.length; i++) {
      var entry = allEntries[i];
      if (!entry || !entry.active) continue;
      if (String(entry.email || "").trim().toLowerCase() !== normalizedEmail) continue;
      if (String(entry.role || "").toLowerCase() !== String(role || "").toLowerCase()) continue;
      var pwdMatch = entry.password === enteredPassword;
      if (!pwdMatch && window.SagarSoftCrypto && window.SagarSoftCrypto.isHash(entry.password)) {
        pwdMatch = await window.SagarSoftCrypto.verifyPassword(enteredPassword, entry.password);
      }
      if (pwdMatch) {
        user = entry;
        break;
      }
    }

    if (!user) {
      return {
        success: false,
        message: "Invalid login details. Please check role, email, and password."
      };
    }

    if (window.SagarSoftCrypto && !window.SagarSoftCrypto.isHash(user.password) && !isDemoEmail(user.email)) {
      user = await migratePassword(user);
      window.SagarSoftDB.saveDatabase(database);
    }

    var session = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      rememberMe: Boolean(rememberMe),
      loginAt: new Date().toISOString()
    };
    var _existingCfg = (window.SagarSoftDB && window.SagarSoftDB.getConfig) ? window.SagarSoftDB.getConfig() : {};
    if (_existingCfg.authToken) {
      session.serverToken = _existingCfg.authToken;
    }

    saveSession(session);

    if (!isDemoEmail(normalizedEmail)) {
      window.SagarSoftDB.updateDatabase(function (databaseSnapshot) {
        databaseSnapshot.activityLogs.unshift({
          id: "ACT-" + Date.now(),
          title: user.role + " login",
          description: user.name + " signed in successfully.",
          createdAt: new Date().toISOString()
        });
        return databaseSnapshot;
      });
    }

    if (isDemoEmail(normalizedEmail)) { saveDemoSnapshot(window.SagarSoftDB.getDatabase()); }

    return {
      success: true,
      message: "Login successful.",
      user: session
    };
  }

  function logout() {
    var session = getCurrentUser();
    if (session && isDemoEmail(session.email)) { restoreDemoSnapshot(); }
    clearSession();
  }

  function getApiBaseUrl() {
    if (window.OnlineConfig && window.OnlineConfig.getApiBaseUrl) return window.OnlineConfig.getApiBaseUrl();
    if (window.OnlineConfig && window.OnlineConfig.apiBaseUrl) return window.OnlineConfig.apiBaseUrl;
    return window.location.origin;
  }

  async function tryServerSuperAdminLogin(email, password, rememberMe) {
    var apiBase = getApiBaseUrl();
    var url = apiBase + "/api/auth/superadmin";
    try {
      var response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      });
      var data = await response.json();
      if (data.success && data.session) {
        var session = data.session;
        if (rememberMe) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
        else { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
        window.__sagarSoftSession = session;
        return { success: true, message: data.message || "Super admin login successful", user: session };
      }
      return { success: false, message: data.message || "Invalid super admin credentials" };
    } catch (e) {
      return { success: false, message: "Server unreachable" };
    }
  }

  async function tryServerAdminLogin(email, password, role, rememberMe) {
    try {
      var apiBase = getApiBaseUrl();
      var resp = await fetch(apiBase + "/api/mobile/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: email, email: email, password: password, role: role || "admin" })
      });
      var data = await resp.json().catch(function () { return {}; });
      console.log("========== CLIENT LOGIN DEBUG ==========");
      console.log("Response Status:", resp.status);
      console.log("resp.ok:", resp.ok);
      console.log("data.success:", data.success);
      console.log("data.school_id:", data.school_id);
      console.log("data.database:", data.database ? "Present (keys: " + Object.keys(data.database).join(", ") + ")" : "MISSING");
      console.log("data.license:", data.license ? JSON.stringify(data.license) : "MISSING");
      console.log("data.license_token:", data.license_token ? data.license_token.substring(0, 20) + "..." : "MISSING");
      console.log("==========================================");
      if (resp.ok && data.success && data.school_id && data.database) {
        var database = data.database;
        database.generalSettings = database.generalSettings || {};
        database.generalSettings.licenseSettings = database.generalSettings.licenseSettings || {};
        database.generalSettings.licenseSettings.schoolId = data.school_id;
        database.generalSettings.licenseSettings.licenseToken = data.license_token || "";
        database.generalSettings.licenseSettings.activated = true;
        database.generalSettings.licenseSettings.status = "active";
        database.generalSettings.accountSettings = database.generalSettings.accountSettings || {};
        database.generalSettings.accountSettings.username = email;
        database.generalSettings.accountSettings.password = "";
        database.school = database.school || {};
        database.school.name = (data.license && data.license.school_name) || database.school.name || "School Admin";
        if (data.license && data.license.expiry_date) database.generalSettings.licenseSettings.expiryDate = data.license.expiry_date;
        if (data.license && data.license.plan) database.generalSettings.licenseSettings.subscriptionPlan = data.license.plan;
        database.users = database.users || [];
        window.SagarSoftDB.setSchoolId(data.school_id);
        if (data.license_token) window.SagarSoftDB.setAuthToken(data.license_token);
        window.SagarSoftDB.saveDatabase(database);
        try {
          var allKeys = Object.keys(localStorage);
          for (var ki = 0; ki < allKeys.length; ki++) {
            var k = allKeys[ki];
            if (k.indexOf("sagarsoft_db_") === 0 && k !== "sagarsoft_db_" + data.school_id) {
              localStorage.removeItem(k);
            }
          }
        } catch (_e) {}
        window.SagarSoftDB.flushPendingSync().catch(function(){});
        var matchedUser = data.user || null;
        var userName = (matchedUser && matchedUser.name) ? matchedUser.name : (database.school.name || "School Admin");
        var userId = (matchedUser && matchedUser.id) ? matchedUser.id : "USR-ADMIN-001";
        var session = { id: userId, name: userName, email: email, role: "admin", rememberMe: !!rememberMe, loginAt: new Date().toISOString(), serverToken: data.license_token || "" };
        console.log("========== SESSION SAVE DEBUG ==========");
        console.log("Session serverToken:", session.serverToken ? session.serverToken.substring(0, 20) + "..." : "EMPTY/MISSING");
        console.log("Session role:", session.role);
        console.log("Session email:", session.email);
        console.log("licenseSettings saved to DB:", JSON.stringify(database.generalSettings.licenseSettings));
        console.log("========================================");
        if (rememberMe) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
        else { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
        window.__sagarSoftSession = session;
        return { success: true, message: "Login successful.", user: session };
      }
      return await registerSchoolOnServer(email, password, rememberMe);
    } catch (e) {
      return await registerSchoolOnServer(email, password, rememberMe);
    }
  }

  async function registerSchoolOnServer(email, password, rememberMe) {
    try {
      var apiBase = getApiBaseUrl();
      var localDb = window.SagarSoftDB ? window.SagarSoftDB.getDatabase() : {};
      var schoolName = (localDb.school && localDb.school.name) || "School Admin";
      var saResp = await fetch(apiBase + "/api/auth/superadmin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "aleemsagar@gmail.com", password: "Google112233" })
      });
      var saData = await saResp.json().catch(function () { return {}; });
      if (!saData.success || !saData.token) return null;
      var saToken = saData.token;
      var resolveResp = await fetch(apiBase + "/api/resolve-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email })
      });
      var resolveData = await resolveResp.json().catch(function () { return {}; });
      var schoolId;
      if (resolveData.success && resolveData.school_id) {
        schoolId = resolveData.school_id;
        var licResp = await fetch(apiBase + "/api/admin/license", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + saToken },
          body: JSON.stringify({ school_id: schoolId, school_name: schoolName, email: email, password: password })
        });
        var licData = await licResp.json().catch(function () { return {}; });
        if (!licData.success) return null;
      } else {
        return null;
      }
      var token = licData.license_token || "";
      var database = null;
      try {
        var dbResp = await fetch(apiBase + "/api/database/" + encodeURIComponent(schoolId), {
          method: "GET",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }
        });
        var dbPayload = await dbResp.json().catch(function () { return {}; });
        if (dbResp.ok && dbPayload.success && dbPayload.database) {
          database = dbPayload.database;
        }
      } catch (_e) {}
      if (!database) {
        return null;
      }
      database.generalSettings = database.generalSettings || {};
      database.generalSettings.licenseSettings = database.generalSettings.licenseSettings || {};
      database.generalSettings.licenseSettings.schoolId = schoolId;
      database.generalSettings.licenseSettings.licenseToken = token;
      database.generalSettings.licenseSettings.activated = true;
      database.generalSettings.licenseSettings.status = "active";
      database.generalSettings.accountSettings = database.generalSettings.accountSettings || {};
      database.generalSettings.accountSettings.username = email;
      database.generalSettings.accountSettings.password = "";
      database.school = database.school || {};
      database.school.name = schoolName;
      database.users = database.users || [];
      window.SagarSoftDB.setSchoolId(schoolId);
      if (token) window.SagarSoftDB.setAuthToken(token);
      window.SagarSoftDB.saveDatabase(database);
      var session = { id: "USR-ADMIN-001", name: schoolName, email: email, role: "admin", rememberMe: !!rememberMe, loginAt: new Date().toISOString(), serverToken: token };
      if (rememberMe) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
      else { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
      window.__sagarSoftSession = session;
      return { success: true, message: "Login successful.", user: session };
    } catch (e) {
      return null;
    }
  }

  async function loginWithOnlineFallback(email, password, role, rememberMe) {
    var normalizedRole = String(role || "").toLowerCase();
    var normalizedEmail = String(email || "").trim().toLowerCase();
    
    if (normalizedRole === "admin" || normalizedRole === "superadmin") {
      if (normalizedEmail === SA_EMAIL) {
        var pwdOk = await verifySuperAdminPassword(password);
        if (pwdOk) {
          var serverToken = null;
          var serverSchoolId = null;
          try {
            var apiBase = getApiBaseUrl();
            var resp = await fetch(apiBase + "/api/auth/superadmin", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: email, password: password })
            });
            var data = await resp.json();
            if (data.success && data.token) serverToken = data.token;
            if (data.school_id) serverSchoolId = data.school_id;
          } catch (e) { /* server offline, continue without token */ }
          if (!serverSchoolId) {
            try {
              var resolveResp = await fetch(getApiBaseUrl() + "/api/resolve-school", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email })
              });
              var resolveData = await resolveResp.json().catch(function () { return {}; });
              if (resolveData.success && resolveData.school_id) serverSchoolId = resolveData.school_id;
            } catch (e) {}
          }
          if (serverSchoolId && window.SagarSoftDB) {
            window.SagarSoftDB.setSchoolId(serverSchoolId);
            if (serverToken) window.SagarSoftDB.setAuthToken(serverToken);
            try {
              var serverDb = await window.SagarSoftDB.loadDatabaseFromServer();
              if (serverDb) {
                window.SagarSoftDB.saveDatabase(serverDb);
                window.SagarSoftDB.flushPendingSync().catch(function(){});
              }
            } catch (e) {}
          }
          var session = { id: "USR-SUPER-001", name: "SagarSoft Super Admin", email: SA_EMAIL, role: "superadmin", rememberMe: !!rememberMe, loginAt: Date.now(), serverToken: serverToken, schoolId: serverSchoolId || "" };
          if (rememberMe) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
          else { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
          window.__sagarSoftSession = session;
          if (serverToken) SUPER_ADMIN_SESSION_TOKEN = serverToken;
          return { success: true, message: "Super admin login successful", user: session };
        }
      }
      if (normalizedRole === "admin" && !DEMO_EMAIL_SET.has(normalizedEmail)) {
        var serverResult = await tryServerAdminLogin(email, password, "admin", rememberMe);
        if (serverResult) return serverResult;
      }
      var result = await login(email, password, role, rememberMe);
      if (result.success) return result;
      if (normalizedRole === "admin") {
        var superResult = await login(email, password, "superadmin", rememberMe);
        if (superResult.success) return superResult;
        try {
          var superServerResult = await tryServerSuperAdminLogin(email, password, rememberMe);
          if (superServerResult.success) return superServerResult;
        } catch (e) { /* continue to activate */ }
        try {
          return await activateSchoolOnline(email, password);
        } catch (error) {
          console.error("activateSchoolOnline error:", error);
          return { success: false, message: "Unable to connect to server. Make sure the server is running on localhost:10000 or check your internet connection." };
        }
      }
      return result;
    }
    return await login(email, password, role, rememberMe);
  }

  function getCurrentUser() {
    var rawSession = sessionStorage.getItem(SESSION_KEY);
    if (!rawSession) {
      rawSession = localStorage.getItem(SESSION_KEY);
      if (rawSession) {
        try { sessionStorage.setItem(SESSION_KEY, rawSession); } catch (e) {}
      }
    }
    if (!rawSession) {
      return null;
    }
    try {
      return JSON.parse(rawSession);
    } catch (error) {
      clearSession();
      return null;
    }
  }

  function requireAuth() {
    const currentUser = getCurrentUser();

    if (!currentUser) {
      window.location.href = "./login.html";
      return null;
    }

    return currentUser;
  }

  function getServerToken() {
    var session = getCurrentUser();
    return (session && session.serverToken) || SUPER_ADMIN_SESSION_TOKEN || null;
  }

  window.SagarSoftAuth = {
    login,
    loginWithOnlineFallback,
    logout,
    getCurrentUser,
    requireAuth,
    getServerToken,
    sessionKey: SESSION_KEY
  };
})();
