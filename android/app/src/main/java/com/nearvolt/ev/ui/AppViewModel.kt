package com.nearvolt.ev.ui

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nearvolt.ev.BuildConfig
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.data.api.ApiResult
import com.nearvolt.ev.data.api.Consents
import com.nearvolt.ev.data.api.Me
import com.nearvolt.ev.data.api.ProfileBody
import com.nearvolt.ev.data.api.PublicConfig
import com.nearvolt.ev.data.auth.AuthOutcome
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class Phase { Loading, NotConfigured, UpdateRequired, Maintenance, Onboarding, SignIn, Consent, Setup, Main, Error }

data class AppState(
    val loading: Boolean = true,
    val phase: Phase = Phase.Loading,
    val config: PublicConfig? = null,
    val me: Me? = null,
    val theme: String = "system",
    val message: String? = null,
    val emailLinkNeedsEmail: String? = null,
    val openRequestId: String? = null,
    val updateAvailable: Boolean = false,
)

const val TERMS_VERSION = "1.0"
const val PRIVACY_VERSION = "1.0"

/** Decides which part of the app the user sees: gates, onboarding, sign-in, consent, profile setup, or the role-based main app. */
class AppViewModel : ViewModel() {
    val container = NearVoltApp.instance.container
    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()
    private var pendingLink: String? = null

    init {
        viewModelScope.launch { container.prefs.theme.collect { t -> _state.update { it.copy(theme = t) } } }
        viewModelScope.launch {
            combine(container.prefs.onboarded, container.auth.userFlow.map { it?.uid }.distinctUntilChanged()) { a, b -> a to b }
                .collect { refresh() }
        }
    }

    fun refresh() = viewModelScope.launch {
        if (!container.auth.configured) { _state.update { it.copy(loading = false, phase = Phase.NotConfigured) }; return@launch }
        val cfg = when (val c = container.repo.config()) {
            is ApiResult.Ok -> c.value
            is ApiResult.Err -> {
                val msg = if (BuildConfig.API_BASE_URL.contains("invalid")) "This build has no server address configured (NV_PROD_API_BASE_URL)."
                    else if (c.isOffline) "Can't reach NEARVOLT servers. Check your internet connection and try again." else c.message
                _state.update { it.copy(loading = false, phase = Phase.Error, message = msg) }; return@launch
            }
        }
        val vc = BuildConfig.VERSION_CODE
        _state.update { it.copy(config = cfg, updateAvailable = vc < cfg.latestVersionCode) }
        when {
            vc < cfg.minSupportedVersionCode -> return@launch done(Phase.UpdateRequired)
            cfg.maintenance.enabled -> return@launch done(Phase.Maintenance)
        }
        val onboarded = container.prefs.onboarded.first()
        val user = container.auth.currentUser
        if (user == null) { done(if (onboarded) Phase.SignIn else Phase.Onboarding); pendingLink?.let { completeLink(it, null) }; return@launch }
        when (val m = container.repo.me()) {
            is ApiResult.Err -> if (m.http == 401) { container.auth.signOut(); done(Phase.SignIn) } else _state.update { it.copy(loading = false, phase = Phase.Error, message = m.message) }
            is ApiResult.Ok -> {
                _state.update { it.copy(me = m.value) }
                done(phaseFor(m.value))
                container.auth.registerDevice()
            }
        }
    }

    private fun phaseFor(me: Me): Phase = when {
        me.consents == null -> Phase.Consent
        me.role == null || me.name.isBlank() -> Phase.Setup
        else -> Phase.Main
    }
    private fun done(p: Phase) = _state.update { it.copy(loading = false, phase = p) }

    fun finishOnboarding() = viewModelScope.launch { container.prefs.setOnboarded() }
    fun setTheme(t: String) = viewModelScope.launch { container.prefs.setTheme(t) }
    fun consumeMessage() = _state.update { it.copy(message = null) }
    fun openRequest(id: String) = _state.update { it.copy(openRequestId = id) }
    fun requestOpened() = _state.update { it.copy(openRequestId = null) }

    fun acceptConsents(location: Boolean, notifications: Boolean, onDone: (String?) -> Unit) = viewModelScope.launch {
        when (val r = container.repo.saveConsents(Consents(TERMS_VERSION, PRIVACY_VERSION, location, notifications))) {
            is ApiResult.Ok -> { _state.update { it.copy(phase = Phase.Setup) }; onDone(null) }
            is ApiResult.Err -> onDone(r.message)
        }
    }

    fun completeSetup(role: String, profile: ProfileBody, onDone: (String?) -> Unit) = viewModelScope.launch {
        val me = _state.value.me
        if (me?.role == null) {
            when (val r = container.repo.setRole(role)) { is ApiResult.Err -> return@launch onDone(r.message); else -> container.auth.refreshClaims() }
        }
        when (val p = container.repo.saveProfile(profile)) {
            is ApiResult.Err -> onDone(p.message)
            is ApiResult.Ok -> { onDone(null); refresh() }
        }
    }

    fun onProfileChanged(me: Me) = _state.update { it.copy(me = me) }

    // ---- Auth actions ----
    fun google(activity: Activity, onDone: (String?) -> Unit) = viewModelScope.launch {
        when (val o = container.auth.signInWithGoogle(activity)) { is AuthOutcome.Failed -> onDone(o.message); else -> onDone(null) }
    }
    fun onEmailLink(link: String) { pendingLink = link; if (!_state.value.loading) completeLink(link, null) }
    fun completeLink(link: String, email: String?) = viewModelScope.launch {
        when (val o = container.auth.completeEmailLink(link, email)) {
            is AuthOutcome.Failed -> if (o.message == "EMAIL_NEEDED") _state.update { it.copy(emailLinkNeedsEmail = link) } else _state.update { it.copy(message = o.message) }
            else -> { pendingLink = null; _state.update { it.copy(emailLinkNeedsEmail = null) } }
        }
    }
    fun signOut() = viewModelScope.launch { container.auth.signOut(); _state.update { AppState(loading = false, phase = Phase.SignIn, theme = it.theme, config = it.config) } }
    fun deleted() = viewModelScope.launch { container.auth.localSignOutAfterDeletion(); _state.update { AppState(loading = false, phase = Phase.SignIn, theme = it.theme, config = it.config, message = "Your account was deleted.") } }
}
