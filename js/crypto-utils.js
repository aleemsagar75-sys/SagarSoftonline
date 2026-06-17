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

  async function verifyPassword(inputPassword, storedHashOrPlain) {
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
    verifyPassword: verifyPassword,
    isHash: isHash,
    sha256: sha256
  };
})();
