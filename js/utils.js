/**
 * SagarSoft Utilities — Pure, stateless helper functions.
 * Loaded BEFORE dashboard.js. Consumed via window.SU namespace.
 * dashboard.js aliases these locally so all existing callers work unchanged.
 */
(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  function getInitials(name) {
    return (name || "?")
      .split(" ")
      .map(function (w) { return (w[0] || "").toUpperCase(); })
      .join("")
      .slice(0, 2) || "?";
  }

  function monthLabel(monthValue) {
    var v = String(monthValue || "").trim();
    if (/^\d{4}-\d{2}$/.test(v)) {
      var p = v.split("-");
      var y = Number(p[0]);
      var m = Number(p[1]);
      var months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      if (m >= 1 && m <= 12) return months[m - 1] + ", " + y;
    }
    return v || "N/A";
  }

  function generateId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 9);
  }

  function formatDateInput(value) {
    var date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime())
      ? new Date().toISOString().slice(0, 10)
      : date.toISOString().slice(0, 10);
  }

  function parseFlexibleDate(value) {
    var raw = String(value || "").trim();
    if (!raw) return null;

    var dateFromNative = new Date(raw);
    if (!Number.isNaN(dateFromNative.getTime())) return dateFromNative;

    var ddmmyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      var day = Number(ddmmyyyy[1]);
      var month = Number(ddmmyyyy[2]) - 1;
      var year = Number(ddmmyyyy[3]);
      var parsed = new Date(year, month, day, 23, 59, 59, 999);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return null;
  }

  function addDaysISO(startDate, days) {
    var date = new Date(startDate);
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + Math.max(1, Number(days || 0)));
    return date.toISOString().slice(0, 10);
  }

  function toBase64Unicode(input) {
    try {
      var bytes = new TextEncoder().encode(String(input || ""));
      var binary = "";
      var chunkSize = 0x8000;
      for (var index = 0; index < bytes.length; index += chunkSize) {
        var chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      return btoa(binary);
    } catch (e) {
      return "";
    }
  }

  function fromBase64Unicode(input) {
    try {
      var binary = atob(String(input || ""));
      var bytes = new Uint8Array(binary.length);
      for (var index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new TextDecoder().decode(bytes);
    } catch (e) {
      return "";
    }
  }

  function simpleHash(input) {
    var text = String(input || "");
    var hash = 0;
    for (var index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }
    return String(Math.abs(hash));
  }

  function getPlanDays(plan, customDays) {
    if (plan === "monthly") return 30;
    if (plan === "3-months" || plan === "3months") return 90;
    if (plan === "5-months" || plan === "5months") return 150;
    if (plan === "1-year" || plan === "1year") return 365;
    var parsedDays = Number(customDays || 0);
    return parsedDays > 0 ? parsedDays : 30;
  }

  window.SU = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    getInitials: getInitials,
    monthLabel: monthLabel,
    generateId: generateId,
    formatDateInput: formatDateInput,
    parseFlexibleDate: parseFlexibleDate,
    addDaysISO: addDaysISO,
    toBase64Unicode: toBase64Unicode,
    fromBase64Unicode: fromBase64Unicode,
    simpleHash: simpleHash,
    getPlanDays: getPlanDays
  };
})();
