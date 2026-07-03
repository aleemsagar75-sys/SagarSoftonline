package com.sagarsoft.smsagent

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.gson.JsonObject
import com.sagarsoft.smsagent.databinding.ActivityDashboardBinding
import kotlinx.coroutines.*

class DashboardActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDashboardBinding
    private lateinit var authManager: AuthManager
    private var isServiceRunning = false
    private var simRegistered = false
    private var scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val handler = Handler(Looper.getMainLooper())
    private val statsRunnable = object : Runnable {
        override fun run() {
            try { updateUi() } catch (_: Exception) {}
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDashboardBinding.inflate(layoutInflater)
        setContentView(binding.root)

        authManager = AuthManager(this)
        if (!authManager.loadSession()) {
            goToLogin()
            return
        }

        binding.schoolNameText.text = authManager.schoolName.ifEmpty { authManager.schoolId }
        binding.schoolIdLabel.text = "School ID: ${authManager.schoolId}"
        binding.deviceIdText.text = "Device: ${authManager.deviceId?.take(25) ?: "Not Registered"}..."

        binding.startStopButton.setOnClickListener { toggleService() }
        binding.logoutButton.setOnClickListener { confirmLogout() }
        binding.registerSimButton.setOnClickListener { registerSim() }
        binding.editSimButton.setOnClickListener { enableSimEdit() }

        updateUi()
        loadCurrentSim()

        if (authManager.deviceId == null) {
            scope.launch {
                try {
                    withContext(Dispatchers.IO) { authManager.registerDevice() }
                    binding.deviceIdText.text = "Device: ${authManager.deviceId?.take(25) ?: "Not Registered"}..."
                } catch (_: Exception) {}
            }
        }
    }

    override fun onResume() {
        super.onResume()
        try {
            isServiceRunning = SmsPollingService.isRunning
        } catch (_: Exception) {
            isServiceRunning = false
        }
        updateUi()
        handler.postDelayed(statsRunnable, 1000)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(statsRunnable)
    }

    override fun onDestroy() {
        handler.removeCallbacks(statsRunnable)
        scope.cancel()
        super.onDestroy()
    }

    private fun updateUi() {
        try {
            isServiceRunning = SmsPollingService.isRunning
        } catch (_: Exception) {}

        try {
            val s = SmsPollingService.stats
            binding.sentCount.text = s.totalSent.toString()
            binding.failedCount.text = s.totalFailed.toString()
            binding.pollCount.text = s.totalPolled.toString()
            binding.lastPollText.text = "Last Poll: ${s.lastPollAt}"
            binding.lastSendText.text = "Last Send: ${s.lastSendAt}"

            if (s.lastError != null) {
                binding.lastErrorText.text = "Error: ${s.lastError}"
                binding.lastErrorText.visibility = View.VISIBLE
            } else {
                binding.lastErrorText.visibility = View.GONE
            }
        } catch (_: Exception) {}

        try {
            if (isServiceRunning) {
                binding.startStopButton.text = "Stop Service"
                binding.startStopButton.setBackgroundColor(Color.parseColor("#D32F2F"))
                binding.statusIndicator.text = "● Service Running"
                binding.statusIndicator.setTextColor(Color.parseColor("#4CAF50"))
            } else {
                binding.startStopButton.text = "Start Service"
                binding.startStopButton.setBackgroundColor(Color.parseColor("#1E5EFF"))
                binding.statusIndicator.text = "● Service Stopped"
                binding.statusIndicator.setTextColor(Color.GRAY)
            }
        } catch (_: Exception) {}
    }

    private fun loadCurrentSim() {
        val did = authManager.deviceId ?: return
        val token = authManager.authToken ?: return
        scope.launch {
            try {
                val api = SupabaseApi(token)
                val devs = api.query("devices?device_id=eq.$did&select=sim_number&limit=1")
                if (devs.isNotEmpty()) {
                    val sim = devs[0].get("sim_number")?.asString ?: ""
                    if (sim.isNotEmpty()) {
                        withContext(Dispatchers.Main) { setSimRegistered(sim) }
                    }
                }
            } catch (_: Exception) {}
        }
    }

    private fun setSimRegistered(sim: String) {
        simRegistered = true
        binding.simNumberInput.setText(sim)
        binding.simNumberInput.isEnabled = false
        binding.simNumberInput.alpha = 0.6f
        binding.registerSimButton.visibility = View.GONE
        binding.editSimButton.visibility = View.VISIBLE
        binding.simStatusText.text = "✓ SIM Registered: $sim"
        binding.simStatusText.visibility = View.VISIBLE
        binding.simStatusText.setTextColor(Color.parseColor("#4CAF50"))
    }

    private fun enableSimEdit() {
        simRegistered = false
        binding.simNumberInput.isEnabled = true
        binding.simNumberInput.alpha = 1.0f
        binding.registerSimButton.visibility = View.VISIBLE
        binding.editSimButton.visibility = View.GONE
        binding.simStatusText.text = "Edit SIM number and tap Register"
        binding.simStatusText.visibility = View.VISIBLE
        binding.simStatusText.setTextColor(Color.parseColor("#FF9800"))
    }

    private fun registerSim() {
        val sim = binding.simNumberInput.text.toString().trim()
        if (sim.isEmpty()) {
            Toast.makeText(this, "Enter SIM phone number", Toast.LENGTH_SHORT).show()
            return
        }
        binding.registerSimButton.isEnabled = false
        binding.registerSimButton.text = "Saving..."

        scope.launch {
            try {
                if (authManager.deviceId == null) {
                    withContext(Dispatchers.IO) { authManager.registerDevice() }
                }
                val did = authManager.deviceId
                if (did == null) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@DashboardActivity, "Device registration failed", Toast.LENGTH_LONG).show()
                        binding.registerSimButton.isEnabled = true
                        binding.registerSimButton.text = "Register SIM"
                    }
                    return@launch
                }
                val api = SupabaseApi(authManager.authToken)
                val body = JsonObject().apply { addProperty("sim_number", sim) }
                api.update("devices?device_id=eq.$did", body)
                withContext(Dispatchers.Main) { setSimRegistered(sim) }
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@DashboardActivity, "SIM registered", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@DashboardActivity, "Failed: ${e.message}", Toast.LENGTH_LONG).show()
                    binding.registerSimButton.isEnabled = true
                    binding.registerSimButton.text = "Register SIM"
                }
            }
        }
    }

    private fun toggleService() {
        try {
            if (isServiceRunning) {
                stopService(Intent(this, SmsPollingService::class.java))
                isServiceRunning = false
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(Intent(this, SmsPollingService::class.java))
                } else {
                    startService(Intent(this, SmsPollingService::class.java))
                }
                isServiceRunning = true
            }
            updateUi()
        } catch (e: Exception) {
            Toast.makeText(this, "Error: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun confirmLogout() {
        AlertDialog.Builder(this)
            .setTitle("Logout")
            .setMessage("Stop service and logout?")
            .setPositiveButton("Logout") { _, _ ->
                try { if (isServiceRunning) stopService(Intent(this, SmsPollingService::class.java)) } catch (_: Exception) {}
                authManager.logout()
                goToLogin()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun goToLogin() {
        val intent = Intent(this, LoginActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }
}
