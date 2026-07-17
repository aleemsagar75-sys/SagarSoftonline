var fs = require("fs");
var https = require("https");

var TOKEN = process.env.GITHUB_PAT || "";
var REPO = "aleemsagar75-sys/SagarSoftonline";
var FILE_PATH = process.argv[2] || "server/server.js";
var COMMIT_MSG = process.argv[3] || "Update " + FILE_PATH;

var content = fs.readFileSync(FILE_PATH, "utf8");
var encoded = Buffer.from(content).toString("base64");

function makeRequest(opts, body) {
  return new Promise(function (resolve, reject) {
    var req = https.request(opts, function (res) {
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  var getOpts = {
    hostname: "api.github.com",
    path: "/repos/" + REPO + "/contents/" + FILE_PATH,
    method: "GET",
    headers: {
      Authorization: "token " + TOKEN,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "SagarSoft-Push"
    }
  };

  console.log("Pushing", FILE_PATH, "(" + content.length + " bytes)...");
  var current = await makeRequest(getOpts);
  var sha = current.sha;

  var putBody = JSON.stringify({
    message: COMMIT_MSG,
    content: encoded,
    sha: sha,
    branch: "main"
  });

  var putOpts = {
    hostname: "api.github.com",
    path: "/repos/" + REPO + "/contents/" + FILE_PATH,
    method: "PUT",
    headers: {
      Authorization: "token " + TOKEN,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "SagarSoft-Push",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(putBody)
    }
  };

  var result = await makeRequest(putOpts, putBody);
  console.log("Result:", result.commit ? "SUCCESS - " + result.commit.sha.substring(0,7) : "FAILED");
}

run().catch(function (e) { console.log("ERROR:", e.message); });
