package com.nearvolt.ev.ui.screens

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ElectricCar
import androidx.compose.material.icons.outlined.EvStation
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.nearvolt.ev.R
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.InlineMessage
import com.nearvolt.ev.ui.components.rememberReducedMotion
import com.nearvolt.ev.ui.theme.Brand

/**
 * V1.4 Driver / Host switch. Instant (no sign-out). A mode the account doesn't have yet shows a lock and opens the enable dialog.
 * Hidden entirely on servers that don't advertise dual-role support, unless the account already has both modes.
 */
@Composable
fun ModeSwitch(app: AppViewModel, modifier: Modifier = Modifier) {
    val s by app.state.collectAsStateWithLifecycle()
    if (s.me == null || (!s.dualRoleServer && !(s.canDrive && s.canHost))) return
    var enabling by remember { mutableStateOf<String?>(null) }
    val host = s.hostMode
    val reduced = rememberReducedMotion()
    var w by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val offset by animateDpAsState(if (host) with(density) { (w / 2).toDp() } else 0.dp, if (reduced) tween(0) else spring(dampingRatio = 0.8f), label = "mode")
    Box(modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceVariant)
        .onSizeChanged { w = it.width }.selectableGroup()) {
        // Sliding emerald thumb
        Box(Modifier.offset(x = offset).fillMaxHeight().fillMaxWidth(0.5f).padding(4.dp).clip(RoundedCornerShape(50))
            .background(Brush.horizontalGradient(listOf(Brand.EmeraldBrand, Brand.NeonMint.copy(alpha = 0.9f)))))
        Row(Modifier.fillMaxSize()) {
            listOf(Triple("driver", R.string.mode_driver, s.canDrive), Triple("host", R.string.mode_host, s.canHost)).forEach { (m, label, has) ->
                val selected = (m == "host") == host
                Row(Modifier.weight(1f).fillMaxHeight().selectable(selected, role = Role.Tab) { if (has) app.setMode(m) else enabling = m },
                    horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (!has) Icons.Outlined.Lock else if (m == "host") Icons.Outlined.EvStation else Icons.Outlined.ElectricCar, null, Modifier.size(18.dp),
                        tint = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(label), style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    enabling?.let { m -> EnableModeDialog(app, m) { enabling = null } }
}

/** Explains exactly what enabling a mode does. Host mode never approves anything: the listing still goes through verification. */
@Composable
fun EnableModeDialog(app: AppViewModel, mode: String, onDismiss: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() },
        icon = { Icon(if (mode == "host") Icons.Outlined.EvStation else Icons.Outlined.ElectricCar, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text(stringResource(if (mode == "host") R.string.mode_become_host else R.string.mode_enable_driver)) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(if (mode == "host") R.string.mode_become_host_body else R.string.mode_enable_driver_body))
            Text(stringResource(R.string.mode_same_account), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            InlineMessage(err)
        } },
        confirmButton = { TextButton(enabled = !busy, onClick = { busy = true; err = null
            app.enableMode(mode) { e -> busy = false; if (e == null) onDismiss() else err = e } }) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.mode_enable_confirm)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } })
}
