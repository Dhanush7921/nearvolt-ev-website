package com.nearvolt.ev.data.api

import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.auth.FirebaseAuth
import com.nearvolt.ev.BuildConfig
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Result of an API call. Errors carry the server's machine code so screens can react precisely. */
sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Err(val code: String, val message: String, val http: Int = 0) : ApiResult<Nothing> {
        val isOffline get() = code == "OFFLINE"
    }
}
inline fun <T, R> ApiResult<T>.map(f: (T) -> R): ApiResult<R> = when (this) { is ApiResult.Ok -> ApiResult.Ok(f(value)); is ApiResult.Err -> this }

val NvJson = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true; coerceInputValues = true }

object ApiClient {
    private fun firebaseReady() = FirebaseApp.getApps(com.nearvolt.ev.NearVoltApp.instance).isNotEmpty()

    /** Adds Firebase ID token, App Check token and app version headers. Runs on OkHttp's background threads. */
    private val headers = Interceptor { chain ->
        val b = chain.request().newBuilder()
            .header("X-App-Platform", "android")
            .header("X-App-Version-Code", BuildConfig.VERSION_CODE.toString())
            .header("Accept", "application/json")
        if (firebaseReady()) {
            FirebaseAuth.getInstance().currentUser?.let { u ->
                runCatching { Tasks.await(u.getIdToken(false), 10, TimeUnit.SECONDS).token }.getOrNull()?.let { b.header("Authorization", "Bearer $it") }
            }
            runCatching { Tasks.await(FirebaseAppCheck.getInstance().getAppCheckToken(false), 10, TimeUnit.SECONDS).token }.getOrNull()
                ?.let { b.header("X-Firebase-AppCheck", it) }
        }
        chain.proceed(b.build())
    }

    /** On 401, force-refresh the ID token once (covers revoked/expired sessions and new role claims). */
    private val refresh = object : Authenticator {
        override fun authenticate(route: Route?, response: Response): Request? {
            if (response.request.header("X-Retry-Auth") != null || !firebaseReady()) return null
            val user = FirebaseAuth.getInstance().currentUser ?: return null
            val token = runCatching { Tasks.await(user.getIdToken(true), 10, TimeUnit.SECONDS).token }.getOrNull() ?: return null
            return response.request.newBuilder().header("Authorization", "Bearer $token").header("X-Retry-Auth", "1").build()
        }
    }

    val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            // Read timeout covers a free-tier host waking from sleep (Render free instances spin down when idle).
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(headers).authenticator(refresh).build()
    }
    /** Plain client for signed upload URLs (no auth headers ever sent to storage). */
    val upload: OkHttpClient by lazy { OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build() }

    val service: ApiService by lazy {
        Retrofit.Builder().baseUrl(BuildConfig.API_BASE_URL).client(http)
            .addConverterFactory(NvJson.asConverterFactory("application/json".toMediaType())).build()
            .create(ApiService::class.java)
    }
}

/**
 * Executes a call, mapping transport and server errors. Retries network failures with exponential backoff
 * when [retries] > 0 — only use for idempotent calls (GETs, or POSTs carrying an Idempotency-Key).
 */
suspend fun <T> call(retries: Int = 0, block: suspend () -> retrofit2.Response<Envelope<T>>): ApiResult<T> {
    var attempt = 0
    var wait = 600L
    while (true) {
        try {
            val r = block()
            val body = r.body()
            if (r.isSuccessful && body?.data != null) return ApiResult.Ok(body.data)
            val err = body?.error ?: r.errorBody()?.string()?.let { runCatching { NvJson.decodeFromString<Envelope<Unit>>(it).error }.getOrNull() }
            val code = err?.code ?: if (r.code() >= 500) "SERVER" else "HTTP_${r.code()}"
            // Retry transient server errors and load-shedding (OVERLOADED/TIMEOUT); never retry maintenance or 4xx.
            val transient = (r.code() >= 500 && r.code() != 503) || code == "OVERLOADED" || code == "TIMEOUT" || code == "BUSY_RETRY"
            if (transient && attempt < retries) {
                val retryAfter = r.headers()["Retry-After"]?.toLongOrNull()?.times(1000)
                attempt++; delay(jitter(retryAfter ?: wait)); wait *= 2; continue
            }
            return ApiResult.Err(code, err?.message ?: "Something went wrong. Please try again.", r.code())
        } catch (e: IOException) {
            if (attempt < retries) { attempt++; delay(jitter(wait)); wait *= 2; continue }
            return ApiResult.Err("OFFLINE", "No connection. Check your internet and try again.")
        } catch (e: kotlinx.serialization.SerializationException) {
            return ApiResult.Err("PARSE", "Unexpected response from server.")
        }
    }
}

/** Full-range jitter (50–150 %) so many phones retrying after an outage do not hit the server in lockstep. */
internal fun jitter(ms: Long): Long = (ms * (0.5 + Math.random())).toLong().coerceAtMost(15_000)
