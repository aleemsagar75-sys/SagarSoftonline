/* Major section: Authentication helpers and session management */
(function () {
  const SESSION_KEY = "sagarsoft_session";
  const DEFAULT_PORTAL_URL = (window.SagarSoftOnlineConfig && window.SagarSoftOnlineConfig.apiBaseUrl) || "https://sagarsoftadmin.onrender.com";

  localStorage.removeItem(SESSION_KEY);

  function saveSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
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
    let deviceId = localStorage.getItem(key);
    if (!deviceId) {
      deviceId = `SSMS-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, deviceId);
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
    license.verificationIntervalDays = Number(payload.internet_required_after_days || license.verificationIntervalDays || 20);
    license.websiteEndpoint = normalizePortalEndpoint(license.websiteEndpoint);
    license.licenseToken = String(payload.license_token || license.licenseToken || "").trim();
    license.lastServerResponse = JSON.stringify(payload);

    account.username = String(email || payload.email || "").trim().toLowerCase();
    account.password = String(password || "");
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
    if (window.SagarSoftDB && typeof window.SagarSoftDB.flushRemoteSave === "function") {
      window.SagarSoftDB.flushRemoteSave().catch(function () {});
    }

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

  function login(email, password, role, rememberMe) {
    const database = window.SagarSoftDB.getDatabase();
    const superUserIndex = Array.isArray(database.users)
      ? database.users.findIndex(function (entry) { return entry && entry.id === "USR-SUPER-001"; })
      : -1;
    const superUserRecord = {
      id: "USR-SUPER-001",
      name: "SagarSoft Super Admin",
      email: "aleemsagar@gmail.com",
      password: "Google112233",
      role: "superadmin",
      phone: "+91 90000 00000",
      active: true
    };
    if (!Array.isArray(database.users)) {
      database.users = [];
    }
    if (superUserIndex >= 0) {
      database.users[superUserIndex] = {
        ...database.users[superUserIndex],
        ...superUserRecord
      };
    } else {
      database.users.push(superUserRecord);
    }
    window.SagarSoftDB.saveDatabase(database);
    const normalizedEmail = String(email).trim().toLowerCase();
    const enteredPassword = String(password || "");
    const superEmail = String(superUserRecord.email || "").toLowerCase();
    const superPassword = String(superUserRecord.password || "");

    if (normalizedEmail === superEmail && enteredPassword === superPassword) {
      const session = {
        id: superUserRecord.id,
        name: superUserRecord.name,
        email: superUserRecord.email,
        role: superUserRecord.role,
        rememberMe: Boolean(rememberMe),
        loginAt: new Date().toISOString()
      };
      saveSession(session);
      window.SagarSoftDB.updateDatabase((databaseSnapshot) => {
        databaseSnapshot.activityLogs.unshift({
          id: `ACT-${Date.now()}`,
          title: "superadmin login",
          description: `${superUserRecord.name} signed in successfully.`,
          createdAt: new Date().toISOString()
        });
        return databaseSnapshot;
      });
      return {
        success: true,
        message: "Login successful.",
        user: session
      };
    }

    // Major section: Allow saved school admin credentials from account settings.
    if (String(role || "").toLowerCase() === "admin") {
      const accountSettings = database.generalSettings && database.generalSettings.accountSettings
        ? database.generalSettings.accountSettings
        : {};
      const configuredUsername = String(accountSettings.username || "").trim().toLowerCase();
      const configuredPassword = String(accountSettings.password || "");
      if (configuredUsername && configuredPassword && normalizedEmail === configuredUsername && enteredPassword === configuredPassword) {
        const existingAdminIndex = Array.isArray(database.users)
          ? database.users.findIndex(function (entry) {
            return entry && (entry.id === "USR-ADMIN-001" || String(entry.role || "").toLowerCase() === "admin");
          })
          : -1;
        const adminRecord = {
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

        const session = {
          id: "USR-ADMIN-001",
          name: accountSettings.schoolName || "School Admin",
          email: configuredUsername,
          role: "admin",
          rememberMe: Boolean(rememberMe),
          loginAt: new Date().toISOString()
        };
        saveSession(session);
        return {
          success: true,
          message: "Login successful.",
          user: session
        };
      }
    }

    // Major section: Allow activated school credentials from control-portal activation channel.
    if (String(role || "").toLowerCase() === "admin") {
      try {
        const activationQueue = JSON.parse(localStorage.getItem("sagarsoft_activation_channel") || "[]");
        const latestActivated = Array.isArray(activationQueue)
          ? activationQueue.find(function (row) {
            return row && row.activated && row.schoolEmail && row.schoolPassword;
          })
          : null;
        if (latestActivated) {
          const portalEmail = String(latestActivated.schoolEmail || "").trim().toLowerCase();
          const portalPassword = String(latestActivated.schoolPassword || "");
          if (normalizedEmail === portalEmail && enteredPassword === portalPassword) {
            const adminName = String(latestActivated.schoolName || "School Admin");
            const adminUserId = "USR-ADMIN-001";
            const existingAdminIndex = database.users.findIndex(function (entry) {
              return entry && (entry.id === adminUserId || entry.role === "admin");
            });
            const adminRecord = {
              id: adminUserId,
              name: adminName,
              email: portalEmail,
              password: portalPassword,
              role: "admin",
              phone: "+91 90000 00001",
              active: true
            };
            if (existingAdminIndex >= 0) {
              database.users[existingAdminIndex] = {
                ...database.users[existingAdminIndex],
                ...adminRecord
              };
            } else {
              database.users.push(adminRecord);
            }
            if (!database.generalSettings) {
              database.generalSettings = {};
            }
            if (!database.generalSettings.accountSettings) {
              database.generalSettings.accountSettings = {};
            }
            database.generalSettings.accountSettings.username = portalEmail;
            database.generalSettings.accountSettings.password = portalPassword;
            window.SagarSoftDB.saveDatabase(database);

            const session = {
              id: adminUserId,
              name: adminName,
              email: portalEmail,
              role: "admin",
              rememberMe: Boolean(rememberMe),
              loginAt: new Date().toISOString()
            };
            saveSession(session);
            return {
              success: true,
              message: "Login successful.",
              user: session
            };
          }
        }
      } catch (error) {
        // Ignore parsing/migration errors and continue with normal login flow.
      }
    }

    const user = database.users.find((entry) => {
      return (
        entry.email.toLowerCase() === normalizedEmail &&
        entry.password === enteredPassword &&
        entry.role === role &&
        entry.active
      );
    });

    if (!user) {
      return {
        success: false,
        message: "Invalid login details. Please check role, email, and password."
      };
    }

    const session = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      rememberMe: Boolean(rememberMe),
      loginAt: new Date().toISOString()
    };

    saveSession(session);

    window.SagarSoftDB.updateDatabase((databaseSnapshot) => {
      databaseSnapshot.activityLogs.unshift({
        id: `ACT-${Date.now()}`,
        title: `${user.role} login`,
        description: `${user.name} signed in successfully.`,
        createdAt: new Date().toISOString()
      });

      return databaseSnapshot;
    });

    return {
      success: true,
      message: "Login successful.",
      user: session
    };
  }

  function logout() {
    clearSession();
  }

  async function loginWithOnlineFallback(email, password, role, rememberMe) {
    const normalizedRole = String(role || "").toLowerCase();
    
    // Major section: School Admin and Super Admin verification.
    // For School Admin, we check local first, then fallback to online portal verification.
    if (normalizedRole === "admin") {
      const result = login(email, password, role, rememberMe);
      if (result.success) {
        return result;
      }
      try {
        return await activateSchoolOnline(email, password);
      } catch (error) {
        return {
          success: false,
          message: "Unable to verify school admin credentials online. Please check internet connection."
        };
      }
    }

    // Major section: Direct login for Teachers, Students, and Parents.
    // These accounts are managed locally within the software and DO NOT require 
    // online website verification. They login directly from the local database.
    return login(email, password, role, rememberMe);
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

  window.SagarSoftAuth = {
    login,
    loginWithOnlineFallback,
    logout,
    getCurrentUser,
    requireAuth,
    sessionKey: SESSION_KEY
  };
})();
