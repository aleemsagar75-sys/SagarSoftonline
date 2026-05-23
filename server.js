require("dotenv").config();

const cors = require("cors");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 10000);
const apiKey = String(process.env.SAGARSOFT_API_KEY || "").trim();
const defaultSchoolId = String(process.env.DEFAULT_SCHOOL_ID || "SCH-2026-001").trim();

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required.");
}

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));

const webDirCandidates = [
  process.env.SAGARSOFT_WEB_DIR,
  path.resolve(__dirname, ".."),
  __dirname
].filter(Boolean);
const webAppDir = webDirCandidates.find((candidate) => fs.existsSync(path.join(candidate, "dashboard.html")));
if (webAppDir) {
  app.use("/app", express.static(webAppDir));
  app.get("/dashboard.html", (_req, res) => res.sendFile(path.join(webAppDir, "dashboard.html")));
}

app.get("/", (_req, res) => {
  res.type("html").send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>SagarSoft Online API</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #123; }
          code { background: #eef4f8; padding: 3px 6px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>SagarSoft Online API is live</h1>
        <p>This URL is the backend API for the SagarSoft desktop app.</p>
        <p>Health check: <code>/health</code></p>
      </body>
    </html>
  `);
});

function requireApiKey(req, res, next) {
  if (!apiKey) {
    return next();
  }
  const incoming = String(req.headers["x-sagarsoft-api-key"] || "").trim();
  if (incoming !== apiKey) {
    return res.status(401).json({ success: false, message: "Invalid API key." });
  }
  return next();
}

async function ensureSchema() {
  await pool.query(`
    create table if not exists public.school_databases (
      school_id text primary key,
      database jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists public.license_accounts (
      school_id text primary key,
      school_name text not null default '',
      email text unique,
      password text,
      status text not null default 'inactive',
      plan text not null default 'monthly',
      start_date date,
      expiry_date date,
      license_token text unique,
      internet_required_after_days integer not null default 20,
      modules_locked boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists public.license_notifications (
      id bigserial primary key,
      school_id text not null references public.license_accounts(school_id) on delete cascade,
      title text not null default 'Notification',
      message text not null default '',
      created_at timestamptz not null default now()
    );

    create table if not exists public.employees (
      id text primary key,
      school_id text,
      source_id text,
      name text,
      subject text,
      designation text,
      role text,
      phone text,
      date_of_joining date,
      monthly_salary numeric,
      email text,
      status text,
      created_at timestamptz not null default now()
    );

    create table if not exists public.teachers (
      id text primary key,
      school_id text,
      source_id text,
      name text,
      designation text,
      phone text,
      email text,
      status text,
      data jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists public.students (
      id text primary key,
      school_id text,
      source_id text,
      admission_no text,
      name text,
      picture text,
      date_of_admission date,
      class_name text,
      section text,
      discount_in_fee numeric,
      date_of_birth date,
      gender text,
      blood_group text,
      disease_info text,
      birth_id text,
      previous_school text,
      previous_id text,
      orphan_status text,
      religion text,
      address text,
      phone text,
      father_name text,
      father_education text,
      father_national_id text,
      father_phone text,
      father_occupation text,
      father_income text,
      mother_name text,
      mother_education text,
      mother_national_id text,
      mother_phone text,
      mother_occupation text,
      status text,
      created_at timestamptz not null default now()
    );

    create table if not exists public.classes (
      id text primary key,
      school_id text,
      source_id text,
      name text,
      monthly_fee numeric,
      teacher_id text,
      created_at timestamptz not null default now()
    );

    create table if not exists public.app_records (
      school_id text not null,
      module_name text not null,
      record_id text not null,
      record_data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, module_name, record_id)
    );

    alter table public.employees add column if not exists school_id text;
    alter table public.employees add column if not exists source_id text;
    alter table public.teachers add column if not exists school_id text;
    alter table public.teachers add column if not exists source_id text;
    alter table public.students add column if not exists school_id text;
    alter table public.students add column if not exists source_id text;
    alter table public.classes add column if not exists school_id text;
    alter table public.classes add column if not exists source_id text;

    create index if not exists idx_employees_school_id on public.employees (school_id);
    create index if not exists idx_teachers_school_id on public.teachers (school_id);
    create index if not exists idx_students_school_id on public.students (school_id);
    create index if not exists idx_classes_school_id on public.classes (school_id);
  `);
}

function normalizeSchoolId(value) {
  return String(value || defaultSchoolId || "SCH-2026-001").trim();
}

function toLicensePayload(row, notifications) {
  const licenseToken = row.license_token || `LIC-${row.school_id}`;
  return {
    success: true,
    school_id: row.school_id,
    school_name: row.school_name,
    email: row.email,
    activation_status: row.status,
    status: row.status,
    plan: row.plan,
    start_date: row.start_date,
    expiry_date: row.expiry_date,
    license_token: licenseToken,
    internet_required_after_days: row.internet_required_after_days,
    modules_locked: row.modules_locked,
    notifications: notifications || []
  };
}

function scopedMirrorId(schoolId, sourceId, prefix) {
  const rawId = String(sourceId || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return {
    sourceId: rawId,
    mirrorId: `${schoolId}:${rawId}`
  };
}

async function syncEmployeeMirrorTables(client, schoolId, database) {
  const employees = Array.isArray(database && database.teachers) ? database.teachers : [];
  await client.query("delete from public.employees where school_id = $1", [schoolId]);
  await client.query("delete from public.teachers where school_id = $1", [schoolId]);

  for (const employee of employees) {
    const ids = scopedMirrorId(schoolId, employee.id, "TCH");
    await client.query(`
      insert into public.employees (
        id, school_id, source_id, name, subject, designation, role, phone, date_of_joining,
        monthly_salary, email, status, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
      on conflict (id)
      do update set
        school_id = excluded.school_id,
        source_id = excluded.source_id,
        name = excluded.name,
        subject = excluded.subject,
        designation = excluded.designation,
        role = excluded.role,
        phone = excluded.phone,
        date_of_joining = excluded.date_of_joining,
        monthly_salary = excluded.monthly_salary,
        email = excluded.email,
        status = excluded.status
    `, [
      ids.mirrorId,
      schoolId,
      ids.sourceId,
      String(employee.name || ""),
      String(employee.subject || ""),
      String(employee.designation || employee.role || ""),
      String(employee.role || ""),
      String(employee.phone || employee.mobile || ""),
      employee.dateOfJoining || null,
      Number(employee.monthlySalary || 0),
      String(employee.email || ""),
      String(employee.status || "active")
    ]);

    await client.query(`
      insert into public.teachers (id, school_id, source_id, name, designation, phone, email, status, data, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
      on conflict (id)
      do update set
        school_id = excluded.school_id,
        source_id = excluded.source_id,
        name = excluded.name,
        designation = excluded.designation,
        phone = excluded.phone,
        email = excluded.email,
        status = excluded.status,
        data = excluded.data
    `, [
      ids.mirrorId,
      schoolId,
      ids.sourceId,
      String(employee.name || ""),
      String(employee.designation || employee.role || ""),
      String(employee.phone || employee.mobile || ""),
      String(employee.email || ""),
      String(employee.status || "active"),
      JSON.stringify(employee)
    ]);
  }
}

function emptyToNullDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

async function syncStudentMirrorTable(client, schoolId, database) {
  const students = Array.isArray(database && database.students) ? database.students : [];
  await client.query("delete from public.students where school_id = $1", [schoolId]);

  for (const student of students) {
    const ids = scopedMirrorId(schoolId, student.id, "STU");
    await client.query(`
      insert into public.students (
        id, school_id, source_id, admission_no, name, picture, date_of_admission, class_name, section,
        discount_in_fee, date_of_birth, gender, blood_group, disease_info,
        birth_id, previous_school, previous_id, orphan_status, religion, address,
        phone, father_name, father_education, father_national_id, father_phone,
        father_occupation, father_income, mother_name, mother_education,
        mother_national_id, mother_phone, mother_occupation, status, created_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25,
        $26, $27, $28, $29,
        $30, $31, $32, $33, now()
      )
      on conflict (id)
      do update set
        school_id = excluded.school_id,
        source_id = excluded.source_id,
        admission_no = excluded.admission_no,
        name = excluded.name,
        picture = excluded.picture,
        date_of_admission = excluded.date_of_admission,
        class_name = excluded.class_name,
        section = excluded.section,
        discount_in_fee = excluded.discount_in_fee,
        date_of_birth = excluded.date_of_birth,
        gender = excluded.gender,
        blood_group = excluded.blood_group,
        disease_info = excluded.disease_info,
        birth_id = excluded.birth_id,
        previous_school = excluded.previous_school,
        previous_id = excluded.previous_id,
        orphan_status = excluded.orphan_status,
        religion = excluded.religion,
        address = excluded.address,
        phone = excluded.phone,
        father_name = excluded.father_name,
        father_education = excluded.father_education,
        father_national_id = excluded.father_national_id,
        father_phone = excluded.father_phone,
        father_occupation = excluded.father_occupation,
        father_income = excluded.father_income,
        mother_name = excluded.mother_name,
        mother_education = excluded.mother_education,
        mother_national_id = excluded.mother_national_id,
        mother_phone = excluded.mother_phone,
        mother_occupation = excluded.mother_occupation,
        status = excluded.status
    `, [
      ids.mirrorId,
      schoolId,
      ids.sourceId,
      String(student.admissionNo || student.rollNo || ""),
      String(student.name || ""),
      String(student.picture || ""),
      emptyToNullDate(student.dateOfAdmission),
      String(student.className || ""),
      String(student.section || ""),
      Number(student.discountInFee || 0),
      emptyToNullDate(student.dateOfBirth),
      String(student.gender || ""),
      String(student.bloodGroup || ""),
      String(student.diseaseInfo || ""),
      String(student.birthId || ""),
      String(student.previousSchool || ""),
      String(student.previousId || ""),
      String(student.orphanStatus || ""),
      String(student.religion || ""),
      String(student.address || ""),
      String(student.phone || ""),
      String(student.fatherName || ""),
      String(student.fatherEducation || ""),
      String(student.fatherNationalId || ""),
      String(student.fatherPhone || ""),
      String(student.fatherOccupation || ""),
      String(student.fatherIncome || ""),
      String(student.motherName || ""),
      String(student.motherEducation || ""),
      String(student.motherNationalId || ""),
      String(student.motherPhone || ""),
      String(student.motherOccupation || ""),
      String(student.status || "active")
    ]);
  }
}

async function syncClassMirrorTable(client, schoolId, database) {
  const classes = Array.isArray(database && database.classes) ? database.classes : [];
  await client.query("delete from public.classes where school_id = $1", [schoolId]);

  for (const classItem of classes) {
    const ids = scopedMirrorId(schoolId, classItem.id, "CLS");
    await client.query(`
      insert into public.classes (id, school_id, source_id, name, monthly_fee, teacher_id, created_at)
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (id)
      do update set
        school_id = excluded.school_id,
        source_id = excluded.source_id,
        name = excluded.name,
        monthly_fee = excluded.monthly_fee,
        teacher_id = excluded.teacher_id
    `, [
      ids.mirrorId,
      schoolId,
      ids.sourceId,
      String(classItem.name || ""),
      Number(classItem.monthlyTuitionFees || classItem.monthlyFee || 0),
      String(classItem.classTeacher || classItem.teacherId || "")
    ]);
  }
}

function collectAppRecords(database) {
  const records = [];
  const addRecord = function (moduleName, recordId, value) {
    records.push({
      moduleName: String(moduleName || "unknown"),
      recordId: String(recordId || `${moduleName}-${records.length + 1}`),
      data: value && typeof value === "object" ? value : { value: value }
    });
  };
  const addArrayRecords = function (moduleName, rows) {
    (Array.isArray(rows) ? rows : []).forEach(function (row, index) {
      const id = row && typeof row === "object" && row.id ? row.id : `${moduleName}-${index + 1}`;
      addRecord(moduleName, id, row);
    });
  };
  const addObjectRecord = function (moduleName, value) {
    if (value && typeof value === "object") {
      addRecord(moduleName, moduleName, value);
    }
  };

  Object.keys(database || {}).forEach(function (key) {
    const value = database[key];
    if (Array.isArray(value)) {
      addArrayRecords(key, value);
    } else if (value && typeof value === "object") {
      addObjectRecord(key, value);
      Object.keys(value).forEach(function (childKey) {
        const childValue = value[childKey];
        const moduleName = `${key}.${childKey}`;
        if (Array.isArray(childValue)) {
          addArrayRecords(moduleName, childValue);
        } else if (childValue && typeof childValue === "object") {
          addObjectRecord(moduleName, childValue);
        }
      });
    } else {
      addRecord(key, key, { value: value });
    }
  });

  return records;
}

async function syncAppRecordsTable(client, schoolId, database) {
  const records = collectAppRecords(database);
  await client.query("delete from public.app_records where school_id = $1", [schoolId]);
  for (const record of records) {
    await client.query(`
      insert into public.app_records (school_id, module_name, record_id, record_data, updated_at)
      values ($1, $2, $3, $4::jsonb, now())
      on conflict (school_id, module_name, record_id)
      do update set
        record_data = excluded.record_data,
        updated_at = now()
    `, [schoolId, record.moduleName, record.recordId, JSON.stringify(record.data)]);
  }
}

async function saveSchoolDatabaseWithMirrors(schoolId, database) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`
      insert into public.school_databases (school_id, database, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (school_id)
      do update set database = excluded.database, updated_at = now()
    `, [schoolId, JSON.stringify(database || {})]);
    await syncEmployeeMirrorTables(client, schoolId, database || {});
    await syncStudentMirrorTable(client, schoolId, database || {});
    await syncClassMirrorTable(client, schoolId, database || {});
    await syncAppRecordsTable(client, schoolId, database || {});
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getSchoolDatabase(schoolId) {
  const result = await pool.query("select database from public.school_databases where school_id = $1", [schoolId]);
  return result.rowCount ? result.rows[0].database : null;
}

async function findLicenseByToken(schoolId, token) {
  const result = await pool.query(`
    select * from public.license_accounts
    where school_id = $1 and coalesce(license_token, 'LIC-' || school_id) = $2
    limit 1
  `, [schoolId, token]);
  return result.rowCount ? result.rows[0] : null;
}

function isLicenseUsable(row) {
  if (!row) {
    return false;
  }
  const status = String(row.status || "").toLowerCase();
  const expiry = row.expiry_date ? new Date(row.expiry_date) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return status === "active" && !row.modules_locked && (!expiry || expiry >= today);
}

app.get("/health", async (_req, res) => {
  await pool.query("select 1");
  res.json({ success: true, message: "SagarSoft online API is running." });
});

app.get("/api/database/:schoolId", requireApiKey, async (req, res) => {
  const schoolId = normalizeSchoolId(req.params.schoolId);
  const result = await pool.query("select database from public.school_databases where school_id = $1", [schoolId]);
  if (!result.rowCount) {
    return res.json({ success: true, school_id: schoolId, database: null });
  }
  return res.json({ success: true, school_id: schoolId, database: result.rows[0].database });
});

app.post("/api/database/:schoolId", requireApiKey, async (req, res) => {
  const schoolId = normalizeSchoolId(req.params.schoolId);
  const database = req.body && req.body.database ? req.body.database : {};
  try {
    await saveSchoolDatabaseWithMirrors(schoolId, database);
    return res.json({ success: true, school_id: schoolId });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Unable to save online database." });
  }
});

app.post("/api/admin/license", requireApiKey, async (req, res) => {
  const body = req.body || {};
  const schoolId = normalizeSchoolId(body.school_id);
  const schoolName = String(body.school_name || "School Admin").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "").trim();
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required." });
  }
  await pool.query(`
    insert into public.license_accounts (
      school_id, school_name, email, password, status, plan, start_date, expiry_date,
      license_token, internet_required_after_days, modules_locked, updated_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
    on conflict (school_id)
    do update set
      school_name = excluded.school_name,
      email = excluded.email,
      password = excluded.password,
      status = excluded.status,
      plan = excluded.plan,
      start_date = excluded.start_date,
      expiry_date = excluded.expiry_date,
      license_token = excluded.license_token,
      internet_required_after_days = excluded.internet_required_after_days,
      modules_locked = excluded.modules_locked,
      updated_at = now()
  `, [
    schoolId,
    schoolName,
    email,
    password,
    String(body.status || "active").trim().toLowerCase(),
    String(body.plan || "monthly").trim(),
    body.start_date || new Date().toISOString().slice(0, 10),
    body.expiry_date || null,
    String(body.license_token || `LIC-${schoolId}`),
    Number(body.internet_required_after_days || 20),
    Boolean(body.modules_locked)
  ]);
  return res.json({ success: true, school_id: schoolId, license_token: String(body.license_token || `LIC-${schoolId}`) });
});

app.post("/api/activate-school.php", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const result = await pool.query(`
    select * from public.license_accounts
    where lower(email) = $1 and password = $2
    limit 1
  `, [email, password]);
  if (!result.rowCount) {
    return res.status(401).json({ success: false, message: "Invalid school credentials." });
  }
  const row = result.rows[0];
  const notes = await pool.query("select id, title, message, created_at from public.license_notifications where school_id = $1 order by created_at desc limit 20", [row.school_id]);
  return res.json(toLicensePayload(row, notes.rows));
});

app.post("/api/mobile/login", async (req, res) => {
  const identifier = String(req.body.identifier || req.body.email || req.body.school_id || "").trim();
  const email = identifier.toLowerCase();
  const password = String(req.body.password || "");
  const requestedRole = String(req.body.role || "admin").trim().toLowerCase();
  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: "School email / ID and password are required." });
  }
  if (!["admin", "superadmin"].includes(requestedRole)) {
    const userResult = await pool.query(`
      select sd.school_id, sd.database, la.*
      from public.school_databases sd
      join public.license_accounts la on la.school_id = sd.school_id
      where exists (
        select 1
        from jsonb_array_elements(coalesce(sd.database->'users', '[]'::jsonb)) app_user
        where lower(app_user->>'email') = $1
          and app_user->>'password' = $2
          and lower(app_user->>'role') = $3
          and lower(coalesce(app_user->>'active', 'true')) <> 'false'
      )
      limit 1
    `, [email, password, requestedRole]);
    if (!userResult.rowCount) {
      return res.status(401).json({ success: false, message: "Invalid app user credentials." });
    }
    const license = userResult.rows[0];
    if (!isLicenseUsable(license)) {
      return res.status(403).json({ success: false, message: "School subscription is inactive, blocked, or expired.", license: toLicensePayload(license, []) });
    }
    const database = userResult.rows[0].database || {};
    const appUser = Array.isArray(database.users)
      ? database.users.find((entry) => (
        String(entry.email || "").trim().toLowerCase() === email &&
        String(entry.password || "") === password &&
        String(entry.role || "").trim().toLowerCase() === requestedRole &&
        entry.active !== false
      ))
      : null;
    const notes = await pool.query("select id, title, message, created_at from public.license_notifications where school_id = $1 order by created_at desc limit 20", [license.school_id]);
    return res.json({
      success: true,
      license: toLicensePayload(license, notes.rows),
      user: appUser || { email: identifier, role: requestedRole, name: requestedRole },
      school_id: license.school_id,
      license_token: license.license_token || `LIC-${license.school_id}`,
      database: database || {}
    });
  }
  const result = await pool.query(`
    select * from public.license_accounts
    where (lower(email) = $1 or lower(school_id) = $1) and password = $2
    limit 1
  `, [email, password]);
  if (!result.rowCount) {
    return res.status(401).json({ success: false, message: "Invalid school credentials." });
  }
  const license = result.rows[0];
  if (!isLicenseUsable(license)) {
    return res.status(403).json({ success: false, message: "School subscription is inactive, blocked, or expired.", license: toLicensePayload(license, []) });
  }
  const database = await getSchoolDatabase(license.school_id);
  const notes = await pool.query("select id, title, message, created_at from public.license_notifications where school_id = $1 order by created_at desc limit 20", [license.school_id]);
  return res.json({
    success: true,
    license: toLicensePayload(license, notes.rows),
    user: {
      id: requestedRole === "superadmin" ? "USR-SUPER-001" : "USR-ADMIN-001",
      name: requestedRole === "superadmin" ? "SagarSoft Super Admin" : (license.school_name || "School Admin"),
      email: license.email,
      role: requestedRole === "superadmin" ? "superadmin" : "admin"
    },
    school_id: license.school_id,
    license_token: license.license_token || `LIC-${license.school_id}`,
    database: database || {}
  });
});

app.get("/api/mobile/database/:schoolId", async (req, res) => {
  const schoolId = normalizeSchoolId(req.params.schoolId);
  const token = String(req.query.license_token || req.headers["x-license-token"] || "").trim();
  const license = await findLicenseByToken(schoolId, token);
  if (!license || !isLicenseUsable(license)) {
    return res.status(401).json({ success: false, message: "Invalid or inactive license." });
  }
  return res.json({ success: true, school_id: schoolId, database: await getSchoolDatabase(schoolId) || {} });
});

app.post("/api/mobile/database/:schoolId", async (req, res) => {
  const schoolId = normalizeSchoolId(req.params.schoolId);
  const token = String(req.body.license_token || req.headers["x-license-token"] || "").trim();
  const license = await findLicenseByToken(schoolId, token);
  if (!license || !isLicenseUsable(license)) {
    return res.status(401).json({ success: false, message: "Invalid or inactive license." });
  }
  try {
    await saveSchoolDatabaseWithMirrors(schoolId, req.body.database || {});
    return res.json({ success: true, school_id: schoolId });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Unable to save mobile database." });
  }
});

app.post("/api/check-license.php", async (req, res) => {
  const schoolId = normalizeSchoolId(req.body.school_id);
  const token = String(req.body.license_token || "").trim();
  const result = await pool.query(`
    select * from public.license_accounts
    where school_id = $1 and coalesce(license_token, 'LIC-' || school_id) = $2
    limit 1
  `, [schoolId, token]);
  if (!result.rowCount) {
    return res.status(401).json({ success: false, message: "License not found." });
  }
  const row = result.rows[0];
  const notes = await pool.query("select id, title, message, created_at from public.license_notifications where school_id = $1 order by created_at desc limit 20", [row.school_id]);
  return res.json(toLicensePayload(row, notes.rows));
});

app.post("/api/sync-school-data.php", async (req, res) => {
  const schoolId = normalizeSchoolId(req.body.school_id);
  const schoolName = String(req.body.school_name || "").trim();
  const status = String(req.body.activation_status || "active").trim().toLowerCase();
  const plan = String(req.body.plan || "monthly").trim();
  await pool.query(`
    insert into public.license_accounts (school_id, school_name, status, plan, start_date, expiry_date, license_token, updated_at)
    values ($1, $2, $3, $4, $5, $6, $7, now())
    on conflict (school_id)
    do update set
      school_name = coalesce(nullif(excluded.school_name, ''), license_accounts.school_name),
      status = excluded.status,
      plan = excluded.plan,
      start_date = coalesce(excluded.start_date, license_accounts.start_date),
      expiry_date = coalesce(excluded.expiry_date, license_accounts.expiry_date),
      license_token = coalesce(license_accounts.license_token, excluded.license_token),
      updated_at = now()
  `, [
    schoolId,
    schoolName,
    status,
    plan,
    req.body.start_date || null,
    req.body.expiry_date || null,
    String(req.body.license_token || `LIC-${schoolId}`)
  ]);
  const result = await pool.query("select * from public.license_accounts where school_id = $1", [schoolId]);
  return res.json({ success: true, license: toLicensePayload(result.rows[0], []) });
});

ensureSchema()
  .then(function () {
    app.listen(port, function () {
      console.log(`SagarSoft online API listening on ${port}`);
    });
  })
  .catch(function (error) {
    console.error("Unable to start SagarSoft online API:", error);
    process.exit(1);
  });
