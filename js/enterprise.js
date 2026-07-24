/**
 * SagarSoft Enterprise Module
 * - Offline Operations Queue (IndexedDB)
 * - Conflict Detection (updated_at)
 * - Real-time Sync (Supabase Realtime / polling fallback)
 * - Optimistic UI
 * Loaded AFTER storage.js. Exposes window.SagarSoftEnterprise.
 */
(function () {
  "use strict";

  var DB_NAME = "sagarsoft_offline_db";
  var DB_VERSION = 1;
  var STORE_NAME = "pending_ops";
  var _db = null;
  var _online = typeof navigator !== "undefined" ? navigator.onLine !== false : true;
  var _pollTimer = null;
  var _conflictCallbacks = [];

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
          store.createIndex("schoolId", "schoolId", { unique: false });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
      req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  async function enqueueOperation(op) {
    var db = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      op.timestamp = Date.now();
      op.status = "pending";
      op.id = undefined;
      var req = store.add(op);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function getPendingOps() {
    var db = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, "readonly");
      var store = tx.objectStore(STORE_NAME);
      var req = store.getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function removePendingOp(id) {
    var db = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      var req = store.delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function clearPendingOps() {
    var db = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      var req = store.clear();
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function processPendingOps() {
    if (!_online) return;
    var SDB = window.SagarSoftDB;
    if (!SDB) return;
    var ops = await getPendingOps();
    if (!ops.length) return;
    var schoolId = SDB.getSchoolId && SDB.getSchoolId();
    if (!schoolId) return;
    ops.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      try {
        if (op.type === "full_sync") {
          var db = SDB.getDatabase && SDB.getDatabase();
          if (db) await SDB.saveDatabase();
        } else {
          await SDB.saveRecord(op.table, op.record, op.operation);
        }
        await removePendingOp(op.id);
      } catch (e) {
        op.status = "failed";
        op.lastError = String(e.message || e);
        op.retries = (op.retries || 0) + 1;
        if (op.retries > 5) {
          await removePendingOp(op.id);
        }
        break;
      }
    }
  }

  function checkConflict(serverRecord, clientRecord) {
    if (!serverRecord || !clientRecord) return false;
    var serverTime = serverRecord.updated_at ? new Date(serverRecord.updated_at).getTime() : 0;
    var clientTime = clientRecord.updated_at ? new Date(clientRecord.updated_at).getTime() : 0;
    if (serverTime > clientTime && clientTime > 0) return true;
    if (serverRecord.version != null && clientRecord.version != null) {
      if (Number(serverRecord.version) > Number(clientRecord.version)) return true;
    }
    return false;
  }

  function onConflict(callback) {
    if (typeof callback === "function") _conflictCallbacks.push(callback);
  }

  function notifyConflict(conflict) {
    _conflictCallbacks.forEach(function (cb) {
      try { cb(conflict); } catch (_e) {}
    });
    window.dispatchEvent(new CustomEvent("sagarsoft:conflict", { detail: conflict }));
  }

  function startRealtimeSync(intervalMs) {
    intervalMs = intervalMs || 30000;
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(async function () {
      if (!_online) return;
      var SDB = window.SagarSoftDB;
      if (!SDB || !SDB.getSchoolId || !SDB.getSchoolId()) return;
      try {
        await processPendingOps();
        var payload = await SDB.apiFetch("/api/database/" + SDB.getSchoolId(), { timeoutMs: 30000, retries: 1 });
        if (payload && payload.database) {
          var current = SDB.getDatabase();
          var serverStudents = (payload.database.students || []).length;
          var localStudents = (current && current.students || []).length;
          if (Math.abs(serverStudents - localStudents) > 0) {
            window.dispatchEvent(new CustomEvent("sagarsoft:remote-change", {
              detail: { source: "poll", serverDb: payload.database }
            }));
          }
        }
      } catch (_e) {}
    }, intervalMs);
    window.addEventListener("online", function () {
      _online = true;
      processPendingOps();
    });
    window.addEventListener("offline", function () {
      _online = false;
    });
  }

  function stopRealtimeSync() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  async function handleRemoteChange(serverDb) {
    var SDB = window.SagarSoftDB;
    if (!SDB) return;
    var current = SDB.getDatabase();
    if (!current) return;
    var conflicts = [];
    var serverStudents = serverDb.students || [];
    var localStudents = current.students || [];
    for (var i = 0; i < serverStudents.length; i++) {
      var sr = serverStudents[i];
      var lr = localStudents.find(function (s) { return s.id === sr.id; });
      if (lr && checkConflict(sr, lr)) {
        conflicts.push({ table: "students", serverRecord: sr, localRecord: lr });
      }
    }
    if (conflicts.length > 0) {
      notifyConflict({ conflicts: conflicts, serverDb: serverDb });
      return false;
    }
    return true;
  }

  window.SagarSoftEnterprise = {
    enqueueOperation: enqueueOperation,
    getPendingOps: getPendingOps,
    removePendingOp: removePendingOp,
    clearPendingOps: clearPendingOps,
    processPendingOps: processPendingOps,
    checkConflict: checkConflict,
    onConflict: onConflict,
    notifyConflict: notifyConflict,
    startRealtimeSync: startRealtimeSync,
    stopRealtimeSync: stopRealtimeSync,
    handleRemoteChange: handleRemoteChange,
    isOnline: function () { return _online; }
  };
})();
