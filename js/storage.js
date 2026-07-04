(function () {
  var CACHE_KEY = "ss_db_cache";
  var STORAGE_KEY = "ss_db_local";
  var cachedDatabase = null;
  var config = { apiBaseUrl: "", schoolId: "", apiKey: "" };

  var cfg = window.SagarSoftOnlineConfig || {};
  if (cfg.apiBaseUrl) config.apiBaseUrl = String(cfg.apiBaseUrl).replace(/\/+$/, "");
  if (cfg.schoolId) config.schoolId = String(cfg.schoolId);
  if (cfg.apiKey) config.apiKey = String(cfg.apiKey);

  function updateConfigFromDatabase(db) {
    if (db && db.generalSettings && db.generalSettings.licenseSettings) {
      var ls = db.generalSettings.licenseSettings;
      if (ls.schoolId) config.schoolId = String(ls.schoolId);
      if (ls.websiteApiKey) config.apiKey = String(ls.websiteApiKey);
    }
  }

  function loadFromLocalStorage() {
    try {
      var local = localStorage.getItem(STORAGE_KEY);
      if (local) {
        var parsed = JSON.parse(local);
        if (parsed && parsed.school) {
          cachedDatabase = parsed;
          updateConfigFromDatabase(parsed);
          return true;
        }
      }
    } catch (_e) {}
    return false;
  }

  function loadFromSessionStorage() {
    try {
      var cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (parsed && parsed.school) {
          cachedDatabase = parsed;
          updateConfigFromDatabase(parsed);
          return true;
        }
      }
    } catch (_e) {}
    return false;
  }

  loadFromLocalStorage() || loadFromSessionStorage();

  function headers() {
    var h = { "Content-Type": "application/json" };
    if (config.apiKey) h["x-sagarsoft-api-key"] = config.apiKey;
    return h;
  }

  async function apiFetch(path, options) {
    if (!config.apiBaseUrl) throw new Error("API base URL not configured.");
    var response = await fetch(config.apiBaseUrl + path, Object.assign({
      headers: headers()
    }, options));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload.success) throw new Error(payload.message || "API request failed.");
    return payload;
  }

  function pickStudentField(student, keys, fallback) {
    const item = student || {};
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof item[key] !== "undefined" && item[key] !== null && String(item[key]).trim() !== "") {
        return item[key];
      }
    }
    return typeof fallback === "undefined" ? "" : fallback;
  }

  const defaultDatabase = {
    school: {
      name: "SagarSoft Public School",
      address: "Online Campus, Education City",
      phone: "+91 00000 00000",
      email: "info@sagarsoftschool.local",
      rulesRegulations: "1. Students must maintain discipline on campus.\n2. Attendance below 75% may affect exam eligibility.\n3. School fee must be paid on time.\n4. Parents should keep contact details updated.\n5. School property must be handled responsibly."
    },
    settings: {
      theme: "light",
      sidebarCollapsed: false
    },
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
      rulesAndRegulations: {
        students: "1. Students must maintain discipline on campus.\n2. Attendance below 75% may affect exam eligibility.\n3. School fee must be paid on time.",
        employees: "1. Employees must follow school timings.\n2. Professional conduct is required at all times.\n3. School policies must be strictly followed."
      },
      marksGrading: [
        { grade: "A+", from: 90, upto: 100, status: "Pass", required: true },
        { grade: "A", from: 80, upto: 89, status: "Pass", required: true },
        { grade: "B", from: 70, upto: 79, status: "Pass", required: true },
        { grade: "C", from: 60, upto: 69, status: "Pass", required: true },
        { grade: "D", from: 50, upto: 59, status: "Pass", required: false },
        { grade: "F", from: 0, upto: 49, status: "Fail", required: true }
      ],
      failCriteria: {
        overallPercent: 40,
        subjectPercent: 33,
        subjectCount: 1
      },
      themeLanguage: {
        placement: "LTR",
        sidebarBackground: "#08172f",
        headerBackground: "#ffffff",
        activeItemBackground: "#1e5eff",
        language: "English"
      },
      accountSettings: {
        username: "",
        password: "",
        timezone: "Asia/Karachi",
        currency: "PKR",
        symbol: "Rs",
        subscription: "",
        expiry: ""
      },
      licenseSettings: {
        schoolId: `SCH-${new Date().getFullYear()}-001`,
        schoolName: "SagarSoft Public School",
        activated: false,
        subscriptionPlan: "monthly",
        customDays: 30,
        startDate: "",
        expiryDate: "",
        status: "inactive",
        lastVerifiedAt: "",
        verificationIntervalDays: 9999,
        websiteEndpoint: "",
        websiteApiKey: "",
        lastServerResponse: ""
      },
      feeInvoices: [],
      feeCollections: [],
      salaryPayments: [],
      accountsLedger: [],
      certificateTemplates: [
        {
          id: "CRT-TPL-001",
          name: "School Leaving Certificate",
          body: "SCHOOL LEAVING CERTIFICATE\n\nThis is to certify that {{student_name}}, son/daughter of {{father_name}}, was a student of this institution. He/She was admitted on {{admission_date}} in class {{admitted_class}} and studied up to class {{last_class}}.\n\nAccording to the school record, his/her date of birth is {{dob}}.\n\nHe/She has left the school on {{leaving_date}}. His/Her conduct and behavior during his/her stay in the school was {{conduct}}.\n\nWe wish him/her every success in future.\n\nDate Issue: {{issue_date}}"
        },
        {
          id: "CRT-TPL-002",
          name: "Birth Certificate (School Record Based)",
          body: "BIRTH CERTIFICATE\n\nThis is to certify that {{student_name}}, son/daughter of {{father_name}}, is a student of this institution.\n\nAs per the school admission record, his/her date of birth is {{dob}}.\n\nHe/She was admitted to the school on {{admission_date}}.\n\nThis certificate is issued on the request of the student/guardian for official purposes.\n\nDate Issue: {{issue_date}}"
        }
      ]
    },
    users: [
      {
        id: "USR-SUPER-001",
        name: "SagarSoft Super Admin",
        email: "aleemsagar@gmail.com",
        password: "Google112233",
        role: "superadmin",
        phone: "+91 90000 00000",
        active: true
      }
    ],
    students: [],
    teachers: [],
    classes: [],
    subjects: [],
    attendance: [],
    fees: [],
    activityLogs: []
  };

  function normalizeDatabase(db) {
    if (!db) return structuredClone(defaultDatabase);
    if (!db.school) db.school = structuredClone(defaultDatabase.school);
    if (!db.school.rulesRegulations) db.school.rulesRegulations = defaultDatabase.school.rulesRegulations;
    if (!db.generalSettings) db.generalSettings = structuredClone(defaultDatabase.generalSettings);
    if (!db.generalSettings.instituteProfile) db.generalSettings.instituteProfile = structuredClone(defaultDatabase.generalSettings.instituteProfile);
    if (!db.generalSettings.feeParticulars) db.generalSettings.feeParticulars = {};
    if (!db.generalSettings.feeStructures) db.generalSettings.feeStructures = {};
    if (!Array.isArray(db.generalSettings.discountPolicies)) db.generalSettings.discountPolicies = [];
    if (!Array.isArray(db.generalSettings.bankAccounts)) db.generalSettings.bankAccounts = [];

    if (!Array.isArray(db.teachers)) db.teachers = [];
    db.teachers = db.teachers.map(function (teacher, index) {
      const defaultTeacher = {
        id: `TCH-MIG-${index + 1}`, name: "", subject: "", designation: "Teacher",
        role: "Teacher", phone: "", dateOfJoining: "", monthlySalary: 0,
        fatherOrHusbandName: "", nationalId: "", education: "", gender: "",
        religion: "", bloodGroup: "", experience: "", email: "", dateOfBirth: "",
        address: "", picture: "", status: "active"
      };
      const teacherStatus = String(teacher.status || "active").toLowerCase();
      const normalizedStatus = teacherStatus === "inactive" ? "inactive" : "active";
      return Object.assign({}, defaultTeacher, teacher, {
        status: normalizedStatus,
        designation: teacher.designation || teacher.role || "Teacher",
        role: teacher.role || "Teacher",
        dateOfJoining: teacher.dateOfJoining || "",
        monthlySalary: Number(teacher.monthlySalary || 0),
        fatherOrHusbandName: teacher.fatherOrHusbandName || "",
        nationalId: teacher.nationalId || "",
        education: teacher.education || "",
        gender: teacher.gender || "",
        religion: teacher.religion || "",
        bloodGroup: teacher.bloodGroup || "",
        experience: teacher.experience || "",
        email: teacher.email || "",
        dateOfBirth: teacher.dateOfBirth || "",
        address: teacher.address || "",
        picture: teacher.picture || ""
      });
    });

    if (!db.generalSettings.rulesAndRegulations) db.generalSettings.rulesAndRegulations = structuredClone(defaultDatabase.generalSettings.rulesAndRegulations);
    if (!Array.isArray(db.generalSettings.marksGrading)) db.generalSettings.marksGrading = structuredClone(defaultDatabase.generalSettings.marksGrading);
    if (!db.generalSettings.failCriteria) db.generalSettings.failCriteria = structuredClone(defaultDatabase.generalSettings.failCriteria);
    if (!db.generalSettings.themeLanguage) db.generalSettings.themeLanguage = structuredClone(defaultDatabase.generalSettings.themeLanguage);
    if (!db.generalSettings.accountSettings) db.generalSettings.accountSettings = structuredClone(defaultDatabase.generalSettings.accountSettings);

    if (db.generalSettings.accountSettings && db.generalSettings.accountSettings.symbol) {
      const symbol = String(db.generalSettings.accountSettings.symbol);
      if (/\d/.test(symbol) || symbol.length > 5) db.generalSettings.accountSettings.symbol = "Rs";
    }

    if (!db.generalSettings.licenseSettings) db.generalSettings.licenseSettings = structuredClone(defaultDatabase.generalSettings.licenseSettings);
    db.generalSettings.licenseSettings = Object.assign({}, defaultDatabase.generalSettings.licenseSettings, db.generalSettings.licenseSettings);
    if (!db.generalSettings.licenseSettings.schoolId) db.generalSettings.licenseSettings.schoolId = `SCH-${new Date().getFullYear()}-001`;
    if (!db.generalSettings.licenseSettings.schoolName) {
      db.generalSettings.licenseSettings.schoolName =
        (db.generalSettings.instituteProfile && db.generalSettings.instituteProfile.name) ||
        db.school.name || "SagarSoft Public School";
    }

    if (!Array.isArray(db.generalSettings.feeInvoices)) db.generalSettings.feeInvoices = [];
    if (!Array.isArray(db.generalSettings.feeCollections)) db.generalSettings.feeCollections = [];
    if (!Array.isArray(db.generalSettings.salaryPayments)) db.generalSettings.salaryPayments = [];
    if (!Array.isArray(db.generalSettings.accountsLedger)) db.generalSettings.accountsLedger = [];
    if (!Array.isArray(db.generalSettings.certificateTemplates)) db.generalSettings.certificateTemplates = structuredClone(defaultDatabase.generalSettings.certificateTemplates || []);

    db.generalSettings.accountsLedger = (db.generalSettings.accountsLedger || []).map(function (entry) {
      if (!entry || typeof entry !== "object") return null;
      return Object.assign({}, entry, { amount: Number(entry.amount || 0) });
    }).filter(function (entry) {
      return entry && entry.id && entry.date && entry.type && entry.category &&
        Number.isFinite(entry.amount);
    });

    if (!Array.isArray(db.users)) db.users = [];
    const superUser = db.users.find(function (user) { return user.id === "USR-SUPER-001"; });
    if (!superUser) {
      db.users.push(structuredClone(defaultDatabase.users[0]));
    } else {
      if (!superUser.name) superUser.name = "SagarSoft Super Admin";
      if (!superUser.role) superUser.role = "superadmin";
      if (typeof superUser.active === "undefined") superUser.active = true;
      if (!superUser.email) superUser.email = "aleemsagar@gmail.com";
      if (!superUser.password) superUser.password = "Google112233";
    }

    if (!Array.isArray(db.students)) db.students = [];
    db.students = db.students.filter(function (s) { return s && typeof s === "object"; }).map(function (student, index) {
      const defaultStudent = {};
      const fallbackId = student.id || `STU-MIG-${index + 1}`;
      const statusValue = String(pickStudentField(student, ["status"], "active")).toLowerCase();
      const normalizedStatus = statusValue === "inactive" ? "inactive" : "active";
      return Object.assign({}, defaultStudent, student, {
        id: String(pickStudentField(student, ["id", "studentId"], fallbackId)),
        admissionNo: String(pickStudentField(student, ["admissionNo", "rollNo", "registrationNo", "rollNumber"], defaultStudent.admissionNo || "")),
        name: String(pickStudentField(student, ["name", "studentName", "fullName"], defaultStudent.name || "")),
        picture: String(pickStudentField(student, ["picture", "photo", "profilePicture", "avatar"], student.picture || "")),
        className: String(pickStudentField(student, ["className", "class", "classTitle"], defaultStudent.className || "")),
        section: String(pickStudentField(student, ["section", "classSection"], defaultStudent.section || "")),
        dateOfAdmission: String(pickStudentField(student, ["dateOfAdmission", "admissionDate"], student.dateOfAdmission || "")),
        discountInFee: String(pickStudentField(student, ["discountInFee"], student.discountInFee || "")),
        dateOfBirth: String(pickStudentField(student, ["dateOfBirth", "dob"], student.dateOfBirth || "")),
        gender: String(pickStudentField(student, ["gender"], student.gender || "")),
        bloodGroup: String(pickStudentField(student, ["bloodGroup"], student.bloodGroup || "")),
        diseaseInfo: String(pickStudentField(student, ["diseaseInfo", "disease"], student.diseaseInfo || "")),
        birthId: String(pickStudentField(student, ["birthId", "bForm", "nic"], student.birthId || "")),
        previousSchool: String(pickStudentField(student, ["previousSchool"], student.previousSchool || "")),
        previousId: String(pickStudentField(student, ["previousId", "previousBoardRollNo"], student.previousId || "")),
        orphanStatus: String(pickStudentField(student, ["orphanStatus"], student.orphanStatus || "")),
        religion: String(pickStudentField(student, ["religion"], student.religion || "")),
        address: String(pickStudentField(student, ["address", "homeAddress"], student.address || "")),
        phone: String(pickStudentField(student, ["phone", "mobile", "mobileNo"], student.phone || "")),
        fatherName: String(pickStudentField(student, ["fatherName", "guardianName", "father"], student.fatherName || "")),
        fatherEducation: String(pickStudentField(student, ["fatherEducation"], student.fatherEducation || "")),
        fatherNationalId: String(pickStudentField(student, ["fatherNationalId"], student.fatherNationalId || "")),
        fatherPhone: String(pickStudentField(student, ["fatherPhone"], student.fatherPhone || "")),
        fatherOccupation: String(pickStudentField(student, ["fatherOccupation"], student.fatherOccupation || "")),
        fatherIncome: String(pickStudentField(student, ["fatherIncome"], student.fatherIncome || "")),
        motherName: String(pickStudentField(student, ["motherName"], student.motherName || "")),
        motherEducation: String(pickStudentField(student, ["motherEducation"], student.motherEducation || "")),
        motherNationalId: String(pickStudentField(student, ["motherNationalId"], student.motherNationalId || "")),
        motherPhone: String(pickStudentField(student, ["motherPhone"], student.motherPhone || "")),
        motherOccupation: String(pickStudentField(student, ["motherOccupation"], student.motherOccupation || "")),
        status: normalizedStatus
      });
    });

    if (!Array.isArray(db.classes)) db.classes = [];
    db.classes = db.classes.map(function (classItem) {
      return Object.assign({}, classItem, {
        monthlyTuitionFees: Number(classItem.monthlyTuitionFees || classItem.monthlyFees || 0),
        classTeacher: classItem.classTeacher || classItem.teacherId || ""
      });
    });

    if (!Array.isArray(db.attendance)) db.attendance = [];
    if (!Array.isArray(db.subjects)) db.subjects = [];
    if (!Array.isArray(db.activityLogs)) db.activityLogs = [];
    if (!Array.isArray(db.fees)) db.fees = [];
    db.fees = db.fees.map(function (feeItem) {
      return Object.assign({}, feeItem, {
        month: feeItem.month || feeItem.feeMonth || "",
        feeMonth: feeItem.feeMonth || feeItem.month || "",
        date: feeItem.date || "",
        dueDate: feeItem.dueDate || "",
        fineAfterDueDate: Number(feeItem.fineAfterDueDate || 0),
        particulars: Array.isArray(feeItem.particulars) ? feeItem.particulars : [],
        totalAmount: Number(feeItem.totalAmount || feeItem.amount || 0),
        deposit: Number(feeItem.deposit || (feeItem.status === "paid" ? feeItem.amount || 0 : 0)),
        remaining: Number(feeItem.remaining || (feeItem.status === "paid" ? 0 : feeItem.amount || 0)),
        paymentDate: feeItem.paymentDate || "",
        bankId: feeItem.bankId || ""
      });
    });

    var changed = false;
    if (!db.__demoCleanupV2Done) {
      changed = true;
      const demoUserEmails = new Set(["admin@sagarsoft.com","teacher@sagarsoft.com","student@sagarsoft.com","parent@sagarsoft.com","rohan.teacher@sagarsoft.com"]);
      db.users = (db.users || []).filter(function (user) {
        var uid = String((user && user.id) || "");
        var email = String((user && user.email) || "").trim().toLowerCase();
        if (uid === "USR-SUPER-001") return true;
        return !demoUserEmails.has(email);
      });
      const demoTeacherIds = new Set(["TCH-001","TCH-002"]);
      db.teachers = (db.teachers || []).filter(function (t) { return !demoTeacherIds.has(String((t && t.id) || "")); });
      const demoStudentIds = new Set(["STU-001","STU-002","STU-003"]);
      db.students = (db.students || []).filter(function (s) { return !demoStudentIds.has(String((s && s.id) || "")); });
      const demoClassIds = new Set(["CLS-001","CLS-002","CLS-003"]);
      db.classes = (db.classes || []).filter(function (c) { return !demoClassIds.has(String((c && c.id) || "")); });
      const demoSubjectIds = new Set(["SUB-001","SUB-002","SUB-003"]);
      db.subjects = (db.subjects || []).filter(function (s) { return !demoSubjectIds.has(String((s && s.id) || "")); });
      db.attendance = Array.isArray(db.attendance) ? db.attendance.filter(function (item) { return !/^ATT-00[1-3]$/i.test(String((item && item.id) || "")); }) : [];
      db.fees = Array.isArray(db.fees) ? db.fees.filter(function (item) { return !/^FEE-00[1-3]$/i.test(String((item && item.id) || "")); }) : [];
      db.activityLogs = Array.isArray(db.activityLogs) ? db.activityLogs.filter(function (entry) {
        return String((entry && entry.title) || "").toLowerCase() !== "system initialized";
      }) : [];
      db.__demoCleanupV2Done = true;
    }

    return db;
  }

  function getDatabase() {
    if (cachedDatabase) return structuredClone(cachedDatabase);
    return structuredClone(defaultDatabase);
  }

  function saveDatabase(database) {
    cachedDatabase = database;
    updateConfigFromDatabase(database);
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(database)); } catch (_e) {}
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(database)); } catch (_e) {}
    if (config.apiBaseUrl && config.schoolId) {
      apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
        method: "POST",
        body: JSON.stringify({ database: database })
      }).catch(function (err) { console.warn("Failed to sync database to server:", err); });
    }
    return database;
  }

  function updateDatabase(updater) {
    var database = getDatabase();
    var updatedDatabase = updater(structuredClone(database));
    return saveDatabase(updatedDatabase);
  }

  async function loadDatabaseFromServer() {
    if (!config.apiBaseUrl || !config.schoolId) return null;
    try {
      var payload = await apiFetch("/api/database/" + encodeURIComponent(config.schoolId));
      if (payload && payload.database) {
        var db = normalizeDatabase(payload.database);
        cachedDatabase = db;
        updateConfigFromDatabase(db);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(db)); } catch (_e) {}
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (_e) {}
        window.dispatchEvent(new CustomEvent("sagarsoft:database-loaded", { detail: { source: "online" } }));
        return db;
      }
    } catch (_e) {}
    return null;
  }

  async function reloadDatabase() {
    cachedDatabase = null;
    try { sessionStorage.removeItem(CACHE_KEY); } catch (_e) {}
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) {}
    return await loadDatabaseFromServer();
  }

  async function flushRemoteSave() {
    if (cachedDatabase && config.apiBaseUrl && config.schoolId) {
      try {
        await apiFetch("/api/database/" + encodeURIComponent(config.schoolId), {
          method: "POST",
          body: JSON.stringify({ database: cachedDatabase })
        });
      } catch (_e) {}
    }
  }

  loadDatabaseFromServer();

  function setSchoolId(schoolId) {
    if (schoolId) config.schoolId = String(schoolId);
  }

  function getConfig() {
    return { apiBaseUrl: config.apiBaseUrl, schoolId: config.schoolId, apiKey: config.apiKey };
  }

  function clearCache() {
    cachedDatabase = null;
    try { sessionStorage.removeItem(CACHE_KEY); } catch (_e) {}
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) {}
    config.schoolId = cfg.schoolId || "";
    config.apiKey = cfg.apiKey || "";
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
    getConfig: getConfig,
    defaultDatabase: defaultDatabase
  };
})();
