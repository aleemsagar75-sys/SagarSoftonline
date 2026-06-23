package com.sagarsoft.smsagent

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.reflect.TypeToken
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class SupabaseApi(private val authToken: String? = null) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private val JSON = "application/json".toMediaType()

    private fun headers(): Headers {
        val h = Headers.Builder()
            .add("apikey", SupabaseConfig.ANON_KEY)
            .add("Content-Type", "application/json")
        if (authToken != null) {
            h.add("Authorization", "Bearer $authToken")
        }
        return h.build()
    }

    suspend fun login(email: String, password: String): JsonObject = suspendCoroutine { cont ->
        val body = gson.toJson(mapOf("email" to email, "password" to password))
            .toRequestBody(JSON)
        val request = Request.Builder()
            .url("${SupabaseConfig.URL}/auth/v1/token?grant_type=password")
            .post(body)
            .headers(headers())
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: "{}"
                val json = gson.fromJson(bodyStr, JsonObject::class.java)
                if (!response.isSuccessful) {
                    val msg = json.get("error_description")?.asString
                        ?: json.get("error")?.asString
                        ?: json.get("msg")?.asString
                        ?: "Login failed (${response.code})"
                    cont.resumeWithException(Exception(msg))
                } else {
                    cont.resume(json)
                }
            }
        })
    }

    suspend fun query(path: String): List<JsonObject> = suspendCoroutine { cont ->
        val request = Request.Builder()
            .url("${SupabaseConfig.URL}/rest/v1/$path")
            .get()
            .headers(headers())
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: "[]"
                if (!response.isSuccessful) {
                    cont.resumeWithException(Exception("Query error ${response.code}: $bodyStr"))
                } else {
                    val arr = gson.fromJson(bodyStr, Array<JsonObject>::class.java)
                    cont.resume(arr.toList())
                }
            }
        })
    }

    suspend fun insert(path: String, bodyJson: JsonObject): JsonObject? = suspendCoroutine { cont ->
        val body = bodyJson.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("${SupabaseConfig.URL}/rest/v1/$path")
            .post(body)
            .addHeader("Prefer", "return=representation")
            .headers(headers())
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: "null"
                if (!response.isSuccessful) {
                    cont.resumeWithException(Exception("Insert error ${response.code}: $bodyStr"))
                } else {
                    val arr = gson.fromJson(bodyStr, Array<JsonObject>::class.java)
                    cont.resume(arr.firstOrNull())
                }
            }
        })
    }

    suspend fun rpc(function: String, params: JsonObject = JsonObject()): String? = suspendCoroutine { cont ->
        val body = params.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("${SupabaseConfig.URL}/rest/v1/rpc/$function")
            .post(body)
            .headers(headers())
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""
                if (!response.isSuccessful) {
                    cont.resumeWithException(Exception("RPC error ${response.code}: $bodyStr"))
                } else {
                    cont.resume(bodyStr)
                }
            }
        })
    }

    suspend fun ensureTables() {
        try {
            rpc("create_tables")
        } catch (_: Exception) { }
    }

    suspend fun update(path: String, bodyJson: JsonObject) = suspendCoroutine { cont ->
        val body = bodyJson.toString().toRequestBody(JSON)
        val request = Request.Builder()
            .url("${SupabaseConfig.URL}/rest/v1/$path")
            .patch(body)
            .addHeader("Prefer", "return=minimal")
            .headers(headers())
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                if (!response.isSuccessful) {
                    val bodyStr = response.body?.string() ?: ""
                    cont.resumeWithException(Exception("Update error ${response.code}: $bodyStr"))
                } else {
                    cont.resume(Unit)
                }
            }
        })
    }
}
