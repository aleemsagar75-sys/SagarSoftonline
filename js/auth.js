/* Major section: Authentication helpers and session management */
(function () {
  const SESSION_KEY = "sagarsoft_session";
  const DEFAULT_PORTAL_URL = (window.SagarSoftOnlineConfig && window.SagarSoftOnlineConfig.apiBaseUrl) || "https://sagarsoftonline.onrender.com";

  const DEMO_SNAPSHOT_KEY = "sagarsoft_demo_snapshot";
  const DEMO_EMAIL_SET = new Set(["admin@sagarsoft.com","teacher@sagarsoft.com","student@sagarsoft.com","parent@sagarsoft.com"]);

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
    if (user && user.password && !window.SagarSoftCrypto.isHash(user.password)) {
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
          window.SagarSoftDB.saveDatabase(database);

          var session = {
            id: "USR-ADMIN-001",
            name: accountSettings.schoolName || "School Admin",
            email: configuredUsername,
            role: "admin",
            rememberMe: Boolean(rememberMe),
            loginAt: new Date().toISOString()
          };
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

    var demoAccounts = [
      { id: "USR-ADMIN-DEMO", name: "School Admin", email: "admin@sagarsoft.com", password: "demo_admin_password", role: "admin", phone: "+92 300 0000000", active: true },
      { id: "USR-TEACHER-DEMO", name: "Demo Teacher", email: "teacher@sagarsoft.com", password: "demo_teacher_password", role: "teacher", phone: "+92 300 0000001", active: true },
      { id: "USR-STUDENT-DEMO", name: "Demo Student", email: "student@sagarsoft.com", password: "demo_student_password", role: "student", phone: "+92 300 0000002", active: true },
      { id: "USR-PARENT-DEMO", name: "Demo Parent", email: "parent@sagarsoft.com", password: "demo_parent_password", role: "parent", phone: "+92 300 0000003", active: true }
    ];
    demoAccounts.forEach(function (demoUser) {
      var exists = database.users.some(function (u) { return u && String(u.email || "").trim().toLowerCase() === demoUser.email; });
      if (!exists) {
        database.users.push(demoUser);
      }
    });
    window.SagarSoftDB.saveDatabase(database);

    var user = null;
    for (var i = 0; i < database.users.length; i++) {
      var entry = database.users[i];
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

    if (!window.SagarSoftCrypto.isHash(user.password)) {
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

    saveSession(session);

    window.SagarSoftDB.updateDatabase(function (databaseSnapshot) {
      databaseSnapshot.activityLogs.unshift({
        id: "ACT-" + Date.now(),
        title: user.role + " login",
        description: user.name + " signed in successfully.",
        createdAt: new Date().toISOString()
      });
      return databaseSnapshot;
    });

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

  async function loginWithOnlineFallback(email, password, role, rememberMe) {
    var normalizedRole = String(role || "").toLowerCase();
    
    if (normalizedRole === "admin" || normalizedRole === "superadmin") {
      var result = await login(email, password, role, rememberMe);
      if (result.success) return result;
      if (normalizedRole === "admin") {
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
    const rawSession = sessionStorage.getItem(SESSION_KEY);

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
