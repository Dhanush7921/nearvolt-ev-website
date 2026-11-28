package com.nearvolt.ev.ui.components

import android.app.ActivityManager
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.nearvolt.ev.ui.theme.Brand

/**
 * Graphics quality for the NEW decorative layer only (glass highlights, ambient glow, decorative loops).
 * Original assets (logo reveal, splash, map, EV illustration) are never removed by this setting.
 *  - ADAPTIVE (default): ULTRA on capable devices, LITE on low-RAM devices.
 *  - ULTRA: ambient glow + glass highlights + decorative motion.
 *  - LITE: flat translucent surfaces, no ambient glow, no decorative loops.
 * System "Remove animations" always wins over every mode.
 */
enum class Graphics { Adaptive, Ultra, Lite }

data class GraphicsSpec(val glow: Boolean, val decorativeMotion: Boolean, val highlights: Boolean)

val LocalGraphics = staticCompositionLocalOf { GraphicsSpec(glow = true, decorativeMotion = true, highlights = true) }

fun resolveGraphics(mode: String, ctx: Context, reducedMotion: Boolean): GraphicsSpec {
    val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val lowEnd = am.isLowRamDevice || am.memoryClass < 192
    val ultra = when (mode) { "ultra" -> true; "lite" -> false; else -> !lowEnd }
    return GraphicsSpec(glow = ultra, decorativeMotion = ultra && !reducedMotion, highlights = ultra)
}

@Composable
fun isDarkSurface() = MaterialTheme.colorScheme.background.luminance() < 0.5f

/**
 * Liquid-glass card: translucent surface, gradient hairline edge and a soft top highlight.
 * No backdrop blur (expensive and unsupported below API 31) — the glass look comes from layered translucency.
 */
@Composable
fun GlassCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, accent: Boolean = false, overMap: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val g = LocalGraphics.current
    val dark = isDarkSurface()
    // Over busy map tiles, glass must stay legible: a near-opaque surface tint instead of a faint wash.
    val base = when { overMap -> MaterialTheme.colorScheme.surface.copy(alpha = 0.94f); dark -> Color.White.copy(alpha = 0.06f); else -> Color.White.copy(alpha = 0.78f) }
    val edge = BorderStroke(1.dp, Brush.verticalGradient(listOf(
        (if (dark) Color.White else Brand.Emerald).copy(alpha = if (dark) 0.22f else 0.20f),
        Color.Transparent, (if (dark) Brand.NeonMint else Brand.Emerald).copy(alpha = if (accent) 0.45f else 0.10f))))
    val shape = MaterialTheme.shapes.large
    val colors = CardDefaults.cardColors(containerColor = base)
    val inner: @Composable ColumnScope.() -> Unit = {
        Column(Modifier.fillMaxWidth().drawBehind {
            if (g.highlights) drawRect(Brush.verticalGradient(listOf(Color.White.copy(alpha = if (dark) 0.07f else 0.35f), Color.Transparent), endY = size.height * 0.45f))
            if (accent && g.glow) drawCircle(Brush.radialGradient(listOf(Brand.NeonMint.copy(alpha = if (dark) 0.18f else 0.12f), Color.Transparent),
                Offset(size.width, 0f), size.width * 0.7f), size.width * 0.7f, Offset(size.width, 0f))
        }.padding(18.dp), content = content)
    }
    if (onClick != null) Card(onClick = onClick, modifier = modifier.fillMaxWidth(), shape = shape, colors = colors, border = edge, content = inner)
    else Card(modifier = modifier.fillMaxWidth(), shape = shape, colors = colors, border = edge, content = inner)
}

/** Emerald ambient lighting behind a screen (static gradient; drawn once, no animation). */
@Composable
fun Modifier.ambient(): Modifier {
    val g = LocalGraphics.current
    val dark = isDarkSurface()
    if (!g.glow) return this
    return this.drawBehind {
        drawCircle(Brush.radialGradient(listOf((if (dark) Brand.EmeraldBrand else Brand.NeonMint).copy(alpha = if (dark) 0.22f else 0.25f), Color.Transparent),
            Offset(size.width * 0.9f, 0f), size.width * 0.9f), size.width * 0.9f, Offset(size.width * 0.9f, 0f))
    }
}

/** Section header with an optional trailing action, consistent spacing across screens. */
@Composable
fun SectionHeader(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) TextButton(onClick = onAction) { Text(action) }
    }
}
