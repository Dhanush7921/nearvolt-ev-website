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

sealed interface AuthOutcome {
    data object Success : AuthOutcome
    data object Cancelled : AuthOutcome
    data class Failed(val message: String) : AuthOutcome
}

/** Firebase Authentication: Google (Credential Manager), passwordless email link, and phone OTP via our backend. */
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

    suspend fun signInWithGoogle(activity: Activity): AuthOutcome {
        val a = auth ?: return AuthOutcome.Failed("Sign-in is not configured in this build.")
        val clientId = webClientId(activity) ?: return AuthOutcome.Failed("Google sign-in is not configured in this build.")
        return try {
            val option = GetSignInWithGoogleOption.Builder(clientId).build()
            val res = CredentialManager.create(activity).getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
            val c = res.credential
            if (c !is CustomCredential || c.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) return AuthOutcome.Failed("Unsupported credential.")
            val idToken = GoogleIdTokenCredential.createFrom(c.data).idToken
            val credential = GoogleAuthProvider.getCredential(idToken, null)
            val existing = a.currentUser
            if (existing != null) existing.linkWithCredential(credential).await() else a.signInWithCredential(credential).await()
            afterSignIn("google"); AuthOutcome.Success
        } catch (e: GetCredentialCancellationException) { AuthOutcome.Cancelled }
        catch (e: NoCredentialException) { AuthOutcome.Failed("No Google account found on this device.") }
        catch (e: GetCredentialException) { AuthOutcome.Failed("Google sign-in failed. Please try again.") }
        catch (e: FirebaseAuthUserCollisionException) { AuthOutcome.Failed("This Google account is already linked to another NEARVOLT account.") }
        catch (e: Exception) { AuthOutcome.Failed("Sign-in failed. Check your connection and try again.") }
    }

    /** OAuth web client ID: explicit build property, else the `default_web_client_id` generated from google-services.json. */
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
            afterSignIn("email_link"); AuthOutcome.Success
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
                r.value.customToken?.let { a.signInWithCustomToken(it).await(); afterSignIn("phone") }
                if (r.value.linked) a.currentUser?.reload()?.await()
                AuthOutcome.Success
            } catch (e: Exception) { AuthOutcome.Failed("Sign-in failed. Please try again.") }
        }
    }

    suspend fun refreshClaims() { runCatching { auth?.currentUser?.getIdToken(true)?.await() } }

    private suspend fun afterSignIn(method: String) {
        call { ApiClient.service.session(SessionBody(method)) }
        registerDevice()
    }

    // FCM registration tokens are deprecated in favour of Installation IDs (firebase-messaging 25.1.2+) but remain supported.
    // Migration to register()/onRegistered is tracked in PRODUCTION_STATUS.md.
    @Suppress("DEPRECATION")
    suspend fun registerDevice() {
        if (!configured || currentUser == null) return
        val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() ?: return
        if (call { ApiClient.service.registerDevice(DeviceBody(token)) } is ApiResult.Ok) prefs.setDeviceToken(token)
    }

    suspend fun signOut() {
        prefs.deviceToken()?.let { t -> call { ApiClient.service.removeDevice(t) } }
        prefs.clearSession()
        auth?.signOut()
    }

    /** Called after server-side deletion succeeded; the Firebase user no longer exists. */
    suspend fun localSignOutAfterDeletion() { prefs.clearSession(); auth?.signOut() }
}
