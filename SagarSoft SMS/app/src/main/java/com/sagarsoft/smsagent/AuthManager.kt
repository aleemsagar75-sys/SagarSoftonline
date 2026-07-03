package com.sagarsoft.smsagent

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.JsonObject

class AuthManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("sagarsoft_sms", Context.MODE_PRIVATE)
    private val gson = Gson()

    var schoolId: String = ""
    var schoolName: String = ""
    var authToken: String? = null
    var deviceId: String? = null
    var isLoggedIn: Boolean = false

    fun loadSession(): Boolean {
        val token = prefs.getString("auth_token", null)
        val sid = prefs.getString("school_id", null)
        val sname = prefs.getString("school_name", null)
        val did = prefs.getString("device_id", null)

        if (token != null && sid != null) {
            authToken = token
            schoolId = sid
            schoolName = sname ?: ""
            deviceId = did
            isLoggedIn = true
            return true
        }
        return false
    }

    suspend fun login(email: String, password: String) {
        val api = SupabaseApi()
        val result = api.login(email, password)

        val accessToken = result.get("access_token")?.asString
            ?: throw Exception("No access_token in response")

        authToken = accessToken

        val userMeta = result.getAsJsonObject("user")
            ?.getAsJsonObject("user_metadata")

        schoolId = userMeta?.get("school_id")?.asString ?: ""
        schoolName = userMeta?.get("school_name")?.asString ?: ""
        isLoggedIn = true

        if (schoolId.isEmpty()) {
            val profileApi = SupabaseApi(accessToken)
            val profiles = profileApi.query("school_profiles?select=id,name&limit=1")
            if (profiles.isNotEmpty()) {
                schoolId = profiles[0].get("id")?.asString ?: ""
                schoolName = profiles[0].get("name")?.asString ?: ""
            }
        }

        prefs.edit()
            .putString("auth_token", accessToken)
            .putString("school_id", schoolId)
            .putString("school_name", schoolName)
            .apply()
    }

    suspend fun registerDevice(): String {
        val newId = "agent-${System.currentTimeMillis()}-${(100000..999999).random()}"
        deviceId = newId

        try {
            val api = SupabaseApi(authToken)
            val body = JsonObject().apply {
                addProperty("school_id", schoolId)
                addProperty("device_id", newId)
                addProperty("device_name", "SagarSoft SMS Agent")
                addProperty("is_active", true)
                addProperty("sim_number", "")
                addProperty("last_poll_at", java.time.Instant.now().toString())
            }
            val inserted = api.insert("devices", body)
            if (inserted != null) {
                val returnedId = inserted.get("device_id")?.asString ?: inserted.get("id")?.asString
                if (!returnedId.isNullOrEmpty()) {
                    deviceId = returnedId
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("AuthManager", "Device insert failed: ${e.message}")
        }

        prefs.edit().putString("device_id", deviceId).apply()
        return deviceId!!
    }

    suspend fun updateDevicePoll() {
        if (deviceId == null || authToken == null) return
        try {
            val api = SupabaseApi(authToken)
            val body = JsonObject().apply {
                addProperty("last_poll_at", java.time.Instant.now().toString())
            }
            api.update("devices?device_id=eq.$deviceId", body)
        } catch (_: Exception) { }
    }

    fun logout() {
        authToken = null
        schoolId = ""
        schoolName = ""
        deviceId = null
        isLoggedIn = false
        prefs.edit().clear().apply()
    }
}
