package com.nearvolt.ev.data.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.ActionCodeSettings
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.messaging.FirebaseMessaging
import com.nearvolt.ev.BuildConfig
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.data.api.ApiClient
import com.nearvolt.ev.data.api.ApiResult
import com.nearvolt.ev.data.api.DeviceBody
import com.nearvolt.ev.data.api.OtpSendBody
import com.nearvolt.ev.data.api.OtpSent
import com.nearvolt.ev.data.api.OtpVerifyBody
import com.nearvolt.ev.data.api.SessionBody
import com.nearvolt.ev.data.api.call
import com.nearvolt.ev.data.prefs.Prefs
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import android.util.Log
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.FirebaseAuthWeakPasswordException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException

sealed interface AuthOutcome {
    data object Success : AuthOutcome
    data object Cancelled : AuthOutcome
    data class Failed(val message: String) : AuthOutcome
}

/** Firebase Authentication: Google (Credential Manager), passwordless email link, and phone OTP via our backend. */
private const val TAG = "NearVoltAuth"

class AuthRepository(private val prefs: Prefs) {
    val configured: Boolean get() = BuildConfig.FIREBASE_CONFIGURED && FirebaseApp.getApps(NearVoltApp.instance).isNotEmpty()
    private val auth: FirebaseAuth? get() = if (configured) FirebaseAuth.getInstance() else null
    val currentUser: FirebaseUser? get() = auth?.currentUser

    val userFlow: Flow<FirebaseUser?> = callbackFlow {
        val a = auth
        if (a == null) { trySend(null); awaitClose { }; return@callbackFlow }
        val l = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        a.addAuthStateListener(l)
        awaitClose { a.removeAuthStateListener(l) }
    }

    /**
     * Google sign-in via Credential Manager -> Firebase credential. Login is complete as soon as Firebase signs in;
     * session logging and push registration run in the background (they must never block or fail the login).
     */
    suspend fun signInWithGoogle(activity: Activity): AuthOutcome {
        val a = auth ?: return AuthOutcome.Failed("Sign-in is not configured in this build.")
        val clientId = webClientId(activity) ?: return AuthOutcome.Failed("Google sign-in is not configured in this build (missing web client ID).")
        val idToken = try {
            withTimeout(90_000) { // the account picker is user-driven; bounded so the spinner can never hang forever
                val option = GetSignInWithGoogleOption.Builder(clientId).build()
                val res = CredentialManager.create(activity).getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
                val c = res.credential
                if (c !is CustomCredential || c.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) null
                else GoogleIdTokenCredential.createFrom(c.data).idToken
            }
        } catch (e: GetCredentialCancellationException) { return AuthOutcome.Cancelled }
        catch (e: NoCredentialException) { return AuthOutcome.Failed("No Google account is available on this device. Add one in Settings → Accounts, then try again.") }
        catch (e: GetCredentialException) {
            Log.w(TAG, "Credential Manager failed: ${e.type}: ${e.message}")
            return AuthOutcome.Failed("Google sign-in could not start (${e.type.substringAfterLast('.')}). Make sure Google Play services is up to date and the app's SHA-1/SHA-256 are registered in Firebase.")
        } catch (e: TimeoutCancellationException) { return AuthOutcome.Failed("Google sign-in timed out. Please try again.") }
            ?: return AuthOutcome.Failed("Unsupported credential type returned by Google.")
        return firebaseSignIn("google") {
            val credential = GoogleAuthProvider.getCredential(idToken, null)
            val existing = a.currentUser
            if (existing != null) existing.linkWithCredential(credential).await() else a.signInWithCredential(credential).await()
        }
    }

