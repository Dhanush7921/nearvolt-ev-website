package com.nearvolt.ev.ui.components

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.nearvolt.ev.ui.theme.Brand

/**
 * Original NEARVOLT EV illustration, drawn in code (no image assets, crisp at any density, themed for light/dark):
 * a home wall charger feeding an EV through a cable, with energy pulses travelling along the cable when [charging].
 */
@Composable
fun EvIllustration(modifier: Modifier = Modifier, charging: Boolean = true, height: Dp = 140.dp) {
    val reduced = rememberReducedMotion()
    val t = if (reduced || !charging) 0.35f else rememberInfiniteTransition(label = "ev").animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "t").value
    val body = MaterialTheme.colorScheme.primary
    val glass = MaterialTheme.colorScheme.primaryContainer
    val ink = MaterialTheme.colorScheme.onSurface
    val ground = MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier.fillMaxWidth().height(height).clearAndSetSemantics { }) {
        val w = size.width; val h = size.height
        val u = minOf(w / 320f, h / 140f)            // design units → pixels, centred
        val ox = (w - 320f * u) / 2; val oy = (h - 140f * u) / 2
        fun p(x: Float, y: Float) = Offset(ox + x * u, oy + y * u)
        // ground + soft glow
        drawLine(ground, p(10f, 118f), p(310f, 118f), strokeWidth = 2f * u, cap = StrokeCap.Round)
        drawCircle(Brush.radialGradient(listOf(Brand.NeonMint.copy(alpha = if (charging) 0.28f else 0.12f), Color.Transparent), p(215f, 92f), 110f * u), 110f * u, p(215f, 92f))
        // wall charger
        drawRoundRect(body, p(24f, 34f), Size(34f * u, 58f * u), CornerRadius(8f * u))
        drawRoundRect(glass, p(31f, 44f), Size(20f * u, 14f * u), CornerRadius(3f * u))
        drawCircle(if (charging) Brand.NeonMint else ground, 3.5f * u, p(41f, 74f))
        // cable: charger → car charge port
        val cable = Path().apply { moveTo(p(41f, 92f).x, p(41f, 92f).y); cubicTo(p(50f, 132f).x, p(50f, 132f).y, p(140f, 132f).x, p(140f, 132f).y, p(168f, 86f).x, p(168f, 86f).y) }
        drawPath(cable, ink.copy(alpha = 0.75f), style = Stroke(4f * u, cap = StrokeCap.Round))
        if (charging) {
            val m = PathMeasure().apply { setPath(cable, false) }
            repeat(3) { i ->
                val f = ((t + i / 3f) % 1f)
                drawCircle(Brand.NeonMint, 4.2f * u, m.getPosition(m.length * f))
                drawCircle(Brand.NeonMint.copy(alpha = 0.25f), 9f * u, m.getPosition(m.length * f))
            }
        }
        // car body (side profile)
        val car = Path().apply {
            moveTo(p(150f, 104f).x, p(150f, 104f).y)
            lineTo(p(150f, 86f).x, p(150f, 86f).y)
            cubicTo(p(152f, 76f).x, p(152f, 76f).y, p(166f, 72f).x, p(166f, 72f).y, p(182f, 70f).x, p(182f, 70f).y)
            cubicTo(p(196f, 54f).x, p(196f, 54f).y, p(214f, 46f).x, p(214f, 46f).y, p(238f, 46f).x, p(238f, 46f).y)
            cubicTo(p(262f, 46f).x, p(262f, 46f).y, p(278f, 58f).x, p(278f, 58f).y, p(290f, 70f).x, p(290f, 70f).y)
            cubicTo(p(302f, 72f).x, p(302f, 72f).y, p(306f, 80f).x, p(306f, 80f).y, p(306f, 90f).x, p(306f, 90f).y)
            lineTo(p(306f, 104f).x, p(306f, 104f).y); close()
        }
        drawPath(car, Brush.linearGradient(listOf(body, Brand.Forest), p(150f, 46f), p(306f, 104f)))
        val windows = Path().apply {
            moveTo(p(192f, 70f).x, p(192f, 70f).y); cubicTo(p(202f, 58f).x, p(202f, 58f).y, p(214f, 53f).x, p(214f, 53f).y, p(232f, 53f).x, p(232f, 53f).y)
            lineTo(p(232f, 70f).x, p(232f, 70f).y); close()
            moveTo(p(240f, 53f).x, p(240f, 53f).y); cubicTo(p(258f, 53f).x, p(258f, 53f).y, p(270f, 60f).x, p(270f, 60f).y, p(278f, 70f).x, p(278f, 70f).y)
            lineTo(p(240f, 70f).x, p(240f, 70f).y); close()
        }
        drawPath(windows, glass.copy(alpha = 0.9f))
        drawLine(Brand.NeonMint.copy(alpha = 0.8f), p(156f, 92f), p(300f, 92f), 1.5f * u)        // light line
        drawCircle(if (charging) Brand.NeonMint else glass, 3f * u, p(168f, 86f))                // charge port
        for (cx in listOf(180f, 276f)) { drawCircle(ink, 13f * u, p(cx, 106f)); drawCircle(ground, 6f * u, p(cx, 106f)) }
    }
}

/** Tinted circular icon badge used as a list leading element. */
@Composable
fun LeadingBadge(icon: ImageVector, tone: Tone = Tone.Good, size: Dp = 40.dp) {
    val (bg, fg) = when (tone) {
        Tone.Good -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        Tone.Warn -> Color(0xFFFFF1D6) to Color(0xFF6B4500)
        Tone.Bad -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
        Tone.Neutral -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Box(Modifier.size(size).background(bg, CircleShape), contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(size * 0.5f), tint = fg) }
}

// ---- Shared-element support (list card ↔ detail). No-ops when scopes are absent or motion is reduced. ----
@OptIn(ExperimentalSharedTransitionApi::class)
val LocalSharedScope = staticCompositionLocalOf<SharedTransitionScope?> { null }
val LocalNavAnimScope = staticCompositionLocalOf<AnimatedVisibilityScope?> { null }

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun Modifier.sharedElement(key: String): Modifier {
    val shared = LocalSharedScope.current ?: return this
    val anim = LocalNavAnimScope.current ?: return this
    if (rememberReducedMotion()) return this
    return with(shared) { this@sharedElement.sharedBounds(rememberSharedContentState(key), anim, resizeMode = SharedTransitionScope.ResizeMode.RemeasureToBounds) }
}
