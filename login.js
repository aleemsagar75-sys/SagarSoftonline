/* Major section: Login page interactions and validation */
document.addEventListener("DOMContentLoaded", function () {
  const loginForm = document.getElementById("loginForm");
  const roleInput = document.getElementById("role");
  const roleButtons = document.querySelectorAll(".role-option");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const rememberMeInput = document.getElementById("rememberMe");
  const togglePasswordButton = document.getElementById("togglePassword");
  const fillDemoButton = document.getElementById("fillDemoBtn");
  const formMessage = document.getElementById("formMessage");

  const startupParams = new URLSearchParams(window.location.search);
  if (startupParams.get("freshStart") === "1") {
    window.SagarSoftAuth.logout();
    window.history.replaceState(null, "", "./login.html");
  }

  // Clear form fields on every load (prevents cached values from back navigation)
  if (loginForm) loginForm.reset();
  if (formMessage) { formMessage.textContent = ""; formMessage.className = "form-message"; }

  // Crash recovery: if a demo snapshot exists but no active session, restore clean state
  (function () {
    try {
      var snapRaw = sessionStorage.getItem("sagarsoft_demo_snapshot");
      if (snapRaw && !window.SagarSoftAuth.getCurrentUser()) {
        var snap = JSON.parse(snapRaw);
        if (snap && window.SagarSoftDB && typeof window.SagarSoftDB.saveDatabase === "function") {
          window.SagarSoftDB.saveDatabase(snap);
        }
        sessionStorage.removeItem("sagarsoft_demo_snapshot");
      }
    } catch (_e) {}
  })();

  const demoAccounts = {
    admin: { email: "admin@sagarsoft.com", password: "admin123" },
    teacher: { email: "teacher@sagarsoft.com", password: "teacher123" },
    student: { email: "student@sagarsoft.com", password: "student123" },
    parent: { email: "parent@sagarsoft.com", password: "parent123" }
  };

  // If a user is already logged in, send them directly to the dashboard.
  const currentUser = window.SagarSoftAuth.getCurrentUser();
  if (currentUser) {
    window.location.href = "./dashboard.html";
    return;
  }

  function showMessage(message, type) {
    formMessage.textContent = message;
    formMessage.className = `form-message ${type}`;
  }

  function clearMessage() {
    formMessage.textContent = "";
    formMessage.className = "form-message";
  }

  function setRole(role) {
    roleInput.value = role;

    roleButtons.forEach(function (button) {
      const isActive = button.dataset.role === role;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    clearMessage();
  }

  roleButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setRole(button.dataset.role);
    });
  });

  fillDemoButton.addEventListener("click", function () {
    const selectedRole = roleInput.value;
    const account = demoAccounts[selectedRole];
    if (!account) {
      showMessage("No demo account configured for selected role.", "error");
      return;
    }

    emailInput.value = account.email;
    passwordInput.value = account.password;
    showMessage(`Demo credentials inserted for ${selectedRole}.`, "success");
  });

  togglePasswordButton.addEventListener("click", function () {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    togglePasswordButton.textContent = isPassword ? "Hide" : "Show";
  });

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearMessage();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const role = roleInput.value;

    if (!email || !password) {
      showMessage("Please enter both email and password.", "error");
      return;
    }

    const submitButton = loginForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }

    var _LM = window.SagarSoftDB && window.SagarSoftDB.LoadingManager;
    function showLoginOverlay(msg) {
      if (_LM) { _LM.show(msg); } else {
        var ov = document.getElementById("sagarsoft-loading-overlay");
        var ot = document.getElementById("sagarsoft-loading-text");
        if (ov) { ov.style.display = "flex"; requestAnimationFrame(function(){ ov.style.opacity = "1"; }); }
        if (ot) { ot.textContent = msg; }
      }
    }
    function hideLoginOverlay() {
      if (_LM) { _LM.hide(); } else {
        var ov = document.getElementById("sagarsoft-loading-overlay");
        if (ov) { ov.style.opacity = "0"; setTimeout(function(){ ov.style.display = "none"; }, 250); }
      }
    }

    showLoginOverlay("Connecting to server...");

    showLoginOverlay("Verifying credentials...");

    var result;
    try {
      result = window.SagarSoftAuth.loginWithOnlineFallback
        ? await window.SagarSoftAuth.loginWithOnlineFallback(email, password, role, rememberMeInput.checked)
        : window.SagarSoftAuth.login(email, password, role, rememberMeInput.checked);
    } catch (_e) {
      result = { success: false, message: "An unexpected error occurred. Please try again or contact support." };
    }

    if (!result.success) {
      hideLoginOverlay();
      showMessage(result.message, "error");
      if (submitButton) {
        submitButton.disabled = false;
      }
      return;
    }

    showLoginOverlay("Login successful. Loading dashboard...");
    window.location.href = "./dashboard.html";
  });

  setRole("admin");
});
