package com.sagarsoft.smsagent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.sagarsoft.smsagent.databinding.ActivityLoginBinding
import kotlinx.coroutines.*

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var authManager: AuthManager
    private var scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var pendingEmail = ""
    private var pendingPassword = ""

    companion object {
        private const val PERMISSION_REQUEST_CODE = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        authManager = AuthManager(this)

        if (authManager.loadSession()) {
            requestPermissionsAndStart()
            return
        }

        binding.loginButton.setOnClickListener {
            val email = binding.emailInput.text.toString().trim()
            val password = binding.passwordInput.text.toString().trim()
            if (email.isEmpty() || password.isEmpty()) {
                Toast.makeText(this, "Email and password required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            pendingEmail = email
            pendingPassword = password
            if (hasAllPermissions()) {
                doLogin(email, password)
            } else {
                requestPermissions()
            }
        }

        if (!hasAllPermissions()) {
            requestPermissions()
        }
    }

    private fun hasAllPermissions(): Boolean {
        val sms = ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        val notif = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else true
        val phone = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        return sms && notif && phone
    }

    private fun requestPermissions() {
        val perms = mutableListOf(Manifest.permission.SEND_SMS, Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        ActivityCompat.requestPermissions(this, perms.toTypedArray(), PERMISSION_REQUEST_CODE)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            val smsGranted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (!smsGranted) {
                Toast.makeText(this, "SMS permission is required to send messages. Please grant it in Settings.", Toast.LENGTH_LONG).show()
            }
            if (pendingEmail.isNotEmpty() && pendingPassword.isNotEmpty()) {
                doLogin(pendingEmail, pendingPassword)
            }
        }
    }

    private fun requestPermissionsAndStart() {
        if (!hasAllPermissions()) {
            requestPermissions()
        }
        startDashboard()
    }

    private fun doLogin(email: String, password: String) {
        binding.loginButton.isEnabled = false
        binding.loginButton.text = "Signing in..."

        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    authManager.login(email, password)
                    authManager.registerDevice()
                }
                startDashboard()
            } catch (e: Exception) {
                binding.loginButton.isEnabled = true
                binding.loginButton.text = "Sign In"
                Toast.makeText(this@LoginActivity, e.message ?: "Login failed", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun startDashboard() {
        val intent = Intent(this, DashboardActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
