package com.nearvolt.ev.data.api

import kotlinx.serialization.Serializable

@Serializable data class Envelope<T>(val ok: Boolean = false, val data: T? = null, val error: ErrorBody? = null)
@Serializable data class ErrorBody(val code: String = "UNKNOWN", val message: String = "Something went wrong.")
@Serializable data class Page<T>(val items: List<T> = emptyList(), val nextCursor: String? = null)

@Serializable data class Vehicle(val type: String, val model: String? = null, val connector: String)
@Serializable data class Consents(val termsVersion: String, val privacyVersion: String, val locationConsent: Boolean, val notificationConsent: Boolean)
@Serializable data class Me(
    val uid: String, val name: String = "", val role: String? = null, val phone: String? = null, val email: String? = null,
    val vehicle: Vehicle? = null, val consents: Consents? = null, val activeRequestId: String? = null, val admin: Boolean = false, val profileComplete: Boolean = false,
)
@Serializable data class ProfileBody(val name: String, val vehicle: Vehicle? = null)
@Serializable data class RoleBody(val role: String)
@Serializable data class SessionBody(val method: String)
@Serializable data class DeviceBody(val token: String, val platform: String = "android")

@Serializable data class LatLng(val lat: Double, val lng: Double)
@Serializable data class Maintenance(val enabled: Boolean = false, val message: String = "")
@Serializable data class ServiceArea(val id: String, val name: String, val center: LatLng, val radiusKm: Double)
@Serializable data class SupportContact(val email: String = "", val phone: String = "")
@Serializable data class PublicConfig(
    val maintenance: Maintenance = Maintenance(), val minSupportedVersionCode: Int = 1, val latestVersionCode: Int = 1,
    val featureFlags: Map<String, Boolean> = emptyMap(), val serviceAreas: List<ServiceArea> = emptyList(),
    val capabilities: Capabilities = Capabilities(),
    val supportContact: SupportContact? = null, val requestTtlSeconds: Int = 300,
)

@Serializable data class Rating(val average: Double, val count: Int)
@Serializable data class AreaRef(val id: String, val name: String)
@Serializable data class HostSummary(
    val hostId: String, val displayName: String, val straightLineKm: Double, val connectors: List<String> = emptyList(),
    val vehicleTypes: List<String> = emptyList(), val powerKw: Double = 0.0, val chargerType: String = "", val phase: String = "",
    val bookableNow: Boolean = false, val openNow: Boolean = false, val rating: Rating? = null, val availabilityUpdatedAt: String? = null,
    val approxArea: ApproxArea? = null,
    // V1.3 client readiness: optional; the current backend does NOT send these yet, so socket requests stay blocked (RequestGate).
    val dedicatedCircuit: Boolean? = null, val currentA: Double? = null,
)
/** ~1 km grid cell containing the host. Exact coordinates are only shared after a host accepts. */
@Serializable data class ApproxArea(val lat: Double, val lng: Double, val radiusM: Int = 800)
@Serializable data class NearbyResponse(
    val serviceArea: AreaRef? = null, val items: List<HostSummary> = emptyList(), val message: String? = null,
    val distanceNote: String? = null, val checkedAt: String? = null,
)

@Serializable data class HistoryEvent(val from: String? = null, val to: String, val by: String, val at: String? = null)
@Serializable data class HostLocation(val lat: Double, val lng: Double, val address: String = "", val mapsUrl: String)
@Serializable data class ChargeRequest(
    val id: String, val status: String, val role: String, val hostId: String, val hostName: String = "", val connector: String = "",
    val vehicleType: String = "", val note: String? = null, val straightLineKm: Double? = null, val createdAt: String? = null,
    val expiresAt: String? = null, val updatedAt: String? = null, val history: List<HistoryEvent> = emptyList(),
    val feedbackGiven: Boolean = false, val hostLocation: HostLocation? = null, val customerName: String? = null,
    val batteryPercent: Int? = null, val urgent: Boolean = false,
    /** Session verification PIN: [pin] is only ever sent to the customer; the host sees [pinStatus]. */
    val pin: String? = null, val pinStatus: String? = null, val pinExpiresAt: String? = null,
)
@Serializable data class CreateRequestBody(
    val hostId: String, val vehicleType: String, val connector: String, val customerLocation: LatLng,
    val compatibilityConfirmed: Boolean = true, val note: String? = null, val batteryPercent: Int? = null,
)
@Serializable data class TransitionBody(val action: String, val reason: String? = null, val pin: String? = null)
@Serializable data class FeedbackBody(val rating: Int, val comment: String? = null)

