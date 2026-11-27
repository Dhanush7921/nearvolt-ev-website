package com.nearvolt.ev.data.repo

import com.nearvolt.ev.data.api.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

/** All app data access goes through the backend API. Reads retry on flaky networks; writes do not (except idempotent creates). */
class NearVoltRepository(private val api: ApiService = ApiClient.service) {
    suspend fun config() = call(retries = 4) { api.config() } // tolerate server wake-up at app start
    suspend fun me() = call(retries = 2) { api.me() }
    suspend fun saveConsents(c: Consents) = call { api.consents(c) }
    suspend fun saveProfile(p: ProfileBody) = call { api.profile(p) }
    suspend fun setRole(role: String) = call { api.role(RoleBody(role)) }
    suspend fun notifications(cursor: String? = null) = call(retries = 1) { api.notifications(cursor) }
    suspend fun readAll() = call { api.readAll() }
    suspend fun deleteAccount() = call { api.deleteAccount() }

    suspend fun nearby(at: LatLng, radiusKm: Double, connector: String?, vehicleType: String?, exclude: List<String> = emptyList()) =
        call(retries = 2) { api.nearby(at.lat, at.lng, radiusKm, connector, vehicleType, exclude.takeIf { it.isNotEmpty() }?.joinToString(",")) }

    /** The same key is reused for retries of one user action, so the server never creates a duplicate request. */
    suspend fun createRequest(body: CreateRequestBody, key: String = UUID.randomUUID().toString()) = call(retries = 2) { api.createRequest(key, body) }
    suspend fun requests(asRole: String, activeOnly: Boolean = false, cursor: String? = null) = call(retries = 1) { api.requests(asRole, if (activeOnly) "active" else null, cursor) }
    suspend fun request(id: String) = call(retries = 1) { api.request(id) }
    suspend fun transition(id: String, action: String, reason: String? = null, pin: String? = null) = call { api.transition(id, TransitionBody(action, reason, pin)) }
    suspend fun reissuePin(id: String) = call { api.reissuePin(id) }
    suspend fun feedback(id: String, rating: Int, comment: String?) = call { api.feedback(id, FeedbackBody(rating, comment)) }

    suspend fun myListing() = call(retries = 1) { api.myListing() }
    suspend fun saveListing(b: HostProfileBody) = call { api.saveListing(b) }
    suspend fun submitListing() = call { api.submitListing() }
    suspend fun setAvailability(available: Boolean, untilIso: String?) = call { api.availability(AvailabilityBody(available, untilIso)) }

    suspend fun tickets() = call(retries = 1) { api.tickets() }
    suspend fun createTicket(b: TicketBody) = call { api.createTicket(b) }

    /** Upload flow: signed URL from backend → direct PUT to Cloud Storage → server-side verification. */
    suspend fun upload(kind: String, contentType: String, bytes: ByteArray): ApiResult<Ack> {
        val ticket = when (val t = call { api.uploadTicket(UploadBody(kind, contentType, bytes.size.toLong())) }) { is ApiResult.Err -> return t; is ApiResult.Ok -> t.value }
        val put = withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder().url(ticket.uploadUrl).put(bytes.toRequestBody(contentType.toMediaType())).apply {
                    ticket.headers.forEach { (k, v) -> if (!k.equals("Content-Type", true)) header(k, v) }
                }.build()
                ApiClient.upload.newCall(req).execute().use { it.isSuccessful }
            }.getOrDefault(false)
        }
        if (!put) return ApiResult.Err("UPLOAD_FAILED", "Upload failed. Check your connection and try again.")
        return call { api.confirmUpload(PathBody(ticket.path)) }
    }
}
