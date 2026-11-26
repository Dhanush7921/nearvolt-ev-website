package com.nearvolt.ev.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.nearvolt.ev.MainActivity
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch

/** In-process signal so open screens refresh immediately when a push arrives. */
object PushEvents {
    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val events = _events.asSharedFlow()
    fun emit(requestId: String) { _events.tryEmit(requestId) }
}

object Notifications {
    const val CHANNEL_REQUESTS = "requests"
    const val CHANNEL_ACCOUNT = "account"
    const val EXTRA_REQUEST_ID = "nv_request_id"

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_REQUESTS, ctx.getString(R.string.channel_requests), NotificationManager.IMPORTANCE_HIGH).apply {
            description = ctx.getString(R.string.channel_requests_desc); lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
        })
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ACCOUNT, ctx.getString(R.string.channel_account), NotificationManager.IMPORTANCE_DEFAULT).apply {
            lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
        })
    }

    fun show(ctx: Context, title: String, body: String, requestId: String?) {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            requestId?.let { putExtra(EXTRA_REQUEST_ID, it) }
        }
        val pi = PendingIntent.getActivity(ctx, (requestId ?: title).hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // Lock screen shows a generic public version: no names, addresses or details.
        val public = NotificationCompat.Builder(ctx, CHANNEL_REQUESTS).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(ctx.getString(R.string.app_name)).setContentText(ctx.getString(R.string.notif_public_text)).build()
        val n = NotificationCompat.Builder(ctx, if (requestId != null) CHANNEL_REQUESTS else CHANNEL_ACCOUNT)
            .setSmallIcon(R.drawable.ic_notification).setColor(ContextCompat.getColor(ctx, R.color.moss))
            .setContentTitle(title).setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true).setContentIntent(pi).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_STATUS).build()
        NotificationManagerCompat.from(ctx).notify((requestId ?: title).hashCode(), n)
    }
}

class NearVoltMessagingService : FirebaseMessagingService() {
    @Deprecated("FCM token callback; kept until Installation ID migration")
    override fun onNewToken(token: String) {
        val app = NearVoltApp.instance
        app.scope.launch { app.container.auth.registerDevice() }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val requestId = message.data["requestId"]?.takeIf { it.isNotBlank() }
        requestId?.let { PushEvents.emit(it) }
        val n = message.notification ?: return
        Notifications.show(this, n.title ?: getString(R.string.app_name), n.body ?: "", requestId)
    }
}
