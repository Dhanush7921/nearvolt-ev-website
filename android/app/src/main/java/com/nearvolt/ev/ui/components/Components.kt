package com.nearvolt.ev.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.draw.scale
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.ApiResult

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false, danger: Boolean = false) {
    val src = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    Button(onClick = hapticClick(onClick), enabled = enabled && !loading, interactionSource = src,
        modifier = modifier.fillMaxWidth().heightIn(min = 54.dp).scale(rememberPressScale(src)),
        shape = RoundedCornerShape(16.dp),
        colors = if (danger) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError) else ButtonDefaults.buttonColors()) {
        if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary) else Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(16.dp)) {
        if (icon != null) { Icon(icon, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) =
    Text(text, style = MaterialTheme.typography.titleLarge, modifier = modifier.semantics { heading() })

@Composable
fun NvCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)
    val edge = BorderStroke(1.dp, Brush.linearGradient(listOf(MaterialTheme.colorScheme.primary.copy(alpha = 0.22f), MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f), Color.Transparent)))
    if (onClick != null) Card(onClick = onClick, modifier = modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, colors = colors, border = edge) { Column(Modifier.padding(18.dp), content = content) }
    else Card(modifier = modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, colors = colors, border = edge) { Column(Modifier.padding(18.dp), content = content) }
}

@Composable
fun StatusPill(text: String, tone: Tone) {
    val (bg, fg) = when (tone) {
        Tone.Good -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        Tone.Warn -> Color(0xFFFFF1D6) to Color(0xFF6B4500)
        Tone.Bad -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
        Tone.Neutral -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(text, color = fg, style = MaterialTheme.typography.labelMedium, modifier = Modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp))
}
enum class Tone { Good, Warn, Bad, Neutral }

@Composable
fun CenterState(icon: ImageVector, title: String, body: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(84.dp).background(Brush.radialGradient(listOf(MaterialTheme.colorScheme.primary.copy(alpha = 0.22f), Color.Transparent)), CircleShape), contentAlignment = Alignment.Center) {
            Box(Modifier.size(56.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(28.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (action != null && onAction != null) { Spacer(Modifier.height(16.dp)); SecondaryButton(action, onAction, Modifier.widthIn(max = 260.dp)) }
    }
}

@Composable
fun ErrorState(err: ApiResult.Err, onRetry: () -> Unit) = CenterState(
    if (err.isOffline) Icons.Outlined.CloudOff else Icons.Outlined.ErrorOutline,
    stringResource(if (err.isOffline) R.string.state_offline_title else R.string.state_error_title), err.message, stringResource(R.string.action_retry), onRetry)

@Composable
fun EmptyState(title: String, body: String, action: String? = null, onAction: (() -> Unit)? = null) = CenterState(Icons.Outlined.Inbox, title, body, action, onAction)

@Composable
fun LoadingState(modifier: Modifier = Modifier) = SkeletonList(3, modifier.padding(20.dp))

@Composable
fun InlineMessage(text: String?, isError: Boolean = true) {
    AnimatedVisibility(text != null, enter = fadeIn(), exit = fadeOut()) {
        Text(text.orEmpty(), color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 6.dp))
    }
}

@Composable
fun CheckRow(checked: Boolean, onChange: (Boolean) -> Unit, label: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = checked, role = Role.Checkbox, onValueChange = onChange), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = null)
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}