    /** Runs a Firebase sign-in step with a hard timeout and maps Firebase errors to actionable messages. */
    private suspend fun firebaseSignIn(method: String, block: suspend () -> Unit): AuthOutcome = try {
        withTimeout(30_000) { block() }
        onSignedIn(method)
        AuthOutcome.Success
    } catch (e: TimeoutCancellationException) { AuthOutcome.Failed("Sign-in timed out. Check your connection and try again.") }
    catch (e: FirebaseAuthUserCollisionException) { AuthOutcome.Failed("This account is already linked to another NEARVOLT account.") }
    catch (e: FirebaseAuthWeakPasswordException) { AuthOutcome.Failed("Choose a stronger password (at least 8 characters with letters and numbers).") }
    catch (e: FirebaseAuthInvalidUserException) { AuthOutcome.Failed("No account found for this email, or it has been disabled.") }
    catch (e: FirebaseAuthInvalidCredentialsException) { AuthOutcome.Failed("Incorrect email or password.") }
    catch (e: FirebaseTooManyRequestsException) { AuthOutcome.Failed("Too many attempts. Please wait a few minutes and try again.") }
    catch (e: FirebaseNetworkException) { AuthOutcome.Failed("No internet connection. Check your network and try again.") }
    catch (e: Exception) { Log.w(TAG, "Firebase sign-in failed", e); AuthOutcome.Failed("Sign-in failed: ${e.message ?: "unknown error"}") }

    /** Non-blocking post-login work with bounded retries (Render may be waking up). */
    private fun onSignedIn(method: String) {
        NearVoltApp.instance.scope.launch {
            repeat(3) { attempt ->
                if (call { ApiClient.service.session(SessionBody(method)) } is ApiResult.Ok) return@launch
                delay(2_000L shl attempt)
            }
        }
        NearVoltApp.instance.scope.launch { registerDevice() }
    }

    // ---- Email / password (verified) ----
    suspend fun registerWithEmail(email: String, password: String): AuthOutcome {
        val a = auth ?: return AuthOutcome.Failed("Sign-in is not configured in this build.")
        return firebaseSignIn("password") {
            val r = a.createUserWithEmailAndPassword(email.trim(), password).await()
            r.user?.sendEmailVerification()?.await()
        }
    }
    suspend fun signInWithEmail(email: String, password: String): AuthOutcome {
        val a = auth ?: return AuthOutcome.Failed("Sign-in is not configured in this build.")
        return firebaseSignIn("password") { a.signInWithEmailAndPassword(email.trim(), password).await() }
    }
    suspend fun sendPasswordReset(email: String): AuthOutcome {
        val a = auth ?: return AuthOutcome.Failed("Sign-in is not configured in this build.")
        return try { withTimeout(30_000) { a.sendPasswordResetEmail(email.trim()).await() }; AuthOutcome.Success }
        catch (e: Exception) { AuthOutcome.Failed("Could not send the reset email. Check the address and try again.") }
    }
    suspend fun resendVerification(): AuthOutcome = try {
        withTimeout(30_000) { currentUser?.sendEmailVerification()?.await() }; AuthOutcome.Success
    } catch (e: FirebaseTooManyRequestsException) { AuthOutcome.Failed("Please wait a few minutes before requesting another email.") }
    catch (e: Exception) { AuthOutcome.Failed("Could not send the verification email. Try again.") }
    /** Reloads the user and forces a fresh ID token so the server sees email_verified=true. */
    suspend fun reloadVerified(): Boolean = try {
        withTimeout(30_000) { currentUser?.reload()?.await(); currentUser?.getIdToken(true)?.await() }
        currentUser?.isEmailVerified == true
    } catch (e: Exception) { false }
    val needsEmailVerification: Boolean get() = currentUser?.let { u -> u.providerData.any { it.providerId == "password" } && !u.isEmailVerified } == true

    /** OAuth web client ID: explicit build property, else default_web_client_id generated from google-services.json. */
    private fun webClientId(ctx: android.content.Context): String? {
        BuildConfig.GOOGLE_WEB_CLIENT_ID.takeIf { it.isNotBlank() }?.let { return it }
        @android.annotation.SuppressLint("DiscouragedApi")
        val id = ctx.resources.getIdentifier("default_web_client_id", "string", ctx.packageName)
        return if (id != 0) ctx.getString(id).takeIf { it.isNotBlank() } else null
    }

