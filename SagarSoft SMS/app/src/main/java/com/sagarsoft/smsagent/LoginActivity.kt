package com.sagarsoft.smsagent

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.sagarsoft.smsagent.databinding.ActivityLoginBinding
import kotlinx.coroutines.*

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var authManager: AuthManager
    private var scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        authManager = AuthManager(this)

        if (authManager.loadSession()) {
            startDashboard()
            return
        }

        binding.loginButton.setOnClickListener {
            val email = binding.emailInput.text.toString().trim()
            val password = binding.passwordInput.text.toString().trim()
            if (email.isEmpty() || password.isEmpty()) {
                Toast.makeText(this, "Email and password required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            doLogin(email, password)
        }
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
