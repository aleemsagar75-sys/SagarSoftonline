package com.sagarsoft.smsagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.gson.JsonObject
import com.sagarsoft.smsagent.SmsPollingService.Companion.stats
import com.sagarsoft.smsagent.databinding.ActivityDashboardBinding
import kotlinx.coroutines.*

class DashboardActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDashboardBinding
    private lateinit var authManager: AuthManager
    private var isServiceRunning = false
    private var simRegistered = false
    private var scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val statsReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            updateUi()
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
        binding.deviceIdText.text = "Device: ${authManager.deviceId?.take(20) ?: "-"}..."
        binding.schoolIdLabel.text = "School ID: ${authManager.schoolId}"

        binding.startStopButton.setOnClickListener { toggleService() }
        binding.logoutButton.setOnClickListener { confirmLogout() }
        binding.registerSimButton.setOnClickListener { registerSim() }
        binding.editSimButton.setOnClickListener { enableSimEdit() }

        isServiceRunning = SmsPollingService.isRunning
        registerReceiver(statsReceiver, IntentFilter("com.sagarsoft.sms.STATS_UPDATE"))
        loadCurrentSim()
    }

    override fun onResume() {
        super.onResume()
        isServiceRunning = SmsPollingService.isRunning
        updateUi()
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        try { unregisterReceiver(statsReceiver) } catch (_: Exception) { }
    }

    private fun updateUi() {
        val s = stats
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

        if (isServiceRunning) {
            binding.startStopButton.text = "Stop Service"
            binding.startStopButton.setBackgroundColor(getColor(android.R.color.holo_red_dark))
            binding.statusIndicator.text = "● Service Running"
            binding.statusIndicator.setTextColor(getColor(android.R.color.holo_green_dark))
        } else {
            binding.startStopButton.text = "Start Service"
            binding.startStopButton.setBackgroundColor(getColor(com.google.android.material.R.color.mtrl_btn_bg_color_selector))
            binding.statusIndicator.text = "● Service Stopped"
            binding.statusIndicator.setTextColor(Color.GRAY)
        }
    }

    private fun loadCurrentSim() {
        val did = authManager.deviceId ?: return
        scope.launch {
            try {
                val api = SupabaseApi(authManager.authToken)
                val devs = api.query("devices?device_id=eq.$did&select=sim_number,school_id&limit=1")
                if (devs.isNotEmpty()) {
                    val sim = devs[0].get("sim_number")?.asString ?: ""
                    if (sim.isNotEmpty()) {
                        setSimRegistered(sim)
                    }
                }
            } catch (_: Exception) { }
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
        binding.simStatusText.setTextColor(getColor(android.R.color.holo_green_dark))
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
        val did = authManager.deviceId ?: run {
            Toast.makeText(this, "Device not registered yet", Toast.LENGTH_SHORT).show()
            return
        }
        binding.registerSimButton.isEnabled = false
        binding.registerSimButton.text = "Saving..."

        scope.launch {
            try {
                val api = SupabaseApi(authManager.authToken)
                val body = JsonObject().apply { addProperty("sim_number", sim) }
                api.update("devices?device_id=eq.$did", body)
                setSimRegistered(sim)
                Toast.makeText(this@DashboardActivity, "SIM registered successfully", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this@DashboardActivity, "Failed: ${e.message}", Toast.LENGTH_LONG).show()
                binding.registerSimButton.isEnabled = true
                binding.registerSimButton.text = "Register SIM"
            }
        }
    }

    private fun toggleService() {
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
    }

    private fun confirmLogout() {
        AlertDialog.Builder(this)
            .setTitle("Logout")
            .setMessage("Stop service and logout?")
            .setPositiveButton("Logout") { _, _ ->
                if (isServiceRunning) {
                    stopService(Intent(this, SmsPollingService::class.java))
                }
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
