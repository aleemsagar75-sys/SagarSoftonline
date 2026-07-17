async function test() {
  try {
    var EMAIL = process.env.TEST_EMAIL || "";
    var PWD = process.env.TEST_PASSWORD || "";
    var BASE = process.env.TEST_BASE_URL || "https://sagarsoftonline.onrender.com";
    if (!EMAIL || !PWD) { console.log("Set TEST_EMAIL and TEST_PASSWORD env vars"); return; }
    var resp = await fetch(BASE + "/api/mobile/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({identifier:EMAIL,email:EMAIL,password:PWD,role:"admin"})
    });
    var data = await resp.json();
    console.log("Status:", resp.status);
    console.log("Success:", data.success);
    console.log("School:", data.school_id);
    console.log("Message:", data.message || "none");
    console.log("Has DB:", !!data.database);
  } catch(e) {
    console.log("ERR:", e.message);
  }
}
test();
