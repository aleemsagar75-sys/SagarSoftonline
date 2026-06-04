/* Major section: LocalStorage database helpers and production seed data */
(function () {
  const DB_KEY = "sagarsoft_db";
  const REMOTE_PENDING_KEY = "sagarsoft_db_remote_pending";
  const REMOTE_DIRTY_AT_KEY = "sagarsoft_db_remote_dirty_at";
  const REMOTE_LAST_SYNC_KEY = "sagarsoft_db_remote_last_sync_at";
  const REMOTE_LAST_ERROR_KEY = "sagarsoft_db_remote_last_error";
  let remoteLoadStarted = false;
  let remoteLoadSchoolId = "";
  let remoteSaveTimer = null;
  
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
      address: "Offline Campus, Education City",
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
        address: "Offline Campus, Education City",
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
        verificationIntervalDays: 25,
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

  function getOnlineConfig() {
    const config = window.SagarSoftOnlineConfig || {};
    let databaseSchoolId = "";
    try {
      const localDatabase = JSON.parse(localStorage.getItem(DB_KEY) || "{}");
      databaseSchoolId = String(
        localDatabase &&
        localDatabase.generalSettings &&
        localDatabase.generalSettings.licenseSettings &&
        localDatabase.generalSettings.licenseSettings.schoolId
          ? localDatabase.generalSettings.licenseSettings.schoolId
          : ""
      ).trim();
    } catch (_error) {}
    return {
      apiBaseUrl: String(config.apiBaseUrl || "").trim().replace(/\/+$/, ""),
      apiKey: String(config.apiKey || "").trim(),
      schoolId: String(databaseSchoolId || config.schoolId || "SCH-2026-001").trim()
    };
  }

  function onlineHeaders() {
    const config = getOnlineConfig();
    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers["x-sagarsoft-api-key"] = config.apiKey;
    }
    return headers;
  }

  async function fetchRemoteDatabase() {
    const config = getOnlineConfig();
    if (!config.apiBaseUrl) {
      return null;
    }
    const response = await fetch(`${config.apiBaseUrl}/api/database/${encodeURIComponent(config.schoolId)}`, {
      headers: onlineHeaders()
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Unable to load online database.");
    }
    return payload.database || null;
  }

  async function pushRemoteDatabase(database) {
    const config = getOnlineConfig();
    if (!config.apiBaseUrl) {
      return;
    }
    const response = await fetch(`${config.apiBaseUrl}/api/database/${encodeURIComponent(config.schoolId)}`, {
      method: "POST",
      headers: onlineHeaders(),
      body: JSON.stringify({ database: database || {} })
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Unable to save online database.");
    }
    localStorage.removeItem(REMOTE_PENDING_KEY);
    localStorage.removeItem(REMOTE_DIRTY_AT_KEY);
    localStorage.removeItem(REMOTE_LAST_ERROR_KEY);
    localStorage.setItem(REMOTE_LAST_SYNC_KEY, new Date().toISOString());
  }

  function loadRemoteDatabaseInBackground() {
    const config = getOnlineConfig();
    if (!config.apiBaseUrl) {
      return;
    }
    if (remoteLoadSchoolId !== config.schoolId) {
      remoteLoadStarted = false;
      remoteLoadSchoolId = config.schoolId;
      localStorage.removeItem(REMOTE_PENDING_KEY);
      localStorage.removeItem(REMOTE_DIRTY_AT_KEY);
    }
    if (remoteLoadStarted) {
      return;
    }
    remoteLoadStarted = true;
    const pendingSnapshot = localStorage.getItem(REMOTE_PENDING_KEY);
    if (pendingSnapshot) {
      try {
        pushRemoteDatabase(JSON.parse(pendingSnapshot)).catch(function (error) {
          localStorage.setItem(REMOTE_LAST_ERROR_KEY, String(error && error.message ? error.message : error));
        });
      } catch (error) {
        localStorage.setItem(REMOTE_LAST_ERROR_KEY, String(error && error.message ? error.message : error));
      }
      return;
    }
    fetchRemoteDatabase().then(function (remoteDatabase) {
      if (!remoteDatabase) {
        const localSnapshot = localStorage.getItem(DB_KEY);
        if (localSnapshot) {
          pushRemoteDatabase(JSON.parse(localSnapshot)).catch(function () {});
        }
        return;
      }
      localStorage.setItem(DB_KEY, JSON.stringify(remoteDatabase));
      window.dispatchEvent(new CustomEvent("sagarsoft:database-loaded", { detail: { source: "online" } }));
    }).catch(function () {});
  }

  function scheduleRemoteSave(database) {
    const config = getOnlineConfig();
    if (!config.apiBaseUrl) {
      return;
    }
    let snapshot = "{}";
    try {
      snapshot = JSON.stringify(database || {});
      localStorage.setItem(REMOTE_PENDING_KEY, snapshot);
      localStorage.setItem(REMOTE_DIRTY_AT_KEY, new Date().toISOString());
      localStorage.removeItem(REMOTE_LAST_ERROR_KEY);
    } catch (error) {
      localStorage.setItem(REMOTE_LAST_ERROR_KEY, String(error && error.message ? error.message : error));
      return;
    }
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = setTimeout(function () {
      pushRemoteDatabase(JSON.parse(snapshot)).catch(function (error) {
        localStorage.setItem(REMOTE_LAST_ERROR_KEY, String(error && error.message ? error.message : error));
      });
    }, 60);
  }

  window.addEventListener("beforeunload", function () {
    const pendingSnapshot = localStorage.getItem(REMOTE_PENDING_KEY);
    const config = getOnlineConfig();
    if (!pendingSnapshot || !config.apiBaseUrl) {
      return;
    }
    try {
      fetch(`${config.apiBaseUrl}/api/database/${encodeURIComponent(config.schoolId)}`, {
        method: "POST",
        headers: onlineHeaders(),
        body: JSON.stringify({ database: JSON.parse(pendingSnapshot) }),
        keepalive: true
      }).catch(function () {});
    } catch (_error) {}
  });

  function getDatabase() {
    loadRemoteDatabaseInBackground();
    const savedData = localStorage.getItem(DB_KEY);

    if (!savedData) {
      localStorage.setItem(DB_KEY, JSON.stringify(defaultDatabase));
      return structuredClone(defaultDatabase);
    }

    try {
      const parsedData = JSON.parse(savedData);

      // Major section: Light schema migration for older saved databases.
      if (!parsedData.school) {
        parsedData.school = structuredClone(defaultDatabase.school);
      }

      if (!parsedData.school.rulesRegulations) {
        parsedData.school.rulesRegulations = defaultDatabase.school.rulesRegulations;
      }

      if (!parsedData.generalSettings) {
        parsedData.generalSettings = structuredClone(defaultDatabase.generalSettings);
      }

      if (!parsedData.generalSettings.instituteProfile) {
        parsedData.generalSettings.instituteProfile = structuredClone(defaultDatabase.generalSettings.instituteProfile);
      }

      if (!parsedData.generalSettings.feeParticulars) {
        parsedData.generalSettings.feeParticulars = {};
      }

      if (!parsedData.generalSettings.feeStructures) {
        parsedData.generalSettings.feeStructures = {};
      }

      if (!Array.isArray(parsedData.generalSettings.discountPolicies)) {
        parsedData.generalSettings.discountPolicies = [];
      }

      if (!Array.isArray(parsedData.generalSettings.bankAccounts)) {
        parsedData.generalSettings.bankAccounts = [];
      }

      if (!Array.isArray(parsedData.teachers)) {
        parsedData.teachers = [];
      }

      parsedData.teachers = parsedData.teachers.map(function (teacher, index) {
        const defaultTeacher = {
          id: `TCH-MIG-${index + 1}`,
          name: "",
          subject: "",
          designation: "Teacher",
          role: "Teacher",
          phone: "",
          dateOfJoining: "",
          monthlySalary: 0,
          fatherOrHusbandName: "",
          nationalId: "",
          education: "",
          gender: "",
          religion: "",
          bloodGroup: "",
          experience: "",
          email: "",
          dateOfBirth: "",
          address: "",
          picture: "",
          status: "active"
        };
        const teacherStatus = String(teacher.status || "active").toLowerCase();
        const normalizedStatus = teacherStatus === "inactive" ? "inactive" : "active";

        return {
          ...defaultTeacher,
          ...teacher,
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
        };
      });

      if (!parsedData.generalSettings.rulesAndRegulations) {
        parsedData.generalSettings.rulesAndRegulations = structuredClone(defaultDatabase.generalSettings.rulesAndRegulations);
      }

      if (!Array.isArray(parsedData.generalSettings.marksGrading)) {
        parsedData.generalSettings.marksGrading = structuredClone(defaultDatabase.generalSettings.marksGrading);
      }

      if (!parsedData.generalSettings.failCriteria) {
        parsedData.generalSettings.failCriteria = structuredClone(defaultDatabase.generalSettings.failCriteria);
      }

      if (!parsedData.generalSettings.themeLanguage) {
        parsedData.generalSettings.themeLanguage = structuredClone(defaultDatabase.generalSettings.themeLanguage);
      }

      if (!parsedData.generalSettings.accountSettings) {
        parsedData.generalSettings.accountSettings = structuredClone(defaultDatabase.generalSettings.accountSettings);
      }

      // Clean corrupted currency symbol (remove if it contains numbers or is malformed)
      if (parsedData.generalSettings.accountSettings && parsedData.generalSettings.accountSettings.symbol) {
        const symbol = String(parsedData.generalSettings.accountSettings.symbol);
        // If symbol contains numbers or is too long, reset to default "Rs"
        if (/\d/.test(symbol) || symbol.length > 5) {
          parsedData.generalSettings.accountSettings.symbol = "Rs";
        }
      }

      if (!parsedData.generalSettings.licenseSettings) {
        parsedData.generalSettings.licenseSettings = structuredClone(defaultDatabase.generalSettings.licenseSettings);
      }

      parsedData.generalSettings.licenseSettings = {
        ...defaultDatabase.generalSettings.licenseSettings,
        ...parsedData.generalSettings.licenseSettings
      };

      if (!parsedData.generalSettings.licenseSettings.schoolId) {
        parsedData.generalSettings.licenseSettings.schoolId = `SCH-${new Date().getFullYear()}-001`;
      }

      if (!parsedData.generalSettings.licenseSettings.schoolName) {
        parsedData.generalSettings.licenseSettings.schoolName =
          (parsedData.generalSettings.instituteProfile && parsedData.generalSettings.instituteProfile.name) ||
          parsedData.school.name ||
          "SagarSoft Public School";
      }

      if (!Array.isArray(parsedData.generalSettings.feeInvoices)) {
        parsedData.generalSettings.feeInvoices = [];
      }

      if (!Array.isArray(parsedData.generalSettings.feeCollections)) {
        parsedData.generalSettings.feeCollections = [];
      }

      if (!Array.isArray(parsedData.generalSettings.salaryPayments)) {
        parsedData.generalSettings.salaryPayments = [];
      }

      // Ensure accountsLedger exists and is an array
      if (!Array.isArray(parsedData.generalSettings.accountsLedger)) {
        parsedData.generalSettings.accountsLedger = [];
      }

      // Ensure certificateTemplates exists and is an array
      if (!Array.isArray(parsedData.generalSettings.certificateTemplates)) {
        parsedData.generalSettings.certificateTemplates = structuredClone(defaultDatabase.generalSettings.certificateTemplates || []);
      }

      // Clean corrupted accountsLedger entries (check for "1000 0" or similar invalid data)
      parsedData.generalSettings.accountsLedger = (parsedData.generalSettings.accountsLedger || []).map(function (entry) {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        return {
          ...entry,
          amount: Number(entry.amount || 0)
        };
      }).filter(function (entry) {
        return entry &&
               entry.id &&
               entry.date &&
               entry.type &&
               entry.category &&
               Number.isFinite(entry.amount) &&
               entry.amount >= 0;
      });

      if (!Array.isArray(parsedData.users)) {
        parsedData.users = [];
      }

      // Ensure super admin is present
      const superUser = parsedData.users.find(function (user) {
        return user.id === "USR-SUPER-001";
      });
      if (!superUser) {
        parsedData.users.push(structuredClone(defaultDatabase.users[0]));
      } else {
        superUser.name = "SagarSoft Super Admin";
        superUser.role = "superadmin";
        superUser.active = true;
        superUser.email = "aleemsagar@gmail.com";
        superUser.password = "Google112233";
      }

      if (!Array.isArray(parsedData.students)) {
        parsedData.students = [];
      }

      parsedData.students = parsedData.students
        .filter(function (student) {
          return student && typeof student === "object";
        })
        .map(function (student, index) {
          const defaultStudent = {};
          const fallbackId = student.id || `STU-MIG-${index + 1}`;
          const statusValue = String(pickStudentField(student, ["status"], "active")).toLowerCase();
          const normalizedStatus = statusValue === "inactive" ? "inactive" : "active";
          return {
            ...defaultStudent,
            ...student,
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
          };
        });

      if (!Array.isArray(parsedData.fees)) {
        parsedData.fees = [];
      }

      parsedData.fees = parsedData.fees.map(function (feeItem) {
        return {
          ...feeItem,
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
        };
      });

      // Major section: one-time cleanup for legacy demo/testing dataset.
      if (!parsedData.__demoCleanupV2Done) {
        const demoUserEmails = new Set([
          "admin@sagarsoft.com",
          "teacher@sagarsoft.com",
          "student@sagarsoft.com",
          "parent@sagarsoft.com",
          "rohan.teacher@sagarsoft.com"
        ]);
        parsedData.users = (parsedData.users || []).filter(function (user) {
          const userId = String((user && user.id) || "");
          const email = String((user && user.email) || "").trim().toLowerCase();
          if (userId === "USR-SUPER-001") {
            return true;
          }
          return !demoUserEmails.has(email);
        });

        const demoTeacherIds = new Set(["TCH-001", "TCH-002"]);
        parsedData.teachers = (parsedData.teachers || []).filter(function (teacher) {
          const id = String((teacher && teacher.id) || "");
          return !demoTeacherIds.has(id);
        });

        const demoStudentIds = new Set(["STU-001", "STU-002", "STU-003"]);
        parsedData.students = (parsedData.students || []).filter(function (student) {
          const id = String((student && student.id) || "");
          return !demoStudentIds.has(id);
        });

        const demoClassIds = new Set(["CLS-001", "CLS-002", "CLS-003"]);
        parsedData.classes = (parsedData.classes || []).filter(function (cls) {
          const id = String((cls && cls.id) || "");
          return !demoClassIds.has(id);
        });

        const demoSubjectIds = new Set(["SUB-001", "SUB-002", "SUB-003"]);
        parsedData.subjects = (parsedData.subjects || []).filter(function (subject) {
          const id = String((subject && subject.id) || "");
          return !demoSubjectIds.has(id);
        });

        parsedData.attendance = Array.isArray(parsedData.attendance)
          ? parsedData.attendance.filter(function (item) {
            const id = String((item && item.id) || "");
            return !/^ATT-00[1-3]$/i.test(id);
          })
          : [];

        parsedData.fees = Array.isArray(parsedData.fees)
          ? parsedData.fees.filter(function (item) {
            const id = String((item && item.id) || "");
            return !/^FEE-00[1-3]$/i.test(id);
          })
          : [];

        parsedData.activityLogs = Array.isArray(parsedData.activityLogs)
          ? parsedData.activityLogs.filter(function (entry) {
            const title = String((entry && entry.title) || "").toLowerCase();
            return title !== "system initialized";
          })
          : [];

        parsedData.__demoCleanupV2Done = true;
      }

      return parsedData;
    } catch (error) {
      localStorage.setItem(DB_KEY, JSON.stringify(defaultDatabase));
      return structuredClone(defaultDatabase);
    }
  }

  function saveDatabase(database) {
    localStorage.setItem(DB_KEY, JSON.stringify(database));
    scheduleRemoteSave(database);
    return database;
  }

  function updateDatabase(updater) {
    const database = getDatabase();
    const updatedDatabase = updater(structuredClone(database));
    return saveDatabase(updatedDatabase);
  }

  function getSyncStatus() {
    return {
      pending: Boolean(localStorage.getItem(REMOTE_PENDING_KEY)),
      dirtyAt: localStorage.getItem(REMOTE_DIRTY_AT_KEY) || "",
      lastSyncAt: localStorage.getItem(REMOTE_LAST_SYNC_KEY) || "",
      lastError: localStorage.getItem(REMOTE_LAST_ERROR_KEY) || ""
    };
  }

  function flushRemoteSave() {
    const pendingSnapshot = localStorage.getItem(REMOTE_PENDING_KEY);
    const snapshot = pendingSnapshot || localStorage.getItem(DB_KEY);
    if (!snapshot) {
      return Promise.resolve(null);
    }
    try {
      return pushRemoteDatabase(JSON.parse(snapshot));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  window.SagarSoftDB = {
    key: DB_KEY,
    getDatabase,
    saveDatabase,
    updateDatabase,
    defaultDatabase,
    pushRemoteDatabase,
    getSyncStatus,
    flushRemoteSave
  };
})();
