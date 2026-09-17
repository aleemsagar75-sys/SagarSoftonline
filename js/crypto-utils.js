(function () {
  async function sha256(message) {
    var encoder = new TextEncoder();
    var data = encoder.encode(message);
    var hashBuffer = await crypto.subtle.digest("SHA-256", data);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  async function hashPassword(password) {
    return await sha256(password);
  }

  async function hashPasswordPbkdf2(password, salt) {
    if (!salt) {
      var saltBytes = new Uint8Array(16);
      crypto.getRandomValues(saltBytes);
      salt = Array.from(saltBytes).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
    var encoder = new TextEncoder();
    var passwordKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    var saltBytes = new Uint8Array(salt.match(/.{2}/g).map(function (byte) { return parseInt(byte, 16); }));
    var derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
      passwordKey,
      256
    );
    var hashArray = Array.from(new Uint8Array(derivedBits));
    var hashHex = hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return salt + ":" + hashHex;
  }

  function isPbkdf2Hash(str) {
    return typeof str === "string" && /^[a-f0-9]{32}:[a-f0-9]{64}$/i.test(str);
  }

  async function verifyPassword(inputPassword, storedHashOrPlain) {
    if (isPbkdf2Hash(storedHashOrPlain)) {
      var parts = storedHashOrPlain.split(":");
      var salt = parts[0];
      var expectedHash = parts[1];
      var encoder = new TextEncoder();
      var passwordKey = await crypto.subtle.importKey("raw", encoder.encode(inputPassword), "PBKDF2", false, ["deriveBits"]);
      var saltBytes = new Uint8Array(salt.match(/.{2}/g).map(function (byte) { return parseInt(byte, 16); }));
      var derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
        passwordKey,
        256
      );
      var hashArray = Array.from(new Uint8Array(derivedBits));
      var inputHash = hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      return inputHash === expectedHash;
    }
    if (isHash(storedHashOrPlain)) {
      var inputHash = await sha256(inputPassword);
      return inputHash === storedHashOrPlain;
    }
    return inputPassword === storedHashOrPlain;
  }

  function isHash(str) {
    return typeof str === "string" && /^[a-f0-9]{64}$/i.test(str);
  }

  window.SagarSoftCrypto = {
    hashPassword: hashPassword,
    hashPasswordPbkdf2: hashPasswordPbkdf2,
    verifyPassword: verifyPassword,
    isHash: isHash,
    isPbkdf2Hash: isPbkdf2Hash,
    sha256: sha256
  };
})();
