/* Major section: Authentication helpers and session management */
(function () {
  const SESSION_KEY = "sagarsoft_session";

  const DEMO_SNAPSHOT_KEY = "sagarsoft_demo_snapshot";
  const DEMO_EMAIL_SET = new Set(["admin@sagarsoft.com","teacher@sagarsoft.com","student@sagarsoft.com","parent@sagarsoft.com"]);

  const SA_EMAIL = "aleemsagar@gmail.com";


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
    try {
      if (window.SagarSoftDB && typeof window.SagarSoftDB.forceSyncBeforeLogout === "function") {
        window.SagarSoftDB.forceSyncBeforeLogout();
      }
    } catch (_e) {}
    clearSession();
  }

  function getApiBaseUrl() {
    var cfg = window.SagarSoftOnlineConfig || window.OnlineConfig;
    if (cfg && cfg.getApiBaseUrl) return cfg.getApiBaseUrl();
    if (cfg && cfg.apiBaseUrl) return cfg.apiBaseUrl;
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
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        return { success: false, message: data.message || "Invalid super admin credentials" };
      }
      if (data.success && data.user) {
        try {
          localStorage.removeItem("ss_school_id_persistent");
          localStorage.removeItem("ss_api_key_persistent");
          localStorage.removeItem("ss_auth_token");
        } catch (_e) {}
        if (window.SagarSoftDB && typeof window.SagarSoftDB.clearCache === "function") {
          window.SagarSoftDB.clearCache();
        }
        var session = { id: data.user.id || "USR-SUPER-001", name: data.user.name || "SagarSoft Super Admin", email: data.user.email || email, role: data.user.role || "superadmin", rememberMe: !!rememberMe, loginAt: new Date().toISOString(), serverToken: data.token || "" };
        if (rememberMe) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
        else { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
        window.__sagarSoftSession = session;
        return { success: true, message: data.message || "Super admin login successful", user: session };
      }
      return { success: false, message: data.message || "Invalid super admin credentials" };
    } catch (e) {
      console.error("Super admin login error:", e);
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
        var session = { id: userId, name: userName, email: email, role: (matchedUser && matchedUser.role) || "admin", rememberMe: !!rememberMe, loginAt: new Date().toISOString(), serverToken: data.license_token || "" };
        if (rememberMe) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
        else { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
        window.__sagarSoftSession = session;
        return { success: true, message: "Login successful.", user: session };
      }
      if (!resp.ok && data.message) {
        return { success: false, message: data.message };
      }
      return { success: false, message: data.message || "Login failed. Please try again." };
    } catch (e) {
      console.error("School login error:", e);
      return { success: false, message: "Server unreachable. Please try again." };
    }
  }

  async function loginWithOnlineFallback(email, password, role, rememberMe) {
    var normalizedRole = String(role || "").toLowerCase();
    var normalizedEmail = String(email || "").trim().toLowerCase();
    
    if (normalizedRole === "superadmin") {
      if (normalizedEmail === SA_EMAIL) {
        try {
          var superServerResult = await tryServerSuperAdminLogin(email, password, rememberMe);
          if (superServerResult.success) return superServerResult;
        } catch (e) {}
      }
      return await login(email, password, role, rememberMe);
    }

    if (normalizedRole === "admin") {
      if (normalizedEmail === SA_EMAIL) {
        try {
          var superServerResult = await tryServerSuperAdminLogin(email, password, rememberMe);
          if (superServerResult.success) return superServerResult;
        } catch (e) {}
      }
      if (!DEMO_EMAIL_SET.has(normalizedEmail)) {
        var serverResult = await tryServerAdminLogin(email, password, "admin", rememberMe);
        if (serverResult) return serverResult;
      }
      return await login(email, password, role, rememberMe);
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
    return (session && session.serverToken) || null;
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
