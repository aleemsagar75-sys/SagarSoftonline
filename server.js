require("dotenv").config();

const cors = require("cors");
const express = require("express");
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
      name text,
      designation text,
      phone text,
      email text,
      status text,
      data jsonb,
      created_at timestamptz not null default now()
    );
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

async function syncEmployeeMirrorTables(client, database) {
  const employees = Array.isArray(database && database.teachers) ? database.teachers : [];
  await client.query("delete from public.employees");
  await client.query("delete from public.teachers");

  for (const employee of employees) {
    const employeeId = String(employee.id || `TCH-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await client.query(`
      insert into public.employees (
        id, name, subject, designation, role, phone, date_of_joining,
        monthly_salary, email, status, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      on conflict (id)
      do update set
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
      employeeId,
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
      insert into public.teachers (id, name, designation, phone, email, status, data, created_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
      on conflict (id)
      do update set
        name = excluded.name,
        designation = excluded.designation,
        phone = excluded.phone,
        email = excluded.email,
        status = excluded.status,
        data = excluded.data
    `, [
      employeeId,
      String(employee.name || ""),
      String(employee.designation || employee.role || ""),
      String(employee.phone || employee.mobile || ""),
      String(employee.email || ""),
      String(employee.status || "active"),
      JSON.stringify(employee)
    ]);
  }
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
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`
      insert into public.school_databases (school_id, database, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (school_id)
      do update set database = excluded.database, updated_at = now()
    `, [schoolId, JSON.stringify(database)]);
    await syncEmployeeMirrorTables(client, database);
    await client.query("commit");
    return res.json({ success: true, school_id: schoolId });
  } catch (error) {
    await client.query("rollback");
    return res.status(500).json({ success: false, message: error.message || "Unable to save online database." });
  } finally {
    client.release();
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