    /** Sends a passwordless sign-in link. The link opens the app via App Links on the Firebase Hosting domain. */
    suspend fun sendEmailLink(email: String): AuthOutcome {
        val a = auth ?: return AuthOutcome.Failed("Sign-in is not configured in this build.")
        return try {
            val settings = ActionCodeSettings.newBuilder()
                .setUrl("https://${BuildConfig.AUTH_LINK_HOST}/__/auth/links?continue=signin")
                .setHandleCodeInApp(true)
                .setAndroidPackageName(BuildConfig.APPLICATION_ID, true, "26")
                .setLinkDomain(BuildConfig.AUTH_LINK_HOST)
                .build()
            a.sendSignInLinkToEmail(email, settings).await()
            prefs.setPendingEmail(email)
            AuthOutcome.Success
        } catch (e: Exception) { AuthOutcome.Failed("Could not send the link. Check the email address and try again.") }
    }

    fun isEmailLink(link: String): Boolean = auth?.isSignInWithEmailLink(link) == true

    suspend fun completeEmailLink(link: String, typedEmail: String?): AuthOutcome {
        val a = auth ?: return AuthOutcome.Failed("Sign-in is not configured in this build.")
        val email = typedEmail ?: prefs.pendingEmail() ?: return AuthOutcome.Failed("EMAIL_NEEDED")
        return try {
            val existing = a.currentUser
            if (existing != null) existing.linkWithCredential(com.google.firebase.auth.EmailAuthProvider.getCredentialWithLink(email, link)).await()
            else a.signInWithEmailLink(email, link).await()
            prefs.setPendingEmail(null)
            onSignedIn("email_link"); AuthOutcome.Success
        } catch (e: FirebaseAuthUserCollisionException) { AuthOutcome.Failed("This email is already linked to another account.") }
        catch (e: Exception) { AuthOutcome.Failed("This sign-in link is invalid or has expired. Request a new one.") }
    }

    suspend fun sendOtp(phone: String): ApiResult<OtpSent> = call { ApiClient.service.otpSend(OtpSendBody(phone)) }

    /** Verifies the OTP on our server. Signed out → signs in with the returned custom token. Signed in → links the number. */
    suspend fun verifyOtp(phone: String, otp: String): AuthOutcome {
        val a = auth ?: return AuthOutcome.Failed("Sign-in is not configured in this build.")
        return when (val r = call { ApiClient.service.otpVerify(OtpVerifyBody(phone, otp)) }) {
            is ApiResult.Err -> AuthOutcome.Failed(r.message)
            is ApiResult.Ok -> try {
                r.value.customToken?.let { withTimeout(30_000) { a.signInWithCustomToken(it).await() }; onSignedIn("phone") }
                if (r.value.linked) a.currentUser?.reload()?.await()
                AuthOutcome.Success
            } catch (e: Exception) { AuthOutcome.Failed("Sign-in failed. Please try again.") }
        }
    }

    suspend fun refreshClaims() { runCatching { auth?.currentUser?.getIdToken(true)?.await() } }


    // FCM registration tokens are deprecated in favour of Installation IDs (firebase-messaging 25.1.2+) but remain supported.
    // Migration to register()/onRegistered is tracked in PRODUCTION_STATUS.md.
    @Suppress("DEPRECATION")
    suspend fun registerDevice() {
        if (!configured || currentUser == null) return
        val token = runCatching { withTimeout(20_000) { FirebaseMessaging.getInstance().token.await() } }.getOrNull() ?: return
        repeat(3) { attempt ->
            if (call { ApiClient.service.registerDevice(DeviceBody(token)) } is ApiResult.Ok) { prefs.setDeviceToken(token); return }
            delay(3_000L shl attempt)
        }
    }

    suspend fun signOut() {
        prefs.deviceToken()?.let { t -> runCatching { withTimeout(5_000) { call { ApiClient.service.removeDevice(t) } } } }
        prefs.clearSession()
        auth?.signOut()
    }

    /** Called after server-side deletion succeeded; the Firebase user no longer exists. */
    suspend fun localSignOutAfterDeletion() { prefs.clearSession(); auth?.signOut() }
}
