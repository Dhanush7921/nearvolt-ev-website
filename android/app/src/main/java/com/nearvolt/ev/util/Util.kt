package com.nearvolt.ev.util

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object Labels {
    fun connector(c: String) = when (c) {
        "DOMESTIC_15A" -> "15 A home socket"
        "INDUSTRIAL_16A" -> "16 A industrial socket"
        "TYPE2_AC" -> "Type 2 (AC)"
        "BHARAT_AC001" -> "Bharat AC-001"
        "LECCS" -> "LECCS (light EV)"
        "CCS2" -> "CCS2 (DC)"
        "BHARAT_DC001" -> "Bharat DC-001"
        "CHADEMO" -> "CHAdeMO"
        "GBT" -> "GB/T"
        else -> c
    }
    fun vehicle(t: String) = when (t) { "two_wheeler" -> "2-wheeler"; "three_wheeler" -> "3-wheeler"; "car" -> "Car"; else -> t }
    fun km(v: Double) = String.format(Locale.US, "%.1f km", v)
    fun kw(v: Double) = if (v % 1.0 == 0.0) "${v.toInt()} kW" else String.format(Locale.US, "%.1f kW", v)
}

object Time {
    private val fmt = DateTimeFormatter.ofPattern("d MMM, h:mm a", Locale.ENGLISH).withZone(ZoneId.of("Asia/Kolkata"))
    fun parse(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }
    fun display(iso: String?): String = parse(iso)?.let { fmt.format(it) } ?: ""
    fun ago(iso: String?): String {
        val t = parse(iso) ?: return ""
        val m = Duration.between(t, Instant.now()).toMinutes()
        return when { m < 1 -> "just now"; m < 60 -> "$m min ago"; m < 1440 -> "${m / 60} h ago"; else -> display(iso) }
    }
    fun secondsSince(iso: String?): Long = parse(iso)?.let { Duration.between(it, Instant.now()).seconds.coerceAtLeast(0) } ?: -1
    fun secondsUntil(iso: String?): Long = parse(iso)?.let { Duration.between(Instant.now(), it).seconds.coerceAtLeast(0) } ?: 0
}

object Links {
    // Firebase Hosting default domain until a custom domain is purchased.
    private const val SITE = "https://nearvolt-ev-prod.web.app"
    const val PRIVACY = "$SITE/privacy.html"
    const val TERMS = "$SITE/terms.html"
    const val DELETE = "$SITE/delete-account.html"
    const val EMERGENCY = "112" // India Emergency Response Support System

    fun open(ctx: Context, url: String) {
        try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: ActivityNotFoundException) { }
    }
    fun dial(ctx: Context, number: String) {
        try { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number"))) } catch (_: ActivityNotFoundException) { }
    }
    /** Hands navigation to Google Maps (app if installed, browser otherwise). */
    fun navigate(ctx: Context, mapsUrl: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(mapsUrl)).setPackage("com.google.android.apps.maps")
        try { ctx.startActivity(intent) } catch (_: ActivityNotFoundException) { open(ctx, mapsUrl) }
    }
}
