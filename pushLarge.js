var fs = require("fs");
var https = require("https");

var TOKEN = process.env.GITHUB_PAT || "";
var REPO = "aleemsagar75-sys/SagarSoftonline";
var FILE_PATH = process.argv[2];
var COMMIT_MSG = process.argv[3] || "Update " + FILE_PATH;

function makeRequest(opts, body) {
  return new Promise(function (resolve, reject) {
    var req = https.request(opts, function (res) {
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.setTimeout(120000, function() { req.destroy(); reject(new Error("Request timeout")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function gitRequest(method, path, body) {
  var opts = {
    hostname: "api.github.com",
    path: path,
    method: method,
    headers: {
      Authorization: "token " + TOKEN,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "SagarSoft-Push"
    }
  };
  if (body) {
    var bodyStr = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
    opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    return makeRequest(opts, bodyStr);
  }
  return makeRequest(opts);
}

function gitRequestDebug(label, method, path, body) {
  return gitRequest(method, path, body).then(function(result) {
    if (result && result.message) {
      console.log(label + " response:", result.message, result.documentation_url || "");
    }
    return result;
  });
}

async function run() {
  var content = fs.readFileSync(FILE_PATH, "utf8");
  console.log("Pushing", FILE_PATH, "(" + content.length + " bytes) via Git Blobs API...");

  // Step 1: Get current commit SHA
  var ref = await gitRequest("GET", "/repos/" + REPO + "/git/refs/heads/main");
  var currentCommitSha = ref.object.sha;
  console.log("Current commit:", currentCommitSha.substring(0, 7));

  // Step 2: Get current commit to find tree SHA
  var commit = await gitRequest("GET", "/repos/" + REPO + "/git/commits/" + currentCommitSha);
  var baseTreeSha = commit.tree.sha;

  // Step 3: Create blob (base64 encoding for large files)
  var encoded = Buffer.from(content, "utf8").toString("base64");
  var blob = await gitRequest("POST", "/repos/" + REPO + "/git/blobs", {
    content: encoded,
    encoding: "base64"
  });
  if (!blob.sha) { console.log("Blob failed:", JSON.stringify(blob).substring(0, 500)); return; }
  console.log("Blob created:", blob.sha.substring(0, 7));

  // Step 4: Create tree with the new blob
  var tree = await gitRequestDebug("Tree", "POST", "/repos/" + REPO + "/git/trees", {
    base_tree: baseTreeSha,
    tree: [{
      path: FILE_PATH,
      mode: "100644",
      type: "blob",
      sha: blob.sha
    }]
  });
  if (!tree.sha) { console.log("Tree failed:", JSON.stringify(tree).substring(0, 500)); return; }
  console.log("Tree created:", tree.sha.substring(0, 7));

  // Step 5: Create commit
  var newCommit = await gitRequestDebug("Commit", "POST", "/repos/" + REPO + "/git/commits", {
    message: COMMIT_MSG,
    tree: tree.sha,
    parents: [currentCommitSha]
  });
  if (!newCommit.sha) { console.log("Commit failed:", JSON.stringify(newCommit).substring(0, 500)); return; }
  console.log("Commit created:", newCommit.sha.substring(0, 7));

  // Step 6: Update ref
  var update = await gitRequest("PATCH", "/repos/" + REPO + "/git/refs/heads/main", {
    sha: newCommit.sha,
    force: false
  });
  if (update.ref) {
    console.log("Result: SUCCESS -", newCommit.sha.substring(0, 7));
  } else {
    console.log("Result: Pushed but ref update unclear. Commit:", newCommit.sha ? newCommit.sha.substring(0, 7) : "unknown");
  }
}

run().catch(function (e) { console.log("ERROR:", e.message); console.log("Stack:", e.stack); });
