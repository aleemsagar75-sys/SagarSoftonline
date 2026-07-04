require("dotenv").config({ path: __dirname + "/.env" });

const dns = require("dns");
const crypto = require("crypto");
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

const SUPERADMIN_EMAIL = "aleemsagar@gmail.com";
const SUPERADMIN_PASSWORD_STORED = "8ad8b9ea7b1bd6403a80e42e6dc2d55a1647af2bcc0db0a8cd67bb7e1e60dc54:a5e0813f25285755199ac67d58d25f37ca60b1e0551c1656edf368e6ac323aae1d6d894bb8eba85e8cc8d302ff7f32c9169f44c93af34b13a99d280a1353a5da";
const SUPERADMIN_SESSION_SECRET = String(process.env.SUPERADMIN_SESSION_SECRET || crypto.randomBytes(32).toString("hex")).trim();
const SESSION_SECRET_KEY = SUPERADMIN_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SUPERADMIN_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function hashPassword(password) {
  var salt = crypto.randomBytes(16).toString("hex");
  var hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
  return salt + ":" + hash;
}

function verifyPasswordHash(password, stored) {
  if (!stored) return false;
  if (!stored.includes(":")) return sha256(String(password)) === stored;
  var parts = stored.split(":");
  var salt = parts[0];
  var hash = parts[1];
  var verify = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(verify, "hex"));
}

function generateToken() {
  return "sft-" + crypto.randomBytes(24).toString("hex");
}

function signToken(payload) {
  var data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  var sig = crypto.createHmac("sha256", SESSION_SECRET_KEY).update(data).digest("base64url");
  return data + "." + sig;
}

