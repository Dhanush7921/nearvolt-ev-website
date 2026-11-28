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
import kotlinx.coroutines.async

enum class Phase { Loading, NotConfigured, UpdateRequired, Maintenance, Onboarding, SignIn, VerifyEmail, Consent, Setup, Main, Error }

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
    /** V1.4: preferred UI mode ("driver" | "host"). Only a display choice — every privileged action is authorized by the server. */
    val uiMode: String? = null,
) {
    val canDrive get() = me?.canDrive == true
    val canHost get() = me?.canHost == true
    /** Effective mode: the stored choice if this account has that mode, otherwise the account's legacy primary role. */
    val hostMode get() = when { uiMode == "host" && canHost -> true; uiMode == "driver" && canDrive -> false; else -> me?.role == "host" || (!canDrive && canHost) }
    val dualRoleServer get() = config?.capabilities?.dualRole == true
}

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
        viewModelScope.launch { container.prefs.uiMode.collect { m -> _state.update { it.copy(uiMode = m) } } }
        viewModelScope.launch {
            combine(container.prefs.onboarded, container.auth.userFlow.map { it?.uid }.distinctUntilChanged()) { a, b -> a to b }
                .collect { refresh() }
        }
    }

    private var refreshJob: kotlinx.coroutines.Job? = null
    /** One refresh at a time: a new call cancels the previous one (prevents duplicate /config + /me bursts on resume). */
    fun refresh() { refreshJob?.cancel(); refreshJob = viewModelScope.launch { doRefresh() } }

    private suspend fun doRefresh() = kotlinx.coroutines.coroutineScope {
        if (!container.auth.configured) { _state.update { it.copy(loading = false, phase = Phase.NotConfigured) }; return@coroutineScope }
        // /me starts in parallel with /config (independent requests); its result is only used AFTER the update/maintenance gates pass.
        val meJob = if (container.auth.currentUser != null && !container.auth.needsEmailVerification) async { container.repo.me() } else null
        val cfg = when (val c = container.repo.config()) {
            is ApiResult.Ok -> c.value
            is ApiResult.Err -> {
                val msg = if (BuildConfig.API_BASE_URL.contains("invalid")) "This build has no server address configured (NV_PROD_API_BASE_URL)."
                    else if (c.isOffline) "Can't reach NEARVOLT servers. Check your internet connection and try again." else c.message
                meJob?.cancel(); _state.update { it.copy(loading = false, phase = Phase.Error, message = msg) }; return@coroutineScope
            }
        }
        val vc = BuildConfig.VERSION_CODE
        com.nearvolt.ev.data.api.ServerCapabilities.current = cfg.capabilities
        _state.update { it.copy(config = cfg, updateAvailable = vc < cfg.latestVersionCode) }
        when {
            vc < cfg.minSupportedVersionCode -> { meJob?.cancel(); return@coroutineScope done(Phase.UpdateRequired) }
            cfg.maintenance.enabled -> { meJob?.cancel(); return@coroutineScope done(Phase.Maintenance) }
        }
        val onboarded = container.prefs.onboarded.first()
        val user = container.auth.currentUser
        if (user == null) { done(if (onboarded) Phase.SignIn else Phase.Onboarding); pendingLink?.let { completeLink(it, null) }; return@coroutineScope }
        if (container.auth.needsEmailVerification) return@coroutineScope done(Phase.VerifyEmail)
        when (val m = meJob?.await() ?: container.repo.me()) {
            // Never sign the user out silently: only a genuinely invalid session does that, and the reason is shown.
            is ApiResult.Err -> when (m.code) {
                "SESSION_INVALID" -> { container.auth.signOut(); _state.update { it.copy(loading = false, phase = Phase.SignIn, message = m.message) } }
                "EMAIL_NOT_VERIFIED" -> done(Phase.VerifyEmail)
                "APP_CHECK_REQUIRED", "APP_CHECK_FAILED" -> _state.update { it.copy(loading = false, phase = Phase.Error, message = m.message +
                    if (BuildConfig.DEBUG) "\n\nDebug build: register the App Check debug token from Logcat (tag DebugAppCheckProvider) in Firebase console → App Check → Manage debug tokens." else "\n\nPlease install NEARVOLT EV from Google Play.") }
                else -> _state.update { it.copy(loading = false, phase = Phase.Error, message = m.message) }
            }
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

    // ---- V1.4 dual role ----
    /** Instant switch, no sign-out. Ignored if the account doesn't have that mode (the server would refuse anyway). */
    fun setMode(mode: String) = viewModelScope.launch {
        val s = _state.value
        if ((mode == "host" && s.canHost) || (mode == "driver" && s.canDrive)) container.prefs.setUiMode(mode)
    }
    /** Adds Driver or Host mode to this same account via the server, refreshes the token claims and switches to it. */
    fun enableMode(mode: String, onDone: (String?) -> Unit) = viewModelScope.launch {
        when (val r = container.repo.addCapability(mode)) {
            is ApiResult.Err -> onDone(r.message)
            is ApiResult.Ok -> {
                container.auth.refreshClaims()
                when (val m = container.repo.me()) { is ApiResult.Ok -> _state.update { it.copy(me = m.value.copy(admin = it.me?.admin ?: m.value.admin)) }; else -> {} }
                container.prefs.setUiMode(mode); onDone(null)
            }
        }
    }

    // ---- Auth actions ----
    fun google(activity: Activity, onDone: (String?) -> Unit) = viewModelScope.launch {
        // onDone is always called (success, failure, cancel, timeout) so the button spinner always resets.
        val msg = try { when (val o = container.auth.signInWithGoogle(activity)) { is AuthOutcome.Failed -> o.message; else -> null } }
            catch (e: Exception) { "Sign-in failed: ${e.message}" }
        onDone(msg)
    }
    fun emailAuth(register: Boolean, email: String, password: String, onDone: (String?) -> Unit) = viewModelScope.launch {
        val o = if (register) container.auth.registerWithEmail(email, password) else container.auth.signInWithEmail(email, password)
        onDone((o as? AuthOutcome.Failed)?.message)
    }
    fun resetPassword(email: String, onDone: (String?) -> Unit) = viewModelScope.launch { onDone((container.auth.sendPasswordReset(email) as? AuthOutcome.Failed)?.message) }
    fun resendVerification(onDone: (String?) -> Unit) = viewModelScope.launch { onDone((container.auth.resendVerification() as? AuthOutcome.Failed)?.message) }
    fun checkVerified(onDone: (Boolean) -> Unit) = viewModelScope.launch { val v = container.auth.reloadVerified(); onDone(v); if (v) refresh() }
    fun onEmailLink(link: String) { pendingLink = link; if (!_state.value.loading) completeLink(link, null) }
    fun completeLink(link: String, email: String?) = viewModelScope.launch {
        when (val o = container.auth.completeEmailLink(link, email)) {
            is AuthOutcome.Failed -> if (o.message == "EMAIL_NEEDED") _state.update { it.copy(emailLinkNeedsEmail = link) } else _state.update { it.copy(message = o.message) }
            else -> { pendingLink = null; _state.update { it.copy(emailLinkNeedsEmail = null) } }
        }
    }
    /** Wipes this account's device-local data (garage, favourites, recent searches) and the session discovery cache. */
    private suspend fun wipeLocal() { container.auth.currentUser?.uid?.let { container.accountStore.wipe(it) }; container.discovery.value = com.nearvolt.ev.DiscoverySnapshot() }
    fun signOut() = viewModelScope.launch { wipeLocal(); container.prefs.setUiMode(null); container.auth.signOut(); _state.update { AppState(loading = false, phase = Phase.SignIn, theme = it.theme, config = it.config) } }
    fun deleted() = viewModelScope.launch { wipeLocal(); container.prefs.setUiMode(null); container.auth.localSignOutAfterDeletion(); _state.update { AppState(loading = false, phase = Phase.SignIn, theme = it.theme, config = it.config, message = "Your account was deleted.") } }
}
