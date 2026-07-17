async function test() {
  var BASE = process.env.TEST_BASE_URL || "https://sagarsoftonline.onrender.com";
  var EMAIL = process.env.TEST_SCHOOL_EMAIL || "";
  var PWD = process.env.TEST_SCHOOL_PASSWORD || "";
  var SA_EMAIL = process.env.TEST_SA_EMAIL || "";
  var SA_PWD = process.env.TEST_SA_PASSWORD || "";
  if (!EMAIL || !PWD || !SA_EMAIL || !SA_PWD) { console.log("Set TEST_BASE_URL, TEST_SCHOOL_EMAIL, TEST_SCHOOL_PASSWORD, TEST_SA_EMAIL, TEST_SA_PASSWORD env vars"); return; }

  console.log("=== STEP 1: Super Admin creates school ===");
  var sa = await fetch(BASE+"/api/auth/superadmin", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({email:SA_EMAIL,password:SA_PWD})
  });
  var saData = await sa.json();
  console.log("Superadmin token:", saData.success ? "OK" : "FAIL");

  var schoolId = "SCH-DEMO-" + Date.now();
  var lic = await fetch(BASE+"/api/admin/license", {
    method: "POST",
    headers: {"Content-Type":"application/json","Authorization":"Bearer "+saData.token},
    body: JSON.stringify({school_id:schoolId,school_name:"Demo School",email:EMAIL,password:PWD})
  });
  var licData = await lic.json();
  console.log("License created:", licData.success, "school:", schoolId);

  console.log("\n=== STEP 2: Super Admin saves data ===");
  var db = {
    school:{name:"Demo School"},
    users:[{id:"USR-001",email:EMAIL,password:PWD,role:"admin",name:"School Owner",active:true}],
    teachers:[{id:"TCH-001",name:"Real Teacher 1"},{id:"TCH-002",name:"Real Teacher 2"}],
    classes:[{id:"CLS-001",name:"Class 5",section:"A"}],
    students:[{id:"STU-001",name:"Ahmed",classId:"CLS-001",rollNo:1}],
    subjects:[{id:"SUB-001",name:"Math"}],
    fees:[],attendance:[],exams:[],timetable:[],homework:[],certificates:[],employees:[],
    settings:{},activityLogs:[]
  };
  var save = await fetch(BASE+"/api/database/"+schoolId, {
    method: "POST",
    headers: {"Content-Type":"application/json","Authorization":"Bearer "+licData.license_token},
    body: JSON.stringify({database:db})
  });
  var saveData = await save.json();
  console.log("Save:", save.status, saveData.success);

  console.log("\n=== STEP 3: Mobile login with school credentials ===");
  var login = await fetch(BASE+"/api/mobile/login", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({identifier:EMAIL,email:EMAIL,password:PWD,role:"admin"})
  });
  var loginData = await login.json();
  console.log("Login:", login.status, "success:", loginData.success, "msg:", loginData.message || "ok");
  if (loginData.success) {
    console.log("school_id:", loginData.school_id, "(expected:", schoolId, ")");
    console.log("MATCH:", loginData.school_id === schoolId ? "YES" : "NO");
    var t = loginData.database && loginData.database.teachers || [];
    var s = loginData.database && loginData.database.students || [];
    var c = loginData.database && loginData.database.classes || [];
    console.log("Teachers:", t.length, JSON.stringify(t));
    console.log("Students:", s.length, JSON.stringify(s));
    console.log("Classes:", c.length, JSON.stringify(c));
    console.log("Has demo data (SagarSoft/Default)?", JSON.stringify(t).includes("Demo Teacher") || JSON.stringify(s).includes("Demo Student") ? "YES - BAD" : "NO - CLEAN");
  }

  console.log("\n=== STEP 4: Different device login (same credentials) ===");
  var login2 = await fetch(BASE+"/api/mobile/login", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({identifier:EMAIL,email:EMAIL,password:PWD,role:"admin"})
  });
  var login2Data = await login2.json();
  console.log("Login2:", login2.status, "success:", login2Data.success);
  if (login2Data.success) {
    console.log("school_id:", login2Data.school_id, "(same?", login2Data.school_id === loginData.school_id, ")");
    var t2 = login2Data.database && login2Data.database.teachers || [];
    console.log("Teachers:", t2.length, JSON.stringify(t2));
    console.log("Data matches first login?", JSON.stringify(t2) === JSON.stringify(t) ? "YES" : "NO");
  }
}
test().catch(e => console.log("FATAL:", e.message));
