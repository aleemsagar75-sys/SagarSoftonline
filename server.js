require("dotenv").config({ path: __dirname + "/.env" });

const dns = require("dns");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

let cors = null;
try {
  cors = require("cors");
} catch (_error) {
  cors = null;
}

const app = express();
const port = Number(process.env.PORT || 10000);
const apiKey = String(process.env.SAGARSOFT_API_KEY || "").trim();
const defaultSchoolId = String(process.env.DEFAULT_SCHOOL_ID || "SCH-2026-001").trim();

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required.");
}

function parseDbUrl(url) {
  var u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "5432"),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1).split("?")[0]
  };
}

var _pool = null;
var _poolPromise = null;

async function _initPool() {
  if (_pool) return _pool;
  var info = parseDbUrl(process.env.SUPABASE_DB_URL);
  try {
    var addrs = await dns.promises.resolve4(info.host);
    info.host = addrs[0];
  } catch (_e) {
    var match = info.host.match(/^db\.(.+?)\.supabase\.co$/);
    if (match) {
      var poolerHost = match[1] + ".pooler.supabase.com";
      try {
        var pAddrs = await dns.promises.resolve4(poolerHost);
        info.host = pAddrs[0];
        info.port = 5432;
      } catch (_e2) {}
    }
  }
  _pool = new Pool({ host: info.host, port: info.port, user: info.user, password: info.password, database: info.database, ssl: { rejectUnauthorized: false } });
  return _pool;
}

var pool = new Proxy({}, {
  get: function (target, prop) {
    return function () {
      var args = arguments;
      var ctx = this;
      if (!_poolPromise) _poolPromise = _initPool();
      return _poolPromise.then(function (p) {
        return p[prop].apply(p, args);
      });
    };
  }
});

var allowedOrigins = [
  "https://sagarsoftonline.onrender.com",
  "https://sagarsoftadmin.onrender.com",
  "http://localhost:10000",
  "http://localhost:3000",
  "file://",
  "null"
];

if (cors) {
  app.use(cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.some(function (o) { return origin.startsWith(o); })) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  }));
} else {
  app.use(function (req, res, next) {
    var origin = req.headers.origin || "";
    var allowed = !origin || allowedOrigins.some(function (o) { return origin.startsWith(o); });
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "https://sagarsoftonline.onrender.com");
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-sagarsoft-api-key, x-license-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    return next();
  });
}
app.use(express.json({ limit: "50mb" }));

