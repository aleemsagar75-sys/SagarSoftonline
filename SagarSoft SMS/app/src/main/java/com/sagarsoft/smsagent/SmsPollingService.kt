package com.sagarsoft.smsagent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import com.google.gson.JsonObject
import kotlinx.coroutines.*
import kotlinx.coroutines.Dispatchers.IO

class SmsPollingService : Service() {

    companion object {
        const val CHANNEL_ID = "sagarsoft_sms_poll"
        const val NOTIFICATION_ID = 1001
        const val POLL_INTERVAL_MS = 7000L

        var isRunning = false
            private set
        var stats = PollStats()
            private set

        data class PollStats(
            var totalPolled: Int = 0,
            var totalSent: Int = 0,
            var totalFailed: Int = 0,
            var lastPollAt: String = "-",
            var lastSendAt: String = "-",
            var lastError: String? = null
        )
    }

    private var authManager: AuthManager? = null
    private var scope: CoroutineScope? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        authManager = AuthManager(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (isRunning) return START_STICKY
        isRunning = true

        val notification = buildNotification("SagarSoft SMS is running...")
        startForeground(NOTIFICATION_ID, notification)

        scope = CoroutineScope(IO + SupervisorJob())
        scope?.launch { pollLoop() }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        scope?.cancel()
        super.onDestroy()
    }

    private var tablesEnsured = false

    private suspend fun pollLoop() {
        while (isRunning) {
            try {
                if (!tablesEnsured) {
                    try { SupabaseApi().ensureTables() } catch (_: Exception) { }
                    tablesEnsured = true
                }
                pollOnce()
            } catch (e: Exception) {
                stats.lastError = e.message ?: "Unknown error"
            }
            delay(POLL_INTERVAL_MS)
        }
    }

    private suspend fun pollOnce() {
        val am = authManager ?: return
        if (!am.isLoggedIn) {
            am.loadSession()
            if (!am.isLoggedIn) return
        }
        if (am.deviceId == null) {
            try { am.registerDevice() } catch (_: Exception) { return }
        }

        stats.lastPollAt = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
            .format(java.util.Date())
        stats.totalPolled++
        updateNotification()

        try {
            val api = SupabaseApi(am.authToken)
            val pendingSms = api.query(
                "sms_queue?school_id=eq.${am.schoolId}" +
                        "&status=eq.pending" +
                        "&order=created_at.asc" +
                        "&limit=5"
            )

            if (pendingSms.isEmpty()) {
                am.updateDevicePoll()
                return
            }

            for (sms in pendingSms) {
                val id = sms.get("id")?.asString ?: continue
                val phone = sms.get("recipient_phone")?.asString ?: continue
                val message = sms.get("message")?.asString ?: continue

                val sent = sendSms(phone, message)
                if (sent) {
                    markSent(am, id)
                    stats.totalSent++
                    stats.lastSendAt = stats.lastPollAt
                } else {
                    markFailed(am, id, "send-failed")
                    stats.totalFailed++
                }
                updateNotification()
            }

            am.updateDevicePoll()
        } catch (e: Exception) {
            stats.lastError = e.message ?: "Poll error"
            updateNotification()
        }
    }

    private fun sendSms(phone: String, message: String): Boolean {
        return try {
            if (androidx.core.app.ActivityCompat.checkSelfPermission(this, android.Manifest.permission.SEND_SMS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                stats.lastError = "SEND_SMS permission not granted"
                return false
            }
            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val context = applicationContext
                context.getSystemService("telephony_sms") as? SmsManager
                    ?: SmsManager.getDefault()
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }
            smsManager.sendTextMessage(phone, null, message, null, null)
            true
        } catch (e: Exception) {
            stats.lastError = e.message
            false
        }
    }

    private suspend fun markSent(am: AuthManager, smsId: String) {
        try {
            val api = SupabaseApi(am.authToken)
            val body = JsonObject().apply {
                addProperty("status", "sent")
                addProperty("device_id", am.deviceId ?: "")
                addProperty("sent_at", java.time.Instant.now().toString())
            }
            api.update("sms_queue?id=eq.$smsId", body)
        } catch (e: Exception) {
            stats.lastError = "markSent: ${e.message}"
            updateNotification()
        }
    }

    private suspend fun markFailed(am: AuthManager, smsId: String, error: String) {
        try {
            val api = SupabaseApi(am.authToken)
            val body = JsonObject().apply {
                addProperty("status", "failed")
                addProperty("error_message", error)
            }
            api.update("sms_queue?id=eq.$smsId", body)
        } catch (e: Exception) {
            stats.lastError = "markFailed: ${e.message}"
            updateNotification()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SMS Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "SagarSoft SMS background polling service"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val intent = Intent(this, DashboardActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val sentInfo = "Sent: ${stats.totalSent} | Failed: ${stats.totalFailed}"
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SagarSoft SMS Agent")
            .setContentText(text)
            .setSubText(sentInfo)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification("Polling... ${stats.totalPolled} polls"))
    }
}