@Serializable data class HoursSlot(val open: String, val close: String)
@Serializable data class Equipment(
    val chargerType: String, val connectors: List<String>, val vehicleTypes: List<String>, val voltageV: Double, val currentA: Double,
    val phase: String, val powerKw: Double, val capacity: Int = 1, val notes: String? = null,
)
@Serializable data class SelfDeclaration(
    val earthing: Boolean, val rcdOrElcb: Boolean, val dedicatedCircuit: Boolean, val ratedCabling: Boolean,
    val dryCoveredArea: Boolean, val accurateInformation: Boolean,
)
@Serializable data class HostProfileBody(
    val displayName: String, val address: String, val location: LatLng, val equipment: Equipment,
    val hours: Map<String, List<HoursSlot>>, val selfDeclaration: SelfDeclaration,
)
@Serializable data class HostListing(
    val uid: String, val status: String = "DRAFT", val displayName: String = "", val address: String = "", val location: LatLng? = null,
    val equipment: Equipment? = null, val hours: Map<String, List<HoursSlot>>? = null, val available: Boolean = false,
    val availableUntil: String? = null, val photos: Int = 0, val documents: Int = 0, val selfDeclaration: SelfDeclaration? = null,
    val rejectionReason: String? = null, val activeSessions: Int = 0, val submittedAt: String? = null,
)
@Serializable data class AvailabilityBody(val available: Boolean, val until: String? = null)
@Serializable data class UploadBody(val kind: String, val contentType: String, val sizeBytes: Long)
@Serializable data class UploadTicket(val uploadUrl: String, val path: String, val method: String, val headers: Map<String, String>)
@Serializable data class PathBody(val path: String)

@Serializable data class OtpSendBody(val phone: String)
@Serializable data class OtpSent(val sent: Boolean, val resendAfterSeconds: Int = 30, val expiresInSeconds: Int = 300)
@Serializable data class OtpVerifyBody(val phone: String, val otp: String)
@Serializable data class OtpVerified(val customToken: String? = null, val linked: Boolean = false, val newUser: Boolean = false)

@Serializable data class AppNotification(val id: String, val type: String, val title: String, val body: String, val requestId: String? = null, val read: Boolean = false, val at: String? = null)
@Serializable data class TicketBody(val category: String, val message: String, val requestId: String? = null)
@Serializable data class Ticket(val id: String, val category: String, val status: String, val message: String = "", val resolution: String? = null, val createdAt: String? = null)
@Serializable data class TicketCreated(val ticketId: String, val priority: String)

@Serializable data class Ack(
    val saved: Boolean? = null, val logged: Boolean? = null, val registered: Boolean? = null, val removed: Boolean? = null,
    val deleted: Boolean? = null, val attached: Boolean? = null, val status: String? = null, val role: String? = null,
    val updated: Int? = null, val available: Boolean? = null,
)

object Connectors {
    val ALL = listOf("DOMESTIC_15A", "INDUSTRIAL_16A", "TYPE2_AC", "BHARAT_AC001", "LECCS", "CCS2", "BHARAT_DC001", "CHADEMO", "GBT")
}
object VehicleTypes { val ALL = listOf("two_wheeler", "three_wheeler", "car") }

/** Absent on a V1.0 backend → all false, and the app behaves like V1.0 (no battery field, no PIN UI). */
@Serializable data class Capabilities(val apiLevel: Int = 1, val sessionPin: Boolean = false, val batteryPercent: Boolean = false)