const webDirCandidates = [
  process.env.SAGARSOFT_WEB_DIR,
  path.resolve(__dirname, "..", "sagarsoft"),
  path.resolve(__dirname, ".."),
  __dirname
].filter(Boolean);
const webAppDir = webDirCandidates.find((candidate) => fs.existsSync(path.join(candidate, "dashboard.html")));
if (webAppDir) {
  app.use("/app", express.static(webAppDir));
  app.get("/dashboard.html", function (_req, res) {
    var _filePath = path.join(webAppDir, "dashboard.html");
    fs.readFile(_filePath, "utf8", function (_err, _html) {
      if (_err) return res.status(500).send("Error loading dashboard");
      var _fix = '<script>document.addEventListener("click",function(e){var b=e.target.closest("#activateAccountBtn");if(!b||b.textContent!=="Add School")return;document.getElementById("schoolIdInput").value="";document.getElementById("schoolNameInput").value="";document.getElementById("accountUsernameInput").value="";document.getElementById("accountPasswordInput").value=""},!0);(function(){var _f=window.fetch;window.fetch=function(u,o){return _f.call(window,u,o).then(function(r){if(u==="/api/admin/schools"&&o&&o.method==="POST"){return r.clone().json().then(function(d){if(d.success&&d.supabase_error){setTimeout(function(){var m=document.getElementById("manageSchoolsMessage");if(m){m.textContent+=" "+d.supabase_error;m.style.color="#e6a817"}},1000)}return r}).catch(function(){return r})}return r})}})();</script>';
      _html = _html.replace('</body>', _fix + '\n</body>');
      res.type("html").send(_html);
    });
  });
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
      data jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists public.school_backups (
      id bigserial primary key,
      school_id text not null,
      database jsonb not null default '{}'::jsonb,
      size_bytes bigint not null default 0,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_school_backups_school_id on public.school_backups(school_id);

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
      data jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists public.classes (
      id text primary key,
      school_id text,
      source_id text,
      name text,
      monthly_fee numeric,
      teacher_id text,
      data jsonb,
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

    create table if not exists public.app_users (
      school_id text not null,
      source_id text not null,
      name text,
      email text,
      role text,
      active boolean,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.subjects (
      school_id text not null,
      source_id text not null,
      subject_name text,
      class_name text,
      teacher_id text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.attendance (
      school_id text not null,
      source_id text not null,
      entity_type text,
      student_id text,
      employee_id text,
      date date,
      status text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.fees (
      school_id text not null,
      source_id text not null,
      student_id text,
      student_name text,
      class_name text,
      fee_month text,
      status text,
      total_amount numeric,
      deposit numeric,
      remaining numeric,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.fee_invoices (
      school_id text not null,
      source_id text not null,
      student_id text,
      student_name text,
      class_name text,
      fee_month text,
      total_amount numeric,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.fee_collections (
      school_id text not null,
      source_id text not null,
      student_id text,
      student_name text,
      class_name text,
      fee_month text,
      deposit numeric,
      remaining numeric,
      collected_at timestamptz,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.salary_payments (
      school_id text not null,
      source_id text not null,
      employee_id text,
      employee_name text,
      salary_month text,
      salary_amount numeric,
      bonus numeric,
      deduction numeric,
      net_salary numeric,
      payment_date date,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.accounts_ledger (
      school_id text not null,
      source_id text not null,
      date date,
      type text,
      category text,
      amount numeric,
      note text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.activity_logs (
      school_id text not null,
      source_id text not null,
      title text,
      message text,
      created_at timestamptz,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    alter table public.employees add column if not exists school_id text;
    alter table public.employees add column if not exists source_id text;
    alter table public.employees add column if not exists data jsonb;
    alter table public.employees add column if not exists updated_at timestamptz not null default now();
    alter table public.teachers add column if not exists school_id text;
    alter table public.teachers add column if not exists source_id text;
    alter table public.teachers add column if not exists data jsonb;
    alter table public.teachers add column if not exists updated_at timestamptz not null default now();
    alter table public.students add column if not exists school_id text;
    alter table public.students add column if not exists source_id text;
    alter table public.students add column if not exists data jsonb;
    alter table public.students add column if not exists updated_at timestamptz not null default now();
    alter table public.classes add column if not exists school_id text;
    alter table public.classes add column if not exists source_id text;
    alter table public.classes add column if not exists data jsonb;
    alter table public.classes add column if not exists updated_at timestamptz not null default now();
    alter table public.app_users add column if not exists id text;
    alter table public.app_users add column if not exists school_id text;
    alter table public.app_users add column if not exists source_id text;
    alter table public.app_users add column if not exists name text;
    alter table public.app_users add column if not exists email text;
    alter table public.app_users add column if not exists role text;
    alter table public.app_users add column if not exists active boolean;
    alter table public.app_users add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.app_users add column if not exists updated_at timestamptz not null default now();
    alter table public.subjects add column if not exists school_id text;
    alter table public.subjects add column if not exists id text;
    alter table public.subjects add column if not exists source_id text;
    alter table public.subjects add column if not exists subject_name text;
    alter table public.subjects add column if not exists class_name text;
    alter table public.subjects add column if not exists teacher_id text;
    alter table public.subjects add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.subjects add column if not exists updated_at timestamptz not null default now();
    alter table public.attendance add column if not exists school_id text;
    alter table public.attendance add column if not exists id text;
    alter table public.attendance add column if not exists source_id text;
    alter table public.attendance add column if not exists entity_type text;
    alter table public.attendance add column if not exists student_id text;
    alter table public.attendance add column if not exists employee_id text;
    alter table public.attendance add column if not exists date date;
    alter table public.attendance add column if not exists status text;
    alter table public.attendance add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.attendance add column if not exists updated_at timestamptz not null default now();
    alter table public.fees add column if not exists school_id text;
    alter table public.fees add column if not exists id text;
    alter table public.fees add column if not exists source_id text;
    alter table public.fees add column if not exists student_id text;
    alter table public.fees add column if not exists student_name text;
    alter table public.fees add column if not exists class_name text;
    alter table public.fees add column if not exists fee_month text;
    alter table public.fees add column if not exists status text;
    alter table public.fees add column if not exists total_amount numeric;
    alter table public.fees add column if not exists deposit numeric;
    alter table public.fees add column if not exists remaining numeric;
    alter table public.fees add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.fees add column if not exists updated_at timestamptz not null default now();
    alter table public.fee_invoices add column if not exists id text;
    alter table public.fee_invoices add column if not exists school_id text;
    alter table public.fee_invoices add column if not exists source_id text;
    alter table public.fee_invoices add column if not exists student_id text;
    alter table public.fee_invoices add column if not exists student_name text;
    alter table public.fee_invoices add column if not exists class_name text;
    alter table public.fee_invoices add column if not exists fee_month text;
    alter table public.fee_invoices add column if not exists total_amount numeric;
    alter table public.fee_invoices add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.fee_invoices add column if not exists updated_at timestamptz not null default now();
    alter table public.fee_collections add column if not exists id text;
    alter table public.fee_collections add column if not exists school_id text;
    alter table public.fee_collections add column if not exists source_id text;
    alter table public.fee_collections add column if not exists student_id text;
    alter table public.fee_collections add column if not exists student_name text;
    alter table public.fee_collections add column if not exists class_name text;
    alter table public.fee_collections add column if not exists fee_month text;
    alter table public.fee_collections add column if not exists deposit numeric;
    alter table public.fee_collections add column if not exists remaining numeric;
    alter table public.fee_collections add column if not exists collected_at timestamptz;
    alter table public.fee_collections add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.fee_collections add column if not exists updated_at timestamptz not null default now();
    alter table public.salary_payments add column if not exists id text;
    alter table public.salary_payments add column if not exists school_id text;
    alter table public.salary_payments add column if not exists source_id text;
    alter table public.salary_payments add column if not exists employee_id text;
    alter table public.salary_payments add column if not exists employee_name text;
    alter table public.salary_payments add column if not exists salary_month text;
    alter table public.salary_payments add column if not exists salary_amount numeric;
    alter table public.salary_payments add column if not exists bonus numeric;
    alter table public.salary_payments add column if not exists deduction numeric;
    alter table public.salary_payments add column if not exists net_salary numeric;
    alter table public.salary_payments add column if not exists payment_date date;
    alter table public.salary_payments add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.salary_payments add column if not exists updated_at timestamptz not null default now();
    alter table public.accounts_ledger add column if not exists id text;
    alter table public.accounts_ledger add column if not exists school_id text;
    alter table public.accounts_ledger add column if not exists source_id text;
    alter table public.accounts_ledger add column if not exists date date;
    alter table public.accounts_ledger add column if not exists type text;
    alter table public.accounts_ledger add column if not exists category text;
    alter table public.accounts_ledger add column if not exists amount numeric;
    alter table public.accounts_ledger add column if not exists note text;
    alter table public.accounts_ledger add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.accounts_ledger add column if not exists updated_at timestamptz not null default now();
    alter table public.activity_logs add column if not exists id text;
    alter table public.activity_logs add column if not exists school_id text;
    alter table public.activity_logs add column if not exists source_id text;
    alter table public.activity_logs add column if not exists title text;
    alter table public.activity_logs add column if not exists message text;
    alter table public.activity_logs add column if not exists created_at timestamptz;
    alter table public.activity_logs add column if not exists data jsonb not null default '{}'::jsonb;
    alter table public.activity_logs add column if not exists updated_at timestamptz not null default now();
    alter table public.license_accounts add column if not exists last_seen timestamptz;
    alter table public.license_accounts add column if not exists timezone text not null default 'Asia/Karachi';
    alter table public.license_accounts add column if not exists currency text not null default 'PKR';
    alter table public.license_accounts add column if not exists symbol text not null default 'Rs';

    create unique index if not exists uq_employees_school_source on public.employees (school_id, source_id);
    create unique index if not exists uq_teachers_school_source on public.teachers (school_id, source_id);
    create unique index if not exists uq_students_school_source on public.students (school_id, source_id);
    create unique index if not exists uq_classes_school_source on public.classes (school_id, source_id);
    create index if not exists idx_employees_school_id on public.employees (school_id);
    create index if not exists idx_teachers_school_id on public.teachers (school_id);
    create index if not exists idx_students_school_id on public.students (school_id);
    create index if not exists idx_classes_school_id on public.classes (school_id);
    create index if not exists idx_app_users_school_id on public.app_users (school_id);
    create index if not exists idx_subjects_school_id on public.subjects (school_id);
    create index if not exists idx_attendance_school_id on public.attendance (school_id);
    create index if not exists idx_fees_school_id on public.fees (school_id);
    create index if not exists idx_fee_invoices_school_id on public.fee_invoices (school_id);
    create index if not exists idx_fee_collections_school_id on public.fee_collections (school_id);
    create index if not exists idx_salary_payments_school_id on public.salary_payments (school_id);
    create index if not exists idx_accounts_ledger_school_id on public.accounts_ledger (school_id);
    create index if not exists idx_activity_logs_school_id on public.activity_logs (school_id);
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
        monthly_salary, email, status, data, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, now())
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
        status = excluded.status,
        data = excluded.data
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
      String(employee.status || "active"),
      JSON.stringify(employee)
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
        id, school_id, source_id, admission_no, name, picture, date_of_admission, class_name,
        discount_in_fee, date_of_birth, gender, blood_group, disease_info,
        birth_id, previous_school, previous_id, orphan_status, religion, address,
        phone, father_name, father_education, father_national_id, father_phone,
        father_occupation, father_income, mother_name, mother_education,
        mother_national_id, mother_phone, mother_occupation, status, data, created_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31, $32, $33::jsonb, now()
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
        status = excluded.status,
        data = excluded.data
    `, [
      ids.mirrorId,
      schoolId,
      ids.sourceId,
      String(student.admissionNo || student.rollNo || ""),
      String(student.name || ""),
      String(student.picture || ""),
      emptyToNullDate(student.dateOfAdmission),
      String(student.className || ""),
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
      String(student.status || "active"),
      JSON.stringify(student)
    ]);
  }
}

async function syncClassMirrorTable(client, schoolId, database) {
  const classes = Array.isArray(database && database.classes) ? database.classes : [];
  await client.query("delete from public.classes where school_id = $1", [schoolId]);

  for (const classItem of classes) {
    const ids = scopedMirrorId(schoolId, classItem.id, "CLS");
    await client.query(`
      insert into public.classes (id, school_id, source_id, name, monthly_fee, teacher_id, data, created_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
      on conflict (id)
      do update set
        school_id = excluded.school_id,
        source_id = excluded.source_id,
        name = excluded.name,
        monthly_fee = excluded.monthly_fee,
        teacher_id = excluded.teacher_id,
        data = excluded.data
    `, [
      ids.mirrorId,
      schoolId,
      ids.sourceId,
      String(classItem.name || ""),
      Number(classItem.monthlyTuitionFees || classItem.monthlyFee || 0),
      String(classItem.classTeacher || classItem.teacherId || ""),
      JSON.stringify(classItem)
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

function rowId(row, prefix, index) {
  return String((row && row.id) || `${prefix}-${index + 1}`);
}

function scopedRowIdValue(schoolId, sourceId) {
  return `${schoolId}:${sourceId}`;
}

function rowData(row) {
  return JSON.stringify(row && typeof row === "object" ? row : {});
}

async function syncStructuredModuleTables(client, schoolId, database) {
  const users = Array.isArray(database && database.users) ? database.users : [];
  const subjects = Array.isArray(database && database.subjects) ? database.subjects : [];
  const attendance = Array.isArray(database && database.attendance) ? database.attendance : [];
  const fees = Array.isArray(database && database.fees) ? database.fees : [];
  const settings = (database && database.generalSettings) || {};
  const feeInvoices = Array.isArray(settings.feeInvoices) ? settings.feeInvoices : [];
  const feeCollections = Array.isArray(settings.feeCollections) ? settings.feeCollections : [];
  const salaryPayments = Array.isArray(settings.salaryPayments) ? settings.salaryPayments : [];
  const accountsLedger = Array.isArray(settings.accountsLedger) ? settings.accountsLedger : [];
  const activityLogs = Array.isArray(database && database.activityLogs) ? database.activityLogs : [];

  await client.query("delete from public.app_users where school_id = $1", [schoolId]);
  await client.query("delete from public.subjects where school_id = $1", [schoolId]);
  await client.query("delete from public.attendance where school_id = $1", [schoolId]);
  await client.query("delete from public.fees where school_id = $1", [schoolId]);
  await client.query("delete from public.fee_invoices where school_id = $1", [schoolId]);
  await client.query("delete from public.fee_collections where school_id = $1", [schoolId]);
  await client.query("delete from public.salary_payments where school_id = $1", [schoolId]);
  await client.query("delete from public.accounts_ledger where school_id = $1", [schoolId]);
  await client.query("delete from public.activity_logs where school_id = $1", [schoolId]);

  for (let index = 0; index < users.length; index += 1) {
    const row = users[index];
    const sourceId = rowId(row, "USR", index);
    await client.query(`
      insert into public.app_users (id, school_id, source_id, name, email, role, active, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.name || "", row.email || "", row.role || "", row.active !== false, rowData(row)]);
  }

  for (let index = 0; index < subjects.length; index += 1) {
    const row = subjects[index];
    const sourceId = rowId(row, "SUB", index);
    await client.query(`
      insert into public.subjects (id, school_id, source_id, subject_name, class_name, teacher_id, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.subjectName || row.name || "", row.className || "", row.teacherId || row.teacher || "", rowData(row)]);
  }

  for (let index = 0; index < attendance.length; index += 1) {
    const row = attendance[index];
    const sourceId = rowId(row, "ATT", index);
    await client.query(`
      insert into public.attendance (id, school_id, source_id, entity_type, student_id, employee_id, date, status, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.entityType || "student", row.studentId || "", row.employeeId || row.teacherId || "", emptyToNullDate(row.date), row.status || "", rowData(row)]);
  }

  for (let index = 0; index < fees.length; index += 1) {
    const row = fees[index];
    const sourceId = rowId(row, "FEE", index);
    await client.query(`
      insert into public.fees (id, school_id, source_id, student_id, student_name, class_name, fee_month, status, total_amount, deposit, remaining, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.studentId || "", row.studentName || row.name || "", row.className || "", row.feeMonth || row.month || "", row.status || "", Number(row.totalAmount || row.amount || 0), Number(row.deposit || 0), Number(row.remaining || 0), rowData(row)]);
  }

  for (let index = 0; index < feeInvoices.length; index += 1) {
    const row = feeInvoices[index];
    const sourceId = rowId(row, "INV", index);
    await client.query(`
      insert into public.fee_invoices (id, school_id, source_id, student_id, student_name, class_name, fee_month, total_amount, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.studentId || "", row.studentName || row.name || "", row.className || "", row.feeMonth || row.month || "", Number(row.totalAmount || row.amount || 0), rowData(row)]);
  }

  for (let index = 0; index < feeCollections.length; index += 1) {
    const row = feeCollections[index];
    const sourceId = rowId(row, "COL", index);
    await client.query(`
      insert into public.fee_collections (id, school_id, source_id, student_id, student_name, class_name, fee_month, deposit, remaining, collected_at, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.studentId || "", row.studentName || row.name || "", row.className || "", row.feeMonth || row.month || "", Number(row.deposit || 0), Number(row.remaining || 0), row.collectedAt || row.paymentDate || row.date || null, rowData(row)]);
  }

  for (let index = 0; index < salaryPayments.length; index += 1) {
    const row = salaryPayments[index];
    const sourceId = rowId(row, "SAL", index);
    await client.query(`
      insert into public.salary_payments (id, school_id, source_id, employee_id, employee_name, salary_month, salary_amount, bonus, deduction, net_salary, payment_date, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.employeeId || row.teacherId || "", row.employeeName || row.teacherName || row.name || "", row.salaryMonth || row.month || "", Number(row.salaryAmount || 0), Number(row.bonus || 0), Number(row.deduction || 0), Number(row.netSalary || 0), emptyToNullDate(row.paymentDate || row.date), rowData(row)]);
  }

  for (let index = 0; index < accountsLedger.length; index += 1) {
    const row = accountsLedger[index];
    const sourceId = rowId(row, "LED", index);
    await client.query(`
      insert into public.accounts_ledger (id, school_id, source_id, date, type, category, amount, note, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, emptyToNullDate(row.date), row.type || "", row.category || "", Number(row.amount || 0), row.note || "", rowData(row)]);
  }

  for (let index = 0; index < activityLogs.length; index += 1) {
    const row = activityLogs[index];
    const sourceId = rowId(row, "LOG", index);
    await client.query(`
      insert into public.activity_logs (id, school_id, source_id, title, message, created_at, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.title || row.action || "", row.message || row.description || "", row.createdAt || row.date || null, rowData(row)]);
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
    await syncStructuredModuleTables(client, schoolId, database || {});
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
  const database = result.rowCount ? (result.rows[0].database || {}) : {};
  database.generalSettings = database.generalSettings || {};

  const readDataRows = async function (tableName) {
    const rows = await pool.query(
      `select data from public.${tableName} where school_id = $1 and data is not null order by updated_at desc`,
      [schoolId]
    );
    return rows.rows.map((row) => row.data || {}).filter((row) => row && typeof row === "object");
  };

  const [
    teachers,
    students,
    classes,
    users,
    subjects,
    attendance,
    fees,
    feeInvoices,
    feeCollections,
    salaryPayments,
    accountsLedger,
    activityLogs
  ] = await Promise.all([
    readDataRows("teachers"),
    readDataRows("students"),
    readDataRows("classes"),
    readDataRows("app_users"),
    readDataRows("subjects"),
    readDataRows("attendance"),
    readDataRows("fees"),
    readDataRows("fee_invoices"),
    readDataRows("fee_collections"),
    readDataRows("salary_payments"),
    readDataRows("accounts_ledger"),
    readDataRows("activity_logs")
  ]);

  if (teachers.length) database.teachers = teachers;
  if (students.length) database.students = students;
  if (classes.length) database.classes = classes;
  if (users.length) database.users = users;
  if (subjects.length) database.subjects = subjects;
  if (attendance.length) database.attendance = attendance;
  if (fees.length) database.fees = fees;
  if (activityLogs.length) database.activityLogs = activityLogs;
  if (feeInvoices.length) database.generalSettings.feeInvoices = feeInvoices;
  if (feeCollections.length) database.generalSettings.feeCollections = feeCollections;
  if (salaryPayments.length) database.generalSettings.salaryPayments = salaryPayments;
  if (accountsLedger.length) database.generalSettings.accountsLedger = accountsLedger;

  return result.rowCount || teachers.length || students.length || classes.length || users.length || subjects.length || attendance.length || fees.length ? database : null;
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
  const database = await getSchoolDatabase(schoolId);
  if (!database) {
    return res.json({ success: true, school_id: schoolId, database: null });
  }
  return res.json({ success: true, school_id: schoolId, database });
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
  if (!result.rowCount) return res.status(401).json({ success: false, message: "Invalid school credentials." });
  const row = result.rows[0];
  await pool.query("update public.license_accounts set last_seen = now() where school_id = $1", [row.school_id]);
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
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();
  await pool.query(`
    insert into public.license_accounts (school_id, school_name, email, password, status, plan, start_date, expiry_date, license_token, updated_at)
    values ($1, $2, nullif($3, ''), nullif($4, ''), $5, $6, $7, $8, $9, now())
    on conflict (school_id)
    do update set
      school_name = coalesce(nullif(excluded.school_name, ''), license_accounts.school_name),
      email = coalesce(nullif(excluded.email, ''), license_accounts.email),
      password = coalesce(nullif(excluded.password, ''), license_accounts.password),
      status = excluded.status,
      plan = excluded.plan,
      start_date = coalesce(excluded.start_date, license_accounts.start_date),
      expiry_date = coalesce(excluded.expiry_date, license_accounts.expiry_date),
      license_token = coalesce(license_accounts.license_token, excluded.license_token),
      updated_at = now()
  `, [
    schoolId,
    schoolName,
    email,
    password,
    status,
    plan,
    req.body.start_date || null,
    req.body.expiry_date || null,
    String(req.body.license_token || `LIC-${schoolId}`)
  ]);
  const result = await pool.query("select * from public.license_accounts where school_id = $1", [schoolId]);
  return res.json({ success: true, license: toLicensePayload(result.rows[0], []) });
});

async function ensureSuperAdminActivationTable() {
  try {
    await pool.query("create table if not exists public.super_admin_activation (school_id text primary key, school_name text, email text, password text, status text default 'active', plan text default 'premium', start_date date, expiry_date date, modules_locked boolean default false, last_seen timestamptz, timezone text default 'Asia/Karachi', currency text default 'PKR', symbol text default 'Rs', created_at timestamptz default now(), updated_at timestamptz default now())");
    var count = await pool.query("select count(*) as c from public.super_admin_activation");
    if (parseInt(count.rows[0].c) === 0) {
      await pool.query("insert into public.super_admin_activation (school_id, school_name, email, password, status, plan, start_date, expiry_date, modules_locked, last_seen, timezone, currency, symbol, created_at, updated_at) select school_id, school_name, email, password, status, plan, start_date, expiry_date, modules_locked, last_seen, timezone, currency, symbol, created_at, updated_at from public.license_accounts on conflict (school_id) do nothing");
      console.log("Migrated existing schools to super_admin_activation");
    }
    console.log("super_admin_activation table ready");
  } catch (e) {
    console.error("super_admin_activation table error:", e.message);
  }
}
ensureSuperAdminActivationTable();

app.get("/api/admin/schools", async function (req, res) {
  try {
    var rows = await pool.query("select school_id, school_name, email, password, status, plan, start_date, expiry_date, modules_locked, last_seen, timezone, currency, symbol, created_at, updated_at from public.super_admin_activation order by updated_at desc");
    console.log("GET /api/admin/schools: returning", rows.rows.length, "schools from super_admin_activation");
    return res.json({ success: true, schools: rows.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/schools", async function (req, res) {
  var schoolName = String(req.body.school_name || "").trim();
  var email = String(req.body.email || "").trim().toLowerCase();
  var password = String(req.body.password || "").trim();
  var plan = String(req.body.plan || "premium").trim();
  var startDate = req.body.start_date || null;
  var expiryDate = req.body.expiry_date || null;
  var customId = req.body.school_id ? String(req.body.school_id).trim() : "";
  if (!schoolName) return res.status(400).json({ success: false, message: "School name is required." });
  if (!email) return res.status(400).json({ success: false, message: "Email is required." });
  if (!password) return res.status(400).json({ success: false, message: "Password is required." });
  try {
    var schoolId = customId || ("SCH-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase());
    var _dupCheck = await pool.query("select school_id from public.license_accounts where school_id = $1", [schoolId]);
    if (_dupCheck.rows.length > 0) {
      return res.status(409).json({ success: false, message: "School ID '" + schoolId + "' already exists. Please use a different ID." });
    }
    await pool.query("insert into public.license_accounts (school_id, school_name, email, password, plan, status, start_date, expiry_date, modules_locked, timezone, currency, symbol, created_at, updated_at) values ($1,$2,$3,$4,$5,'active',$6,$7,false,'Asia/Karachi','PKR','Rs',now(),now())", [schoolId, schoolName, email, password, plan, startDate, expiryDate]);
    await pool.query("insert into public.super_admin_activation (school_id, school_name, email, password, plan, status, start_date, expiry_date, modules_locked, timezone, currency, symbol, created_at, updated_at) values ($1,$2,$3,$4,$5,'active',$6,$7,false,'Asia/Karachi','PKR','Rs',now(),now()) on conflict (school_id) do update set school_name=excluded.school_name, email=excluded.email, password=excluded.password, plan=excluded.plan, status='active', start_date=coalesce(excluded.start_date,super_admin_activation.start_date), expiry_date=coalesce(excluded.expiry_date,super_admin_activation.expiry_date), modules_locked=false, updated_at=now()", [schoolId, schoolName, email, password, plan, startDate, expiryDate]);
    var supabaseUrl = process.env.SUPABASE_URL;
    var supabaseKey = process.env.SUPABASE_SECRET_KEY;
    var _supaOk = false;
    if (supabaseUrl && supabaseKey) {
      try {
        var _supaResp = await fetch(supabaseUrl + "/auth/v1/admin/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabaseKey,
            "Authorization": "Bearer " + supabaseKey
          },
          body: JSON.stringify({
            email: email,
            password: password,
            email_confirm: true,
            user_metadata: {
              school_id: schoolId,
              school_name: schoolName
            }
          })
        });
        if (_supaResp.ok) {
          _supaOk = true;
          console.log("Supabase Auth user created for", email);
        } else {
          var _supaBody = await _supaResp.text().catch(function () { return ""; });
          console.error("Supabase Auth user creation failed:", _supaResp.status, _supaBody);
          try { var _supaParsed = JSON.parse(_supaBody); _supaBody = _supaParsed.msg || _supaParsed.error_description || _supaParsed.message || _supaBody; } catch (e) {}
        }
      } catch (_supabaseError) {
        console.error("Supabase Auth user creation network error:", _supabaseError.message);
      }
    }
    return res.json({ success: true, school_id: schoolId, supabase_user_created: _supaOk, supabase_error: !_supaOk && supabaseUrl ? "Supabase Auth failed — check Render server logs" : undefined, version: "v2.0-fixed" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/debug", function (req, res) {
  res.json({
    version: "v2.0-fixed",
    supabase_url_set: !!process.env.SUPABASE_URL,
    supabase_key_set: !!process.env.SUPABASE_SECRET_KEY,
    node_version: process.version
  });
});

app.put("/api/admin/schools/:schoolId", async function (req, res) {
  var schoolId = String(req.params.schoolId || "").trim();
  if (!schoolId) return res.status(400).json({ success: false, message: "School ID is required." });
  var body = req.body || {};
  try {
    var sets = [];
    var vals = [];
    var idx = 1;
    if (body.school_id !== undefined && String(body.school_id).trim()) { sets.push("school_id = $" + idx); vals.push(String(body.school_id).trim()); idx++; }
    if (body.school_name !== undefined) { sets.push("school_name = $" + idx); vals.push(String(body.school_name)); idx++; }
    if (body.email !== undefined) { sets.push("email = $" + idx); vals.push(String(body.email).trim().toLowerCase()); idx++; }
    if (body.password !== undefined) { sets.push("password = $" + idx); vals.push(String(body.password)); idx++; }
    if (body.status !== undefined) { sets.push("status = $" + idx); vals.push(String(body.status).trim().toLowerCase()); idx++; }
    if (body.plan !== undefined) { sets.push("plan = $" + idx); vals.push(String(body.plan).trim()); idx++; }
    if (body.start_date !== undefined) { sets.push("start_date = $" + idx); vals.push(body.start_date || null); idx++; }
    if (body.expiry_date !== undefined) { sets.push("expiry_date = $" + idx); vals.push(body.expiry_date || null); idx++; }
    if (body.modules_locked !== undefined) { sets.push("modules_locked = $" + idx); vals.push(Boolean(body.modules_locked)); idx++; }
    if (body.timezone !== undefined) { sets.push("timezone = $" + idx); vals.push(String(body.timezone)); idx++; }
    if (body.currency !== undefined) { sets.push("currency = $" + idx); vals.push(String(body.currency)); idx++; }
    if (body.symbol !== undefined) { sets.push("symbol = $" + idx); vals.push(String(body.symbol)); idx++; }
    if (!sets.length) return res.status(400).json({ success: false, message: "No fields to update." });
    sets.push("updated_at = now()");
    vals.push(schoolId);
    await pool.query("update public.license_accounts set " + sets.join(", ") + " where school_id = $" + idx, vals);
    await pool.query("update public.super_admin_activation set " + sets.join(", ") + " where school_id = $" + idx, vals);
    return res.json({ success: true, school_id: schoolId });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/admin/schools/:schoolId", async function (req, res) {
  var schoolId = String(req.params.schoolId || "").trim();
  if (!schoolId) return res.status(400).json({ success: false, message: "School ID is required." });
  try {
    await pool.query("delete from public.license_accounts where school_id = $1", [schoolId]);
    await pool.query("delete from public.super_admin_activation where school_id = $1", [schoolId]);
    return res.json({ success: true, message: "School deleted." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/schools/:schoolId/reset-tokens", async function (req, res) {
  var schoolId = String(req.params.schoolId || "").trim();
  if (!schoolId) return res.status(400).json({ success: false, message: "School ID is required." });
  try {
    var newToken = "sft-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
    await pool.query("update public.license_accounts set api_token = $1 where school_id = $2", [newToken, schoolId]);
    return res.json({ success: true, message: "Tokens reset.", token: newToken });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/notifications", async function (req, res) {
  var title = String(req.body.title || "Notification").trim();
  var message = String(req.body.message || "").trim();
  var targetSchoolId = String(req.body.school_id || "").trim();
  if (!message) return res.status(400).json({ success: false, message: "Message is required." });
  try {
    if (targetSchoolId) {
      await pool.query("insert into public.license_notifications (school_id, title, message, created_at) values ($1, $2, $3, now())", [targetSchoolId, title, message]);
    } else {
      await pool.query("insert into public.license_notifications (school_id, title, message, created_at) select school_id, $1, $2, now() from public.license_accounts", [title, message]);
    }
    return res.json({ success: true, message: "Notification sent." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/admin/notifications", async function (req, res) {
  try {
    var result = await pool.query("select n.id, n.school_id, n.title, n.message, n.created_at, coalesce(a.school_name,'') as school_name from public.license_notifications n left join public.license_accounts a on n.school_id = a.school_id order by n.created_at desc limit 100");
    return res.json({ success: true, notifications: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/admin/notifications", async function (req, res) {
  try {
    await pool.query("delete from public.license_notifications");
    return res.json({ success: true, message: "Notification history cleared." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

var ALLOWED_TABLES = {
  students: "students",
  teachers: "teachers",
  classes: "classes",
  subjects: "subjects",
  attendance: "attendance",
  fees: "fees",
  fee_invoices: "fee_invoices",
  fee_collections: "fee_collections",
  salary_payments: "salary_payments",
  accounts_ledger: "accounts_ledger",
  activity_logs: "activity_logs",
  app_users: "app_users"
};

function sanitizeTableName(table) {
  var name = String(table || "").trim().toLowerCase();
  return ALLOWED_TABLES[name] || null;
}

app.get("/api/data/:schoolId/:table", requireApiKey, async function (req, res) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  var tableName = sanitizeTableName(req.params.table);
  if (!tableName) {
    return res.status(400).json({ success: false, message: "Invalid table name." });
  }
  try {
    var result = await pool.query("select * from public." + tableName + " where school_id = $1 order by updated_at desc", [schoolId]);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/data/:schoolId/:table", requireApiKey, async function (req, res) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  var tableName = sanitizeTableName(req.params.table);
  if (!tableName) {
    return res.status(400).json({ success: false, message: "Invalid table name." });
  }
  var record = req.body.record || req.body.data || req.body || {};
  if (!record.id) {
    record.id = (tableName.slice(0, 3).toUpperCase() + "-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8));
  }
  record.school_id = schoolId;
  try {
    var insertResult = await pool.query(
      "insert into public." + tableName + " (id, school_id, source_id, data, updated_at) values ($1, $2, $3, $4::jsonb, now()) on conflict (school_id, source_id) do update set data = excluded.data, updated_at = now() returning *",
      [record.id, schoolId, record.id, JSON.stringify(record)]
    );
    return res.json({ success: true, data: insertResult.rows[0] || record });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.put("/api/data/:schoolId/:table/:id", requireApiKey, async function (req, res) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  var tableName = sanitizeTableName(req.params.table);
  var recordId = String(req.params.id || "").trim();
  if (!tableName) {
    return res.status(400).json({ success: false, message: "Invalid table name." });
  }
  if (!recordId) {
    return res.status(400).json({ success: false, message: "Record id is required." });
  }
  var record = req.body.record || req.body.data || req.body || {};
  record.id = recordId;
  record.school_id = schoolId;
  try {
    var updateResult = await pool.query(
      "update public." + tableName + " set data = $1::jsonb, updated_at = now() where school_id = $2 and source_id = $3 returning *",
      [JSON.stringify(record), schoolId, recordId]
    );
    if (!updateResult.rowCount) {
      return res.status(404).json({ success: false, message: "Record not found." });
    }
    return res.json({ success: true, data: updateResult.rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/data/:schoolId/:table/:id", requireApiKey, async function (req, res) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  var tableName = sanitizeTableName(req.params.table);
  var recordId = String(req.params.id || "").trim();
  if (!tableName) {
    return res.status(400).json({ success: false, message: "Invalid table name." });
  }
  if (!recordId) {
    return res.status(400).json({ success: false, message: "Record id is required." });
  }
  try {
    await pool.query("delete from public." + tableName + " where school_id = $1 and source_id = $2", [schoolId, recordId]);
    return res.json({ success: true, message: "Record deleted." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/backup", async function (req, res) {
  var schoolId = String(req.body.school_id || "").trim();
  var database = req.body.database || {};
  if (!schoolId) return res.status(400).json({ success: false, message: "School ID required." });
  try {
    var jsonStr = JSON.stringify(database);
    var sizeBytes = Buffer.byteLength(jsonStr, "utf8");
    await pool.query("insert into public.school_backups (school_id, database, size_bytes, created_at) values ($1, $2::jsonb, $3, now())", [schoolId, jsonStr, sizeBytes]);
    return res.json({ success: true, message: "Backup saved.", size_bytes: sizeBytes });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/version", function (_req, res) {
  var versionPath = path.resolve(__dirname, "..", "version.json");
  if (versionPath) {
    fs.readFile(versionPath, "utf8", function (err, data) {
      if (err) {
        return res.json({ version: "1.0.0", releaseDate: "", updateUrl: "", message: "No version info" });
      }
      try { return res.json(JSON.parse(data)); }
      catch (_e) { return res.json({ version: "1.0.0", releaseDate: "", updateUrl: "", message: "Invalid version file" }); }
    });
  } else {
    return res.json({ version: "1.0.0", releaseDate: "", updateUrl: "" });
  }
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
