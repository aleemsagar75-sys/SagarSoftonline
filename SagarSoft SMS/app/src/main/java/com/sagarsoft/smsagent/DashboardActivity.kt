package com.sagarsoft.smsagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
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

        binding.startStopButton.setOnClickListener { toggleService() }
        binding.logoutButton.setOnClickListener { confirmLogout() }
        binding.registerSimButton.setOnClickListener { registerSim() }

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
            binding.lastErrorText.visibility = android.view.View.VISIBLE
        } else {
            binding.lastErrorText.visibility = android.view.View.GONE
        }

        if (isServiceRunning) {
            binding.startStopButton.text = "Stop Service"
            binding.startStopButton.setBackgroundColor(getColor(android.R.color.holo_red_dark))
            binding.statusIndicator.text = "Service Running"
            binding.statusIndicator.setTextColor(getColor(android.R.color.holo_green_dark))
        } else {
            binding.startStopButton.text = "Start Service"
            binding.startStopButton.setBackgroundColor(getColor(com.google.android.material.R.color.mtrl_btn_bg_color_selector))
            binding.statusIndicator.text = "Service Stopped"
            binding.statusIndicator.setTextColor(android.graphics.Color.GRAY)
        }
    }

    private fun loadCurrentSim() {
        val did = authManager.deviceId ?: return
        scope.launch {
            try {
                val api = SupabaseApi(authManager.authToken)
                val devs = api.query("devices?device_id=eq.$did&select=sim_number&limit=1")
                if (devs.isNotEmpty()) {
                    val sim = devs[0].get("sim_number")?.asString ?: ""
                    if (sim.isNotEmpty()) {
                        binding.simNumberInput.setText(sim)
                        binding.simStatusText.text = "SIM Registered: $sim"
                        binding.simStatusText.visibility = android.view.View.VISIBLE
                    }
                }
            } catch (_: Exception) { }
        }
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
                binding.simStatusText.text = "SIM Registered: $sim"
                binding.simStatusText.visibility = android.view.View.VISIBLE
                binding.simStatusText.setTextColor(getColor(android.R.color.holo_green_dark))
                Toast.makeText(this@DashboardActivity, "SIM registered successfully", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this@DashboardActivity, "Failed: ${e.message}", Toast.LENGTH_LONG).show()
            } finally {
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
