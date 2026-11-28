package com.nearvolt.ev.data.prefs

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.store by preferencesDataStore("nearvolt_prefs")

/** Non-sensitive local preferences only. Auth state is held by Firebase Auth, never here. */
class Prefs(private val ctx: Context) {
    private object K {
        val onboarded = booleanPreferencesKey("onboarded")
        val theme = stringPreferencesKey("theme") // system | light | dark
        val pendingEmail = stringPreferencesKey("pending_email")
        val lastDeviceToken = stringPreferencesKey("device_token")
        val graphics = stringPreferencesKey("graphics") // adaptive | ultra | lite
        val uiMode = stringPreferencesKey("ui_mode") // V1.4: "driver" | "host" — UI preference only, never authorization
        val lowData = booleanPreferencesKey("low_data") // V1.3: list-first map (no tiles until asked), Lite graphics
    }
    val onboarded: Flow<Boolean> = ctx.store.data.map { it[K.onboarded] ?: false }
    val theme: Flow<String> = ctx.store.data.map { it[K.theme] ?: "system" }
    suspend fun setOnboarded() = ctx.store.edit { it[K.onboarded] = true }
    suspend fun setTheme(v: String) = ctx.store.edit { it[K.theme] = v }
    val graphics: Flow<String> = ctx.store.data.map { it[K.graphics] ?: "adaptive" }
    suspend fun setGraphics(v: String) = ctx.store.edit { it[K.graphics] = v }
    val uiMode: Flow<String?> = ctx.store.data.map { it[K.uiMode] }
    suspend fun setUiMode(v: String?) = ctx.store.edit { if (v == null) it.remove(K.uiMode) else it[K.uiMode] = v }
    val lowData: Flow<Boolean> = ctx.store.data.map { it[K.lowData] ?: false }
    suspend fun setLowData(v: Boolean) = ctx.store.edit { it[K.lowData] = v }
    suspend fun setPendingEmail(v: String?) = ctx.store.edit { if (v == null) it.remove(K.pendingEmail) else it[K.pendingEmail] = v }
    suspend fun pendingEmail(): String? = ctx.store.data.first()[K.pendingEmail]
    suspend fun setDeviceToken(v: String?) = ctx.store.edit { if (v == null) it.remove(K.lastDeviceToken) else it[K.lastDeviceToken] = v }
    suspend fun deviceToken(): String? = ctx.store.data.first()[K.lastDeviceToken]
    suspend fun clearSession() = ctx.store.edit { p: androidx.datastore.preferences.core.MutablePreferences -> p.remove(K.pendingEmail); p.remove(K.lastDeviceToken) }
}