function verifyToken(token) {
  try {
    var parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    var expectedSig = crypto.createHmac("sha256", SESSION_SECRET_KEY).update(parts[0]).digest("base64url");
    var sigBuf = Buffer.from(parts[1], "base64url");
    var expectedBuf = Buffer.from(expectedSig, "base64url");
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    var payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (_e) {
    return null;
  }
}

const loginRateLimit = {};
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
function checkRateLimit(key) {
  var now = Date.now();
  if (!loginRateLimit[key] || now - loginRateLimit[key].start > RATE_LIMIT_WINDOW_MS) {
    loginRateLimit[key] = { start: now, count: 1 };
    return true;
  }
  loginRateLimit[key].count++;
  return loginRateLimit[key].count <= RATE_LIMIT_MAX;
}
setInterval(function () {
  var now = Date.now();
  Object.keys(loginRateLimit).forEach(function (key) {
    if (now - loginRateLimit[key].start > RATE_LIMIT_WINDOW_MS) delete loginRateLimit[key];
  });
}, 60000);

function requireSuperAdmin(req, res, next) {
  var authHeader = String(req.headers["authorization"] || "").trim();
  var token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ success: false, message: "Super admin authentication required." });
  }
  var payload = verifyToken(token);
  if (!payload || payload.role !== "superadmin") {
    return res.status(401).json({ success: false, message: "Invalid or expired session." });
  }
  req.superAdmin = payload;
  return next();
}

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
  _pool = new Pool({ host: info.host, port: info.port, user: info.user, password: info.password, database: info.database, ssl: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" ? { rejectUnauthorized: true } : { rejectUnauthorized: false } });
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
  "http://localhost:3000"
];

function isOriginAllowed(origin) {
  if (!origin) return true;
  return allowedOrigins.some(function (o) { return origin === o || origin === o + "/"; });
}

if (cors) {
  app.use(cors({
    origin: function (origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    allowedHeaders: ["Content-Type", "x-sagarsoft-api-key", "x-license-token", "Authorization"]
  }));
} else {
  app.use(function (req, res, next) {
    var origin = req.headers.origin || "";
    var allowed = isOriginAllowed(origin);
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
      res.setHeader("Access-Control-Allow-Origin", "https://sagarsoftonline.onrender.com");
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-sagarsoft-api-key, x-license-token, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    return next();
  });
}
app.use(express.json({ limit: "5mb" }));

app.use(function (_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self' https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:;");
  return next();
});

const webDirCandidates = [
  process.env.SAGARSOFT_WEB_DIR,
  path.resolve(__dirname, "..", "sagarsoft"),
  path.resolve(__dirname, ".."),
  __dirname
].filter(Boolean);
const webAppDir = webDirCandidates.find((candidate) => fs.existsSync(path.join(candidate, "dashboard.html")));
if (webAppDir) {
  app.use("/app", express.static(webAppDir));
  app.use(express.static(webAppDir));
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
    return res.status(503).json({ success: false, message: "API key not configured. Service unavailable." });
  }
  const incoming = String(req.headers["x-sagarsoft-api-key"] || "").trim();
  if (incoming !== apiKey) {
    return res.status(401).json({ success: false, message: "Invalid API key." });
  }
  return next();
}

function requireSchoolAuth(req, res, next) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  var authHeader = String(req.headers["authorization"] || "").trim();
  var bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  var schoolToken = String(req.headers["x-school-token"] || req.query.school_token || "").trim();
  var licenseToken = String(req.headers["x-license-token"] || req.query.license_token || "").trim();
  var token = bearerToken || schoolToken || licenseToken;
  if (!token) {
    return res.status(401).json({ success: false, message: "School authentication required." });
  }
  var superPayload = verifyToken(token);
  if (superPayload && superPayload.role === "superadmin") {
    req.authSchoolId = schoolId;
    req.authRole = "superadmin";
    return next();
  }
  pool.query("select school_id, license_token, status, modules_locked, expiry_date from public.license_accounts where school_id = $1 limit 1", [schoolId])
    .then(function (result) {
      if (!result.rowCount) {
        return res.status(401).json({ success: false, message: "School not found." });
      }
      var row = result.rows[0];
      var expectedToken = row.license_token;
      if (!expectedToken || token.length !== expectedToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))) {
        return res.status(401).json({ success: false, message: "Invalid school token." });
      }
      var status = String(row.status || "").toLowerCase();
      if (status !== "active") {
        return res.status(403).json({ success: false, message: "School is not active." });
      }
      if (row.modules_locked) {
        return res.status(403).json({ success: false, message: "School access is locked." });
      }
      if (row.expiry_date) {
        var expiry = new Date(row.expiry_date);
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        if (expiry < today) {
          return res.status(403).json({ success: false, message: "School subscription has expired." });
        }
      }
      req.authSchoolId = row.school_id;
      req.authRole = "school";
      return next();
    })
    .catch(function (err) {
      console.error("requireSchoolAuth error:", err.message);
      return res.status(500).json({ success: false, message: "Auth check failed." });
    });
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
      email text,
      password text,
      status text not null default 'inactive',
      plan text not null default 'monthly',
      start_date date,
      expiry_date date,
      license_token text unique,
      internet_required_after_days integer not null default 9999,
      modules_locked boolean not null default false,
      last_seen timestamptz,
      timezone text default 'Asia/Karachi',
      currency text default 'PKR',
      symbol text default 'Rs',
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
    alter table if exists public.license_accounts drop constraint if exists license_accounts_email_key;
    alter table if exists public.license_accounts add column if not exists api_token text;

    create table if not exists public.exams (
      school_id text not null,
      source_id text not null,
      exam_name text,
      class_name text,
      subject text,
      total_marks numeric,
      pass_marks numeric,
      exam_date date,
      exam_type text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.exam_marks (
      school_id text not null,
      source_id text not null,
      exam_source_id text,
      student_id text,
      student_name text,
      class_name text,
      marks_obtained numeric,
      grade text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.timetable (
      school_id text not null,
      source_id text not null,
      class_name text,
      day text,
      period_number numeric,
      start_time text,
      end_time text,
      subject text,
      teacher_id text,
      room text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.homework (
      school_id text not null,
      source_id text not null,
      class_name text,
      subject text,
      description text,
      due_date date,
      assigned_date date,
      teacher_id text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.class_tests (
      school_id text not null,
      source_id text not null,
      test_name text,
      class_name text,
      subject text,
      total_marks numeric,
      test_date date,
      teacher_id text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.class_test_marks (
      school_id text not null,
      source_id text not null,
      test_source_id text,
      student_id text,
      student_name text,
      marks_obtained numeric,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.question_papers (
      school_id text not null,
      source_id text not null,
      title text,
      class_name text,
      subject text,
      total_marks numeric,
      duration text,
      content text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create table if not exists public.certificates (
      school_id text not null,
      source_id text not null,
      certificate_type text,
      student_id text,
      student_name text,
      class_name text,
      issue_date date,
      template text,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (school_id, source_id)
    );

    create index if not exists idx_exams_school_id on public.exams (school_id);
    create index if not exists idx_exam_marks_school_id on public.exam_marks (school_id);
    create index if not exists idx_timetable_school_id on public.timetable (school_id);
    create index if not exists idx_homework_school_id on public.homework (school_id);
    create index if not exists idx_class_tests_school_id on public.class_tests (school_id);
    create index if not exists idx_class_test_marks_school_id on public.class_test_marks (school_id);
    create index if not exists idx_question_papers_school_id on public.question_papers (school_id);
    create index if not exists idx_certificates_school_id on public.certificates (school_id);
  `);
  console.log("Schema ready");
}

async function ensureSmsTables() {
  if (!_pool) { console.log("SMS tables: DB not connected, skipping."); return; }
  try {
    await _pool.query(`
      CREATE TABLE IF NOT EXISTS sms_queue (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        school_id TEXT NOT NULL,
        device_id TEXT,
        recipient_phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        source TEXT DEFAULT 'Manual SMS',
        campaign_type TEXT DEFAULT 'manual',
        recipient_name TEXT,
        recipient_type TEXT DEFAULT 'student',
        error_message TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sent_messages (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        school_id TEXT,
        device_id TEXT,
        recipient_phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT,
        error_message TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS devices (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        school_id TEXT NOT NULL,
        device_name TEXT,
        device_id TEXT NOT NULL UNIQUE,
        is_active BOOLEAN DEFAULT false,
        sim_number TEXT,
        last_poll_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await _pool.query(`
      GRANT ALL ON TABLE sms_queue TO anon;
      GRANT ALL ON TABLE devices TO anon;
      GRANT ALL ON TABLE sent_messages TO anon;
      GRANT ALL ON TABLE sms_queue TO authenticated;
      GRANT ALL ON TABLE devices TO authenticated;
      GRANT ALL ON TABLE sent_messages TO authenticated;
      ALTER TABLE sms_queue ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sent_messages ENABLE ROW LEVEL SECURITY;
      ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
    `);
    var rlsPolicies = `
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sms_queue_anon_all' AND tablename='sms_queue') THEN CREATE POLICY sms_queue_anon_all ON sms_queue FOR ALL TO anon USING (true) WITH CHECK (true); END IF; END $$;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sms_queue_auth_all' AND tablename='sms_queue') THEN CREATE POLICY sms_queue_auth_all ON sms_queue FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $$;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='devices_anon_all' AND tablename='devices') THEN CREATE POLICY devices_anon_all ON devices FOR ALL TO anon USING (true) WITH CHECK (true); END IF; END $$;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='devices_auth_all' AND tablename='devices') THEN CREATE POLICY devices_auth_all ON devices FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $$;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sent_messages_anon_all' AND tablename='sent_messages') THEN CREATE POLICY sent_messages_anon_all ON sent_messages FOR ALL TO anon USING (true) WITH CHECK (true); END IF; END $$;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sent_messages_auth_all' AND tablename='sent_messages') THEN CREATE POLICY sent_messages_auth_all ON sent_messages FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $$;
    `;
    await _pool.query(rlsPolicies);
    console.log("SMS tables ready with RLS policies.");
  } catch (err) {
    console.error("ensureSmsTables error:", err.message);
  }
}

function normalizeSchoolId(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    console.warn("normalizeSchoolId: empty school_id, using default");
    return defaultSchoolId || "SCH-2026-001";
  }
  return trimmed;
}

function toLicensePayload(row, notifications) {
  const licenseToken = row.license_token || generateToken();
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
      insert into public.app_users (school_id, source_id, name, email, role, active, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
    `, [schoolId, sourceId, row.name || "", row.email || "", row.role || "", row.active !== false, rowData(row)]);
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

async function syncExamTables(client, schoolId, database) {
  const settings = (database && database.generalSettings) || {};
  const exams = Array.isArray(settings.exams) ? settings.exams : [];
  const examMarks = Array.isArray(settings.examMarks) ? settings.examMarks : [];

  await client.query("delete from public.exams where school_id = $1", [schoolId]);
  await client.query("delete from public.exam_marks where school_id = $1", [schoolId]);

  for (let index = 0; index < exams.length; index++) {
    const row = exams[index];
    const sourceId = rowId(row, "EXM", index);
    await client.query(`
      insert into public.exams (id, school_id, source_id, exam_name, class_name, subject, total_marks, pass_marks, exam_date, exam_type, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now())
      on conflict (school_id, source_id) do update set exam_name = excluded.exam_name, class_name = excluded.class_name, subject = excluded.subject, total_marks = excluded.total_marks, pass_marks = excluded.pass_marks, exam_date = excluded.exam_date, exam_type = excluded.exam_type, data = excluded.data, updated_at = now()
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.examName || row.name || "", row.className || "", row.subject || "", Number(row.totalMarks || 0), Number(row.passMarks || 0), emptyToNullDate(row.examDate || row.date), row.examType || row.type || "", rowData(row)]);
  }

  for (let index = 0; index < examMarks.length; index++) {
    const row = examMarks[index];
    const sourceId = rowId(row, "EXK", index);
    await client.query(`
      insert into public.exam_marks (id, school_id, source_id, exam_source_id, student_id, student_name, class_name, marks_obtained, grade, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
      on conflict (school_id, source_id) do update set exam_source_id = excluded.exam_source_id, student_id = excluded.student_id, student_name = excluded.student_name, class_name = excluded.class_name, marks_obtained = excluded.marks_obtained, grade = excluded.grade, data = excluded.data, updated_at = now()
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.examId || row.examSourceId || "", row.studentId || "", row.studentName || row.name || "", row.className || "", Number(row.marksObtained || row.marks || 0), row.grade || "", rowData(row)]);
  }
}

async function syncTimetableTable(client, schoolId, database) {
  const settings = (database && database.generalSettings) || {};
  const timetable = Array.isArray(settings.timetableEntries) ? settings.timetableEntries : [];

  await client.query("delete from public.timetable where school_id = $1", [schoolId]);

  for (let index = 0; index < timetable.length; index++) {
    const row = timetable[index];
    const sourceId = rowId(row, "TBT", index);
    await client.query(`
      insert into public.timetable (id, school_id, source_id, class_name, day, period_number, start_time, end_time, subject, teacher_id, room, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
      on conflict (school_id, source_id) do update set class_name = excluded.class_name, day = excluded.day, period_number = excluded.period_number, start_time = excluded.start_time, end_time = excluded.end_time, subject = excluded.subject, teacher_id = excluded.teacher_id, room = excluded.room, data = excluded.data, updated_at = now()
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.className || "", row.day || "", Number(row.periodNumber || row.period || index + 1), row.startTime || "", row.endTime || "", row.subject || "", row.teacherId || row.teacher || "", row.room || "", rowData(row)]);
  }
}

async function syncHomeworkTable(client, schoolId, database) {
  const settings = (database && database.generalSettings) || {};
  const homework = Array.isArray(settings.homework) ? settings.homework : [];

  await client.query("delete from public.homework where school_id = $1", [schoolId]);

  for (let index = 0; index < homework.length; index++) {
    const row = homework[index];
    const sourceId = rowId(row, "HWK", index);
    await client.query(`
      insert into public.homework (id, school_id, source_id, class_name, subject, description, due_date, assigned_date, teacher_id, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
      on conflict (school_id, source_id) do update set class_name = excluded.class_name, subject = excluded.subject, description = excluded.description, due_date = excluded.due_date, assigned_date = excluded.assigned_date, teacher_id = excluded.teacher_id, data = excluded.data, updated_at = now()
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.className || "", row.subject || "", row.description || row.title || "", emptyToNullDate(row.dueDate), emptyToNullDate(row.assignedDate || row.date), row.teacherId || row.teacher || "", rowData(row)]);
  }
}

async function syncClassTestTables(client, schoolId, database) {
  const settings = (database && database.generalSettings) || {};
  const classTests = Array.isArray(settings.classTests) ? settings.classTests : [];
  const classTestMarks = Array.isArray(settings.classTestMarks) ? settings.classTestMarks : [];

  await client.query("delete from public.class_tests where school_id = $1", [schoolId]);
  await client.query("delete from public.class_test_marks where school_id = $1", [schoolId]);

  for (let index = 0; index < classTests.length; index++) {
    const row = classTests[index];
    const sourceId = rowId(row, "CTE", index);
    await client.query(`
      insert into public.class_tests (id, school_id, source_id, test_name, class_name, subject, total_marks, test_date, teacher_id, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
      on conflict (school_id, source_id) do update set test_name = excluded.test_name, class_name = excluded.class_name, subject = excluded.subject, total_marks = excluded.total_marks, test_date = excluded.test_date, teacher_id = excluded.teacher_id, data = excluded.data, updated_at = now()
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.testName || row.name || "", row.className || "", row.subject || "", Number(row.totalMarks || 0), emptyToNullDate(row.testDate || row.date), row.teacherId || row.teacher || "", rowData(row)]);
  }

  for (let index = 0; index < classTestMarks.length; index++) {
    const row = classTestMarks[index];
    const sourceId = rowId(row, "CTM", index);
    await client.query(`
      insert into public.class_test_marks (id, school_id, source_id, test_source_id, student_id, student_name, marks_obtained, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
      on conflict (school_id, source_id) do update set test_source_id = excluded.test_source_id, student_id = excluded.student_id, student_name = excluded.student_name, marks_obtained = excluded.marks_obtained, data = excluded.data, updated_at = now()
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.testId || row.testSourceId || "", row.studentId || "", row.studentName || row.name || "", Number(row.marksObtained || row.marks || 0), rowData(row)]);
  }
}

async function syncQuestionPapersTable(client, schoolId, database) {
  const settings = (database && database.generalSettings) || {};
  const papers = Array.isArray(settings.questionPapers) ? settings.questionPapers : [];

  await client.query("delete from public.question_papers where school_id = $1", [schoolId]);

  for (let index = 0; index < papers.length; index++) {
    const row = papers[index];
    const sourceId = rowId(row, "QPR", index);
    await client.query(`
      insert into public.question_papers (id, school_id, source_id, title, class_name, subject, total_marks, duration, content, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
      on conflict (school_id, source_id) do update set title = excluded.title, class_name = excluded.class_name, subject = excluded.subject, total_marks = excluded.total_marks, duration = excluded.duration, content = excluded.content, data = excluded.data, updated_at = now()
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.title || row.name || "", row.className || "", row.subject || "", Number(row.totalMarks || 0), row.duration || "", row.content || row.body || "", rowData(row)]);
  }
}

async function syncCertificatesTable(client, schoolId, database) {
  const settings = (database && database.generalSettings) || {};
  const certificates = Array.isArray(settings.certificates) ? settings.certificates : [];

  await client.query("delete from public.certificates where school_id = $1", [schoolId]);

  for (let index = 0; index < certificates.length; index++) {
    const row = certificates[index];
    const sourceId = rowId(row, "CRT", index);
    await client.query(`
      insert into public.certificates (id, school_id, source_id, certificate_type, student_id, student_name, class_name, issue_date, template, data, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
      on conflict (school_id, source_id) do update set certificate_type = excluded.certificate_type, student_id = excluded.student_id, student_name = excluded.student_name, class_name = excluded.class_name, issue_date = excluded.issue_date, template = excluded.template, data = excluded.data, updated_at = now()
    `, [scopedRowIdValue(schoolId, sourceId), schoolId, sourceId, row.certificateType || row.type || "", row.studentId || "", row.studentName || row.name || "", row.className || "", emptyToNullDate(row.issueDate || row.date), row.template || "", rowData(row)]);
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
    await syncExamTables(client, schoolId, database || {});
    await syncTimetableTable(client, schoolId, database || {});
    await syncHomeworkTable(client, schoolId, database || {});
    await syncClassTestTables(client, schoolId, database || {});
    await syncQuestionPapersTable(client, schoolId, database || {});
    await syncCertificatesTable(client, schoolId, database || {});
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
    activityLogs,
    exams,
    examMarks,
    timetable,
    homework,
    classTests,
    classTestMarks,
    questionPapers,
    certificates
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
    readDataRows("activity_logs"),
    readDataRows("exams"),
    readDataRows("exam_marks"),
    readDataRows("timetable"),
    readDataRows("homework"),
    readDataRows("class_tests"),
    readDataRows("class_test_marks"),
    readDataRows("question_papers"),
    readDataRows("certificates")
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
  if (exams.length) database.generalSettings.exams = exams;
  if (examMarks.length) database.generalSettings.examMarks = examMarks;
  if (timetable.length) database.generalSettings.timetableEntries = timetable;
  if (homework.length) database.generalSettings.homework = homework;
  if (classTests.length) database.generalSettings.classTests = classTests;
  if (classTestMarks.length) database.generalSettings.classTestMarks = classTestMarks;
  if (questionPapers.length) database.generalSettings.questionPapers = questionPapers;
  if (certificates.length) database.generalSettings.certificates = certificates;

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
  try {
    await pool.query("select 1");
    res.json({ success: true, message: "SagarSoft online API is running." });
  } catch (error) {
    res.status(503).json({ success: false, message: "Database unavailable." });
  }
});

app.get("/api/database/:schoolId", requireSchoolAuth, async (req, res) => {
  try {
    const schoolId = normalizeSchoolId(req.params.schoolId);
    if (req.authRole !== "superadmin" && req.authSchoolId !== schoolId) {
      return res.status(403).json({ success: false, message: "Access denied to this school's data." });
    }
    const database = await getSchoolDatabase(schoolId);
    if (!database) {
      return res.json({ success: true, school_id: schoolId, database: null });
    }
    return res.json({ success: true, school_id: schoolId, database });
  } catch (err) {
    console.error("GET /api/database error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

app.post("/api/database/:schoolId", requireSchoolAuth, async (req, res) => {
  const schoolId = normalizeSchoolId(req.params.schoolId);
  if (req.authRole !== "superadmin" && req.authSchoolId !== schoolId) {
    return res.status(403).json({ success: false, message: "Access denied to this school's data." });
  }
  const database = req.body && req.body.database ? req.body.database : {};
  try {
    await saveSchoolDatabaseWithMirrors(schoolId, database);
    return res.json({ success: true, school_id: schoolId });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Unable to save online database." });
  }
});

app.post("/api/admin/license", requireSuperAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const schoolId = normalizeSchoolId(body.school_id);
    const schoolName = String(body.school_name || "School Admin").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }
    const hashedPassword = hashPassword(password);
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
      hashedPassword,
      String(body.status || "active").trim().toLowerCase(),
      String(body.plan || "monthly").trim(),
      body.start_date || new Date().toISOString().slice(0, 10),
      body.expiry_date || null,
      String(body.license_token || `LIC-${schoolId}`),
      Number(body.internet_required_after_days || 20),
      Boolean(body.modules_locked)
    ]);
    return res.json({ success: true, school_id: schoolId, license_token: String(body.license_token || `LIC-${schoolId}`) });
  } catch (error) {
    console.error("POST /api/admin/license error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

async function verifySupabaseAuth(email, password) {
  var supaUrl = process.env.SUPABASE_URL;
  var supaKey = process.env.SUPABASE_SECRET_KEY;
  if (!supaUrl || !supaKey) return null;
  try {
    var resp = await fetch(supaUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": supaKey },
      body: JSON.stringify({ email: email, password: password, gotrue_meta_security: {} })
    });
    return resp.ok ? true : false;
  } catch (_e) {
    return null;
  }
}

app.post("/api/activate-school.php", async (req, res) => {
  try {
    var clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    var rateKey = "activate:" + clientIp;
    if (!checkRateLimit(rateKey)) {
      return res.status(429).json({ success: false, message: "Too many login attempts. Please try again later." });
    }
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    var supaOk = await verifySupabaseAuth(email, password);
    if (supaOk === false) return res.status(401).json({ success: false, message: "Invalid school credentials." });
    var row = null;
    if (supaOk === true) {
      row = (await pool.query("select * from public.license_accounts where lower(email) = $1 limit 1", [email])).rows[0];
    } else {
      var _r = await pool.query("select * from public.license_accounts where lower(email) = $1 limit 1", [email]);
      if (!_r.rowCount || !verifyPasswordHash(password, _r.rows[0].password)) return res.status(401).json({ success: false, message: "Invalid school credentials." });
      row = _r.rows[0];
    }
    if (!row) return res.status(401).json({ success: false, message: "Invalid school credentials." });
    await pool.query("update public.license_accounts set last_seen = now() where school_id = $1", [row.school_id]);
    const notes = await pool.query("select id, title, message, created_at from public.license_notifications where school_id = $1 order by created_at desc limit 20", [row.school_id]);
    return res.json(toLicensePayload(row, notes.rows));
  } catch (error) {
    console.error("POST /api/activate-school.php error:", error.message);
    return res.status(500).json({ success: false, message: "Activation failed." });
  }
});

app.post("/api/mobile/login", async (req, res) => {
  var clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  var rateKey = "mobile:" + clientIp;
  if (!checkRateLimit(rateKey)) {
    return res.status(429).json({ success: false, message: "Too many login attempts. Please try again later." });
  }
  try {
    const identifier = String(req.body.identifier || req.body.email || req.body.school_id || "").trim();
    const email = identifier.toLowerCase();
    const password = String(req.body.password || "");
    const requestedRole = String(req.body.role || "admin").trim().toLowerCase();
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "School email / ID and password are required." });
    }
  var _resolveEmail = await pool.query("select email from public.license_accounts where lower(email) = $1 or lower(school_id) = $1 limit 1", [email]);
  var _authEmail = _resolveEmail.rowCount ? _resolveEmail.rows[0].email : email;
  var supaOk = await verifySupabaseAuth(_authEmail, password);
  if (supaOk === false) return res.status(401).json({ success: false, message: "Invalid credentials." });
  if (supaOk === null) {
    var _licCheck = await pool.query("select school_id, password from public.license_accounts where (lower(email) = $1 or lower(school_id) = $1) limit 1", [email]);
    if (!_licCheck.rowCount || !verifyPasswordHash(password, _licCheck.rows[0].password)) return res.status(401).json({ success: false, message: "Invalid credentials." });
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
          and lower(app_user->>'role') = $2
          and lower(coalesce(app_user->>'active', 'true')) <> 'false'
      )
      limit 1
    `, [email, requestedRole]);
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
        verifyPasswordHash(password, entry.password || "") &&
        String(entry.role || "").trim().toLowerCase() === requestedRole &&
        entry.active !== false
      ))
      : null;
    if (!appUser) {
      return res.status(401).json({ success: false, message: "Invalid app user credentials." });
    }
    const notes = await pool.query("select id, title, message, created_at from public.license_notifications where school_id = $1 order by created_at desc limit 20", [license.school_id]);
    return res.json({
      success: true,
      license: toLicensePayload(license, notes.rows),
      user: appUser || { email: identifier, role: requestedRole, name: requestedRole },
      school_id: license.school_id,
      license_token: license.license_token || generateToken(),
      database: database || {}
    });
  }
  const result = await pool.query(`
    select * from public.license_accounts
    where lower(email) = $1 or lower(school_id) = $1
    limit 1
  `, [email]);
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
    license_token: license.license_token || generateToken(),
    database: database || {}
  });
  } catch (error) {
    console.error("POST /api/mobile/login error:", error.message);
    return res.status(500).json({ success: false, message: "Login failed. Please try again." });
  }
});

app.get("/api/mobile/database/:schoolId", async (req, res) => {
  try {
    const schoolId = normalizeSchoolId(req.params.schoolId);
    const token = String(req.query.license_token || req.headers["x-license-token"] || "").trim();
    const license = await findLicenseByToken(schoolId, token);
    if (!license || !isLicenseUsable(license)) {
      return res.status(401).json({ success: false, message: "Invalid or inactive license." });
    }
    return res.json({ success: true, school_id: schoolId, database: await getSchoolDatabase(schoolId) || {} });
  } catch (error) {
    console.error("GET /api/mobile/database/:schoolId error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load school database." });
  }
});

app.post("/api/mobile/database/:schoolId", async (req, res) => {
  try {
    const schoolId = normalizeSchoolId(req.params.schoolId);
    const token = String(req.body.license_token || req.headers["x-license-token"] || "").trim();
    const license = await findLicenseByToken(schoolId, token);
    if (!license || !isLicenseUsable(license)) {
      return res.status(401).json({ success: false, message: "Invalid or inactive license." });
    }
    await saveSchoolDatabaseWithMirrors(schoolId, req.body.database || {});
    return res.json({ success: true, school_id: schoolId });
  } catch (error) {
    console.error("POST /api/mobile/database/:schoolId error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "Unable to save mobile database." });
  }
});

app.post("/api/check-license.php", async (req, res) => {
  const schoolId = normalizeSchoolId(req.body.school_id);
  const token = String(req.body.license_token || "").trim();
  try {
    const result = await pool.query(`
      select * from public.license_accounts
      where school_id = $1 and license_token = $2
      limit 1
    `, [schoolId, token]);
    if (!result.rowCount) {
      return res.status(401).json({ success: false, message: "License not found." });
    }
    const row = result.rows[0];
    const notes = await pool.query("select id, title, message, created_at from public.license_notifications where school_id = $1 order by created_at desc limit 20", [row.school_id]);
    return res.json(toLicensePayload(row, notes.rows));
  } catch (error) {
    console.error("POST /api/check-license.php error:", error.message);
    return res.status(500).json({ success: false, message: "License check failed." });
  }
});

app.post("/api/sync-school-data.php", requireSuperAdmin, async (req, res) => {
  const schoolId = normalizeSchoolId(req.body.school_id);
  const schoolName = String(req.body.school_name || "").trim();
  const status = String(req.body.activation_status || "active").trim().toLowerCase();
  const plan = String(req.body.plan || "monthly").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();
  try {
    const hashedPw = password ? hashPassword(password) : null;
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
      hashedPw,
      status,
      plan,
      req.body.start_date || null,
      req.body.expiry_date || null,
      String(req.body.license_token || `LIC-${schoolId}`)
    ]);
    const result = await pool.query("select * from public.license_accounts where school_id = $1", [schoolId]);
    return res.json({ success: true, license: toLicensePayload(result.rows[0], []) });
  } catch (error) {
    console.error("POST /api/sync-school-data.php error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});



app.get("/api/admin/schools", requireSuperAdmin, async function (req, res) {
  try {
    var rows = await pool.query("select school_id, school_name, email, status, plan, start_date, expiry_date, modules_locked, last_seen, timezone, currency, symbol, created_at, updated_at from public.license_accounts order by updated_at desc");
    return res.json({ success: true, schools: rows.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/schools/resequence", requireSuperAdmin, async function (req, res) {
  var rateKey = "resequence:" + (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown");
  if (!checkRateLimit(rateKey)) {
    return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
  }
  try {
    await pool.query("ALTER TABLE public.license_notifications DROP CONSTRAINT IF EXISTS license_notifications_school_id_fkey");
    await pool.query("ALTER TABLE public.school_databases DROP CONSTRAINT IF EXISTS school_databases_school_id_fkey");
    await pool.query("DELETE FROM public.license_notifications WHERE school_id NOT IN (SELECT school_id FROM public.license_accounts)");
    var _rows = await pool.query("SELECT school_id FROM public.license_accounts ORDER BY created_at asc");
    var _year = new Date().getFullYear();
    var _updates = [];
    for (var _i = 0; _i < _rows.rows.length; _i++) {
      var _temp = "__TEMP_RESEQ_" + _i + "__";
      await pool.query("UPDATE public.license_accounts SET school_id = $1 WHERE school_id = $2", [_temp, _rows.rows[_i].school_id]);
      await pool.query("UPDATE public.school_databases SET school_id = $1 WHERE school_id = $2", [_temp, _rows.rows[_i].school_id]);
      await pool.query("UPDATE public.license_notifications SET school_id = $1 WHERE school_id = $2", [_temp, _rows.rows[_i].school_id]);
      _updates.push({ old: _rows.rows[_i].school_id, temp: _temp });
    }
    for (var _j = 0; _j < _updates.length; _j++) {
      var _newId = "SCH-" + _year + "-" + String(_j + 1).padStart(3, '0');
      await pool.query("UPDATE public.license_accounts SET school_id = $1 WHERE school_id = $2", [_newId, _updates[_j].temp]);
      await pool.query("UPDATE public.school_databases SET school_id = $1 WHERE school_id = $2", [_newId, _updates[_j].temp]);
      await pool.query("UPDATE public.license_notifications SET school_id = $1 WHERE school_id = $2", [_newId, _updates[_j].temp]);
      _updates[_j].new_id = _newId;
    }
    await pool.query("ALTER TABLE public.license_notifications ADD CONSTRAINT license_notifications_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.license_accounts(school_id) ON DELETE CASCADE");
    var _result = await pool.query("SELECT school_id FROM public.license_accounts ORDER BY school_id asc");
    return res.json({ success: true, schools: _result.rows, updated: _updates.length });
  } catch (error) {
    console.error("POST /api/admin/schools/resequence error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/schools", requireSuperAdmin, async function (req, res) {
  var schoolName = String(req.body.school_name || "").trim();
  var email = String(req.body.email || "").trim().toLowerCase();
  var password = String(req.body.password || "").trim();
  var plan = String(req.body.plan || "premium").trim();
  var startDate = req.body.start_date || null;
  var expiryDate = req.body.expiry_date || null;
  if (!schoolName) return res.status(400).json({ success: false, message: "School name is required." });
  if (!email) return res.status(400).json({ success: false, message: "Email is required." });
  if (!password) return res.status(400).json({ success: false, message: "Password is required." });
  var _client = await pool.connect();
  var _newApiToken = generateToken();
  try {
    await _client.query("begin");
    var _dupCheck = await _client.query("select school_id from public.license_accounts where email = $1", [email]);
    if (_dupCheck.rows.length > 0) { await _client.query("rollback"); _client.release(); return res.status(409).json({ success: false, message: "This email is already registered with school: " + _dupCheck.rows[0].school_id + ". Use a different email." }); }
    var _year = new Date().getFullYear();
    var _maxResult = await _client.query("select max(school_id) as max_id from public.license_accounts where school_id like $1", ["SCH-" + _year + "-%"]);
    var _lastId = _maxResult.rows[0].max_id;
    var _num = 1;
    if (_lastId) { var _parts = _lastId.split('-'); _num = parseInt(_parts[_parts.length - 1], 10) + 1; }
    var schoolId = "SCH-" + _year + "-" + String(_num).padStart(3, '0');
    var hashedPassword = hashPassword(password);
    var _newToken = "LIC-" + schoolId;
    await _client.query("insert into public.license_accounts (school_id, school_name, email, password, plan, status, start_date, expiry_date, modules_locked, timezone, currency, symbol, license_token, api_token, created_at, updated_at) values ($1,$2,$3,$4,$5,'active',$6,$7,false,'Asia/Karachi','PKR','Rs',$8,$9,now(),now())", [schoolId, schoolName, email, hashedPassword, plan, startDate, expiryDate, _newToken, _newApiToken]);
    await _client.query("commit");
    _client.release();

    var supabaseUrl = process.env.SUPABASE_URL;
    var supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (supabaseUrl && supabaseKey) {
      try {
        var _supaResp = await fetch(supabaseUrl + "/auth/v1/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey },
          body: JSON.stringify({ email: email, password: password, email_confirm: true, user_metadata: { school_id: schoolId, school_name: schoolName } })
        });
        if (_supaResp.ok) { console.log("Supabase Auth user created for", email); }
        else {
          console.error("Supabase Auth user creation failed:", _supaResp.status);
          if (_supaResp.status === 422 || _supaResp.status === 409) {
            try {
              var _listResp = await fetch(supabaseUrl + "/auth/v1/admin/users?filter%5Bemail%5D=" + encodeURIComponent(email), { headers: { apikey: supabaseKey, Authorization: "Bearer " + supabaseKey } });
              if (_listResp.ok) {
                var _listData = await _listResp.json();
                if (_listData.users && _listData.users.length > 0) {
                  await fetch(supabaseUrl + "/auth/v1/admin/users/" + _listData.users[0].id, { method: "PUT", headers: { "Content-Type": "application/json", apikey: supabaseKey, Authorization: "Bearer " + supabaseKey }, body: JSON.stringify({ user_metadata: { school_id: schoolId, school_name: schoolName }, email_confirm: true }) });
                  console.log("Supabase Auth user updated for " + email + " to school:" + schoolId);
                }
              }
            } catch (_e2) { console.error("Supabase Auth fallback error:", _e2.message); }
          }
        }
      } catch (_supabaseError) { console.error("Supabase Auth error:", _supabaseError.message); }
    }

    return res.json({ success: true, school_id: schoolId, version: "v2.2-auth-fix" });
  } catch (error) {
    try { await _client.query("rollback"); } catch (_e3) {}
    try { _client.release(); } catch (_e4) {}
    console.error("POST /api/admin/schools error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/auth/superadmin", async function (req, res) {
  try {
    var clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    var rateKey = "superadmin:" + clientIp;
    if (!checkRateLimit(rateKey)) {
      return res.status(429).json({ success: false, message: "Too many login attempts. Please try again later." });
    }
    var email = String(req.body.email || "").trim().toLowerCase();
    var password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }
    if (email !== SUPERADMIN_EMAIL) {
      return res.status(401).json({ success: false, message: "Invalid super admin credentials." });
    }
    if (!verifyPasswordHash(password, SUPERADMIN_PASSWORD_STORED)) {
      return res.status(401).json({ success: false, message: "Invalid super admin credentials." });
    }
    var tokenPayload = {
      role: "superadmin",
      email: email,
      name: "SagarSoft Super Admin",
      iat: Date.now(),
      exp: Date.now() + SUPERADMIN_TOKEN_EXPIRY_MS
    };
    var token = signToken(tokenPayload);
    return res.json({
      success: true,
      message: "Login successful.",
      token: token,
      user: { id: "USR-SUPER-001", name: tokenPayload.name, email: email, role: "superadmin" }
    });
  } catch (error) {
    console.error("POST /api/auth/superadmin error:", error.message);
    return res.status(500).json({ success: false, message: "Login failed." });
  }
});

app.put("/api/admin/schools/:schoolId", requireSuperAdmin, async function (req, res) {
  var schoolId = String(req.params.schoolId || "").trim();
  if (!schoolId) return res.status(400).json({ success: false, message: "School ID is required." });
  var body = req.body || {};
  try {
    var sets = [];
    var vals = [];
    var idx = 1;
    if (body.school_name !== undefined) { sets.push("school_name = $" + idx); vals.push(String(body.school_name)); idx++; }
    if (body.email !== undefined) { sets.push("email = $" + idx); vals.push(String(body.email).trim().toLowerCase()); idx++; }
    if (body.password !== undefined) { sets.push("password = $" + idx); vals.push(await hashPassword(String(body.password))); idx++; }
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
    return res.json({ success: true, school_id: schoolId });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/admin/schools/:schoolId", requireSuperAdmin, async function (req, res) {
  var schoolId = String(req.params.schoolId || "").trim();
  if (!schoolId) return res.status(400).json({ success: false, message: "School ID is required." });
  var _client = await pool.connect();
  try {
    var _delResult = await _client.query("select email from public.license_accounts where school_id = $1", [schoolId]);
    var _delEmail = _delResult.rows.length > 0 ? _delResult.rows[0].email : null;

    var _mustTables = ["license_notifications", "school_databases", "license_accounts"];
    await _client.query("begin");
    for (var _i = 0; _i < _mustTables.length; _i++) {
      await _client.query("DELETE FROM public." + _mustTables[_i] + " WHERE school_id = $1", [schoolId]);
    }
    await _client.query("commit");

    var _optTables = ["sms_queue", "sent_messages", "devices"];
    for (var _j = 0; _j < _optTables.length; _j++) {
      try {
        await _client.query("SAVEPOINT sp_" + _optTables[_j]);
        await _client.query("DELETE FROM public." + _optTables[_j] + " WHERE school_id = $1", [schoolId]);
        await _client.query("RELEASE SAVEPOINT sp_" + _optTables[_j]);
      } catch (_e) {
        try { await _client.query("ROLLBACK TO SAVEPOINT sp_" + _optTables[_j]); } catch (_e2) {}
      }
    }

    var supabaseUrl = process.env.SUPABASE_URL;
    var supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (_delEmail && supabaseUrl && supabaseKey) {
      try {
        var _delListResp = await fetch(supabaseUrl + "/auth/v1/admin/users?filter%5Bemail%5D=" + encodeURIComponent(_delEmail), { headers: { apikey: supabaseKey, Authorization: "Bearer " + supabaseKey } });
        if (_delListResp.ok) {
          var _delListData = await _delListResp.json();
          if (_delListData.users && _delListData.users.length > 0) {
            var _delUid = _delListData.users[0].id;
            await fetch(supabaseUrl + "/auth/v1/admin/users/" + _delUid, { method: "DELETE", headers: { apikey: supabaseKey, Authorization: "Bearer " + supabaseKey } });
            console.log("Supabase Auth user deleted for", _delEmail);
          }
        }
      } catch (_delSupaErr) { console.error("Supabase Auth delete error:", _delSupaErr.message); }
    }

    _client.release();
    return res.json({ success: true, message: "School permanently deleted." });
  } catch (error) {
    try { await _client.query("rollback"); } catch (_e) {}
    try { _client.release(); } catch (_e) {}
    console.error("DELETE /api/admin/schools error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/schools/:schoolId/reset-tokens", requireSuperAdmin, async function (req, res) {
  var rateKey = "reset-tokens:" + (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown");
  if (!checkRateLimit(rateKey)) {
    return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
  }
  var schoolId = String(req.params.schoolId || "").trim();
  if (!schoolId) return res.status(400).json({ success: false, message: "School ID is required." });
  try {
    var newToken = "sft-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
    await pool.query("update public.license_accounts set license_token = $1, updated_at = now() where school_id = $2", [newToken, schoolId]);
    return res.json({ success: true, message: "Tokens reset.", token: newToken });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/notifications", requireSuperAdmin, async function (req, res) {
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

app.get("/api/admin/notifications", requireSuperAdmin, async function (req, res) {
  try {
    var result = await pool.query("select n.id, n.school_id, n.title, n.message, n.created_at, coalesce(a.school_name,'') as school_name from public.license_notifications n left join public.license_accounts a on n.school_id = a.school_id order by n.created_at desc limit 100");
    return res.json({ success: true, notifications: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/admin/notifications", requireSuperAdmin, async function (req, res) {
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
  app_users: "app_users",
  exams: "exams",
  exam_marks: "exam_marks",
  timetable: "timetable",
  homework: "homework",
  class_tests: "class_tests",
  class_test_marks: "class_test_marks",
  question_papers: "question_papers",
  certificates: "certificates"
};

function sanitizeTableName(table) {
  var name = String(table || "").trim().toLowerCase();
  return ALLOWED_TABLES[name] || null;
}

app.get("/api/data/:schoolId/:table", requireSchoolAuth, async function (req, res) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  if (req.authSchoolId !== schoolId && req.authRole !== "superadmin") {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
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

app.post("/api/data/:schoolId/:table", requireSchoolAuth, async function (req, res) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  if (req.authSchoolId !== schoolId && req.authRole !== "superadmin") {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
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

app.put("/api/data/:schoolId/:table/:id", requireSchoolAuth, async function (req, res) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  if (req.authSchoolId !== schoolId && req.authRole !== "superadmin") {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
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

app.delete("/api/data/:schoolId/:table/:id", requireSchoolAuth, async function (req, res) {
  var schoolId = normalizeSchoolId(req.params.schoolId);
  if (req.authSchoolId !== schoolId && req.authRole !== "superadmin") {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
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

app.post("/api/backup", requireApiKey, async function (req, res) {
  var rateKey = "backup:" + (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown");
  if (!checkRateLimit(rateKey)) {
    return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
  }
  var schoolId = String(req.body.school_id || "").trim();
  var database = req.body.database || {};
  if (!schoolId) return res.status(400).json({ success: false, message: "School ID required." });
  try {
    var _schoolCheck = await pool.query("select 1 from public.license_accounts where school_id = $1 limit 1", [schoolId]);
    if (!_schoolCheck.rowCount) {
      return res.status(404).json({ success: false, message: "School not found." });
    }
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
    return ensureSmsTables();
  })
  .then(function () {
    app.listen(port, function () {
      console.log("SagarSoft online API listening on " + port);
    });
  })
  .catch(function (error) {
    console.error("Unable to start SagarSoft online API:", error);
    process.exit(1);
  });

app.get("/api/supabase-config", function (req, res) {
  var supabaseUrl = process.env.SUPABASE_URL || "";
  var anonKey = process.env.SUPABASE_ANON_KEY || "";
  return res.json({
    success: true,
    url: supabaseUrl,
    anonKey: anonKey
  });
});

app.get("/api/sms/device-status", async function (req, res) {
  try {
    var schoolId = String(req.query.school_id || "").trim();
    if (!schoolId) return res.json({ success: true, device: null });
    var supabaseUrl = process.env.SUPABASE_URL || "";
    var anonKey = process.env.SUPABASE_ANON_KEY || "";
    if (!supabaseUrl || !anonKey) return res.json({ success: true, device: null });
    var url = supabaseUrl + "/rest/v1/devices?school_id=eq." + encodeURIComponent(schoolId) + "&select=sim_number,last_poll_at,is_active,device_id,created_at&limit=1";
    var resp = await fetch(url, { headers: { "apikey": anonKey, "Authorization": "Bearer " + anonKey } });
    var data = await resp.json();
    var device = Array.isArray(data) && data.length > 0 ? data[0] : null;
    return res.json({ success: true, device: device });
  } catch (e) {
    return res.json({ success: true, device: null, error: e.message });
  }
});

app.post("/api/sms/mark-sent", async function (req, res) {
  try {
    var smsId = req.body.sms_id;
    var deviceId = req.body.device_id || "";
    if (!smsId) return res.status(400).json({ success: false, message: "sms_id required" });
    var supabaseUrl = process.env.SUPABASE_URL || "";
    var anonKey = process.env.SUPABASE_ANON_KEY || "";
    if (!supabaseUrl || !anonKey) return res.status(500).json({ success: false, message: "Supabase not configured" });
    var now = new Date().toISOString();
    var url = supabaseUrl + "/rest/v1/rpc/update_sms_status";
    var resp = await fetch(url, {
      method: "POST",
      headers: { "apikey": anonKey, "Authorization": "Bearer " + anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_sms_id: smsId, p_status: "sent", p_device_id: deviceId, p_sent_at: now })
    });
    if (!resp.ok) {
      var bodyText = await resp.text();
      return res.json({ success: true, fallback: true, message: bodyText });
    }
    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

app.post("/api/sms/mark-failed", async function (req, res) {
  try {
    var smsId = req.body.sms_id;
    var errorMsg = req.body.error || "send-failed";
    if (!smsId) return res.status(400).json({ success: false, message: "sms_id required" });
    var supabaseUrl = process.env.SUPABASE_URL || "";
    var anonKey = process.env.SUPABASE_ANON_KEY || "";
    if (!supabaseUrl || !anonKey) return res.status(500).json({ success: false, message: "Supabase not configured" });
    var url = supabaseUrl + "/rest/v1/sms_queue?id=eq." + encodeURIComponent(smsId);
    var resp = await fetch(url, {
      method: "PATCH",
      headers: { "apikey": anonKey, "Authorization": "Bearer " + anonKey, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "failed", error_message: errorMsg })
    });
    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

app.post("/api/sms/retry-failed", async function (req, res) {
  try {
    var schoolId = req.body.school_id;
    if (!schoolId) return res.status(400).json({ success: false, message: "school_id required" });
    var supabaseUrl = process.env.SUPABASE_URL || "";
    var anonKey = process.env.SUPABASE_ANON_KEY || "";
    if (!supabaseUrl || !anonKey) return res.status(500).json({ success: false, message: "Supabase not configured" });
    var url = supabaseUrl + "/rest/v1/sms_queue?school_id=eq." + encodeURIComponent(schoolId) + "&status=eq.failed";
    var patchUrl = supabaseUrl + "/rest/v1/sms_queue?school_id=eq." + encodeURIComponent(schoolId) + "&status=eq.failed";
    var countResp = await fetch(url, {
      method: "GET",
      headers: { "apikey": anonKey, "Authorization": "Bearer " + anonKey, "Content-Type": "application/json", "Prefer": "count=exact" }
    });
    var count = 0;
    try {
      var countHeader = countResp.headers.get("content-range") || "";
      var match = countHeader.match(/\/(\d+)$/);
      if (match) count = parseInt(match[1], 10);
    } catch (_e) {}
    if (count === 0) return res.json({ success: true, retried: 0 });
    var patchResp = await fetch(patchUrl, {
      method: "PATCH",
      headers: { "apikey": anonKey, "Authorization": "Bearer " + anonKey, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "pending", error_message: null })
    });
    return res.json({ success: true, retried: count });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

app.post("/api/setup-sms-tables", async function (req, res) {
  try {
    if (!_pool) {
      return res.status(500).json({ success: false, message: "Database not connected." });
    }
    var sql = `
      CREATE TABLE IF NOT EXISTS sms_queue (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        school_id TEXT NOT NULL,
        device_id TEXT,
        recipient_phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        source TEXT DEFAULT 'Manual SMS',
        campaign_type TEXT DEFAULT 'manual',
        recipient_name TEXT,
        recipient_type TEXT DEFAULT 'student',
        error_message TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sent_messages (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        school_id TEXT,
        device_id TEXT,
        recipient_phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT,
        error_message TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS devices (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        school_id TEXT NOT NULL,
        device_name TEXT,
        device_id TEXT NOT NULL UNIQUE,
        is_active BOOLEAN DEFAULT false,
        sim_number TEXT,
        last_poll_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;
    await _pool.query(sql);

    var rpcSql = `
      CREATE OR REPLACE FUNCTION create_tables()
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $$
      BEGIN
        CREATE TABLE IF NOT EXISTS sms_queue (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          school_id TEXT NOT NULL,
          device_id TEXT,
          recipient_phone TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          source TEXT DEFAULT 'Manual SMS',
          campaign_type TEXT DEFAULT 'manual',
          recipient_name TEXT,
          recipient_type TEXT DEFAULT 'student',
          error_message TEXT,
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS sent_messages (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          school_id TEXT,
          device_id TEXT,
          recipient_phone TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT,
          error_message TEXT,
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS devices (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          school_id TEXT NOT NULL,
          device_name TEXT,
          device_id TEXT NOT NULL UNIQUE,
          is_active BOOLEAN DEFAULT false,
          sim_number TEXT,
          last_poll_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      END;
      $$;
    `;
    await _pool.query(rpcSql);

    var grants = `
      GRANT EXECUTE ON FUNCTION create_tables TO anon;
      GRANT EXECUTE ON FUNCTION create_tables TO authenticated;
      GRANT ALL ON TABLE sms_queue TO anon;
      GRANT ALL ON TABLE devices TO anon;
      GRANT ALL ON TABLE sent_messages TO anon;
      GRANT ALL ON TABLE sms_queue TO authenticated;
      GRANT ALL ON TABLE devices TO authenticated;
      GRANT ALL ON TABLE sent_messages TO authenticated;
      ALTER TABLE sms_queue ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sent_messages ENABLE ROW LEVEL SECURITY;
      ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
    `;
    try { await _pool.query(grants); } catch (_grantErr) {}

    var rlsPolicies = `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sms_queue_anon_all' AND tablename='sms_queue') THEN
          CREATE POLICY sms_queue_anon_all ON sms_queue FOR ALL TO anon USING (true) WITH CHECK (true);
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sms_queue_auth_all' AND tablename='sms_queue') THEN
          CREATE POLICY sms_queue_auth_all ON sms_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='devices_anon_all' AND tablename='devices') THEN
          CREATE POLICY devices_anon_all ON devices FOR ALL TO anon USING (true) WITH CHECK (true);
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='devices_auth_all' AND tablename='devices') THEN
          CREATE POLICY devices_auth_all ON devices FOR ALL TO authenticated USING (true) WITH CHECK (true);
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sent_messages_anon_all' AND tablename='sent_messages') THEN
          CREATE POLICY sent_messages_anon_all ON sent_messages FOR ALL TO anon USING (true) WITH CHECK (true);
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sent_messages_auth_all' AND tablename='sent_messages') THEN
          CREATE POLICY sent_messages_auth_all ON sent_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `;
    try { await _pool.query(rlsPolicies); } catch (_rlsErr) { console.error("RLS policy error:", _rlsErr.message); }

    var rpcFn = `
      CREATE OR REPLACE FUNCTION update_sms_status(p_sms_id UUID, p_status TEXT, p_device_id TEXT, p_sent_at TIMESTAMPTZ)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        UPDATE sms_queue SET status = p_status, device_id = p_device_id, sent_at = p_sent_at WHERE id = p_sms_id;
      END; $$;
      GRANT EXECUTE ON FUNCTION update_sms_status TO anon;
      GRANT EXECUTE ON FUNCTION update_sms_status TO authenticated;
    `;
    try { await _pool.query(rpcFn); } catch (_rpcErr) { console.error("RPC function error:", _rpcErr.message); }

    return res.json({ success: true, message: "SMS tables created successfully." });
  } catch (error) {
    console.error("POST /api/setup-sms-tables error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

function gracefulShutdown(signal) {
  console.log("Received " + signal + ". Shutting down gracefully...");
  if (_pool) {
    _pool.end().then(function () {
      console.log("Database pool closed.");
      process.exit(0);
    }).catch(function () {
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
}
process.on("SIGTERM", function () { gracefulShutdown("SIGTERM"); });
process.on("SIGINT", function () { gracefulShutdown("SIGINT"); });
