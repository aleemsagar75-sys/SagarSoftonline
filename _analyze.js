var fs = require("fs");
var html = fs.readFileSync("dashboard.html", "utf8");
var regex = /style="[^"]*"/g;
var matches = html.match(regex);
console.log("Total inline styles:", matches ? matches.length : 0);
var unique = {};
(matches || []).forEach(function(s) {
  var key = s.substring(0, 120);
  unique[key] = (unique[key] || 0) + 1;
});
Object.keys(unique).forEach(function(k) {
  console.log("(" + unique[k] + "x) " + k);
});
fs.unlinkSync("_analyze.js");
