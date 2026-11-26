package com.nearvolt.ev.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.nearvolt.ev.data.api.LatLng
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.coroutines.resume

data class Fix(val point: LatLng, val accuracyM: Float, val approximate: Boolean, val label: String)

sealed interface LocationResult {
    data class Found(val fix: Fix) : LocationResult
    data object PermissionDenied : LocationResult
    data object ServicesOff : LocationResult
    data object Unavailable : LocationResult
}

/** One-shot foreground location. No continuous tracking and no background location. */
class LocationHelper(private val ctx: Context) {
    fun hasFine() = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun hasCoarse() = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun servicesOn(): Boolean {
        val lm = ctx.getSystemService(LocationManager::class.java) ?: return false
        return if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    @SuppressLint("MissingPermission")
    suspend fun current(): LocationResult {
        if (!hasFine() && !hasCoarse()) return LocationResult.PermissionDenied
        if (!servicesOn()) return LocationResult.ServicesOff
        val approximate = !hasFine()
        val req = CurrentLocationRequest.Builder()
            .setPriority(if (approximate) Priority.PRIORITY_BALANCED_POWER_ACCURACY else Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(60_000).setDurationMillis(15_000).build()
        val cts = CancellationTokenSource()
        val loc = runCatching { LocationServices.getFusedLocationProviderClient(ctx).getCurrentLocation(req, cts.token).await() }.getOrNull()
            ?: return LocationResult.Unavailable
        return LocationResult.Found(Fix(LatLng(loc.latitude, loc.longitude), loc.accuracy, approximate, "Current location"))
    }

    /** Manual location: accepts "17.72, 83.30", a Google Maps link containing coordinates, or an address (on-device Geocoder). */
    suspend fun resolveManual(input: String): Fix? {
        parseCoordinates(input)?.let { return Fix(it, 0f, false, "Entered coordinates") }
        if (!Geocoder.isPresent()) return null
        val g = Geocoder(ctx, Locale.Builder().setLanguage("en").setRegion("IN").build())
        val q = if (input.contains("visakhapatnam", true) || input.contains("vizag", true)) input else "$input, Visakhapatnam, Andhra Pradesh"
        val addr = if (Build.VERSION.SDK_INT >= 33) suspendCancellableCoroutine { c ->
            g.getFromLocationName(q, 1, object : Geocoder.GeocodeListener {
                override fun onGeocode(list: MutableList<android.location.Address>) { c.resume(list.firstOrNull()) }
                override fun onError(errorMessage: String?) { c.resume(null) }
            })
        } else withContext(Dispatchers.IO) { @Suppress("DEPRECATION") runCatching { g.getFromLocationName(q, 1)?.firstOrNull() }.getOrNull() }
        return addr?.let { Fix(LatLng(it.latitude, it.longitude), 500f, true, it.getAddressLine(0) ?: input) }
    }

    companion object {
        private val COORD = Regex("""(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})""")
        private val AT = Regex("""@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)""")
        fun parseCoordinates(s: String): LatLng? {
            val m = AT.find(s) ?: COORD.find(s) ?: return null
            val lat = m.groupValues[1].toDoubleOrNull() ?: return null
            val lng = m.groupValues[2].toDoubleOrNull() ?: return null
            return if (lat in -90.0..90.0 && lng in -180.0..180.0) LatLng(lat, lng) else null
        }
    }
}
