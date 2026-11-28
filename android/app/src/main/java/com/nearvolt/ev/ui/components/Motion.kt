package com.nearvolt.ev.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Sos
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import com.nearvolt.ev.R
import com.nearvolt.ev.ui.theme.Brand
import kotlinx.coroutines.launch

/**
 * Motion system. Every effect here is GPU-cheap (graphicsLayer / single draw pass), runs only while visible,
 * and collapses to a static frame when the user has turned animations off (Settings → Accessibility → Remove animations).
 */
object NvMotion {
    val spring = spring<Float>(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow)
}

/** Spring scale-down on press; pairs with a light haptic on click. */
@Composable
fun rememberPressScale(source: MutableInteractionSource): Float {
    val pressed by source.collectIsPressedAsState()
    val reduced = rememberReducedMotion()
    val s by animateFloatAsState(if (pressed && !reduced) 0.96f else 1f, NvMotion.spring, label = "press")
    return s
}

@Composable
fun hapticClick(onClick: () -> Unit): () -> Unit {
    val h = LocalHapticFeedback.current
    return { h.performHapticFeedback(HapticFeedbackType.TextHandleMove); onClick() }
}

/** Indeterminate "energy flow" bar: a mint highlight sweeping along an emerald track. Static gradient when motion is reduced. */
@Composable
fun EnergyFlowBar(modifier: Modifier = Modifier, height: androidx.compose.ui.unit.Dp = 8.dp) {
    val reduced = rememberReducedMotion()
    val track = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)
    val core = MaterialTheme.colorScheme.primary
    val phase = if (reduced) 0.5f else rememberInfiniteTransition(label = "flow").animateFloat(0f, 1f, infiniteRepeatable(tween(1600, easing = LinearEasing)), label = "p").value
    Box(modifier.height(height).clip(RoundedCornerShape(50)).background(track).drawBehind {
        val w = size.width; val x = -w * 0.4f + phase * w * 1.4f
        drawRect(Brush.horizontalGradient(listOf(Color.Transparent, core, Brand.NeonMint, core, Color.Transparent), startX = x, endX = x + w * 0.4f))
    }.clearAndSetSemantics { })
}

/** Shimmering placeholder block for skeleton screens. */
@Composable
fun Shimmer(modifier: Modifier) {
    val reduced = rememberReducedMotion()
    val base = MaterialTheme.colorScheme.surfaceVariant
    val hi = MaterialTheme.colorScheme.surface
    val p = if (reduced) 0f else rememberInfiniteTransition(label = "sh").animateFloat(0f, 1f, infiniteRepeatable(tween(1200, easing = LinearEasing)), label = "s").value
    Box(modifier.clip(RoundedCornerShape(10.dp)).drawBehind {
        drawRect(base)
        if (!reduced) { val x = -size.width + p * size.width * 2; drawRect(Brush.horizontalGradient(listOf(base, hi.copy(alpha = 0.6f), base), startX = x, endX = x + size.width)) }
    })
}

@Composable
fun SkeletonList(count: Int = 3, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().clearAndSetSemantics { }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(count) {
            Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row { Shimmer(Modifier.weight(1f).height(18.dp)); Spacer(Modifier.width(40.dp)); Shimmer(Modifier.width(72.dp).height(18.dp)) }
                    Shimmer(Modifier.fillMaxWidth(0.7f).height(14.dp))
                    Shimmer(Modifier.fillMaxWidth(0.4f).height(12.dp))
                }
            }
        }
    }
}

/** Original NEARVOLT logo reveal: mark scales in on a spring, an energy ring draws around it, then a soft glow settles. */
@Composable
fun LogoReveal(modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 120.dp, loop: Boolean = false) {
    val reduced = rememberReducedMotion()
    val scale = remember { Animatable(if (reduced) 1f else 0.6f) }
    val ring = remember { Animatable(if (reduced) 1f else 0f) }
    val glow = remember { Animatable(if (reduced) 0.6f else 0f) }
    LaunchedEffect(reduced) {
        if (reduced) return@LaunchedEffect
        kotlinx.coroutines.coroutineScope {
            launch { scale.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessLow)) }
            launch { ring.animateTo(1f, tween(900, delayMillis = 150, easing = FastOutSlowInEasing)) }
            launch { glow.animateTo(1f, tween(500, delayMillis = 700)); glow.animateTo(0.6f, tween(700)) }
        }
        if (loop) while (true) { glow.animateTo(1f, tween(900)); glow.animateTo(0.5f, tween(900)) }
    }
    val primary = MaterialTheme.colorScheme.primary
    Box(modifier.size(size * 1.6f), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val r = this.size.minDimension / 2
            drawCircle(Brush.radialGradient(listOf(Brand.NeonMint.copy(alpha = 0.35f * glow.value), Color.Transparent), center, r), r)
            drawArc(Brush.sweepGradient(listOf(primary, Brand.NeonMint, primary)), -90f, 360f * ring.value, false,
                topLeft = Offset(center.x - r * 0.72f, center.y - r * 0.72f), size = androidx.compose.ui.geometry.Size(r * 1.44f, r * 1.44f), style = Stroke(width = 3.dp.toPx()))
        }
        Image(painterResource(R.drawable.ic_brand_mark), contentDescription = "NEARVOLT EV", modifier = Modifier.size(size).graphicsLayer { scaleX = scale.value; scaleY = scale.value })
    }
}

/** One-tap emergency entry point. Pulses gently (unless motion is reduced) and never blocks the rest of the screen. */
@Composable
fun EmergencyButton(label: String, enabled: Boolean, loading: Boolean, onClick: () -> Unit) {
    val reduced = rememberReducedMotion()
    val pulse = if (reduced || !enabled || !LocalGraphics.current.decorativeMotion) 0f else rememberInfiniteTransition(label = "sos").animateFloat(0f, 1f, infiniteRepeatable(tween(1800), RepeatMode.Reverse), label = "p").value
    val src = remember { MutableInteractionSource() }
    val red = Color(0xFFB91C1C); val redDeep = Color(0xFF7F1D1D)
    Button(onClick = hapticClick(onClick), enabled = enabled && !loading, interactionSource = src,
        modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp).scale(rememberPressScale(src)).drawBehind {
            drawRoundRect(red.copy(alpha = 0.25f * pulse), cornerRadius = androidx.compose.ui.geometry.CornerRadius(22.dp.toPx()),
                topLeft = Offset(-6.dp.toPx() * pulse, -6.dp.toPx() * pulse), size = androidx.compose.ui.geometry.Size(size.width + 12.dp.toPx() * pulse, size.height + 12.dp.toPx() * pulse))
        },
        shape = RoundedCornerShape(18.dp), contentPadding = PaddingValues(0.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Row(Modifier.fillMaxSize().heightIn(min = 60.dp).then(if (enabled) Modifier.background(Brush.horizontalGradient(listOf(red, redDeep))) else Modifier).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(34.dp).background(Color.White.copy(alpha = 0.18f), CircleShape), contentAlignment = Alignment.Center) {
                if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White) else Icon(Icons.Outlined.Sos, null, tint = Color.White)
            }
            Spacer(Modifier.width(12.dp))
            Text(label, style = MaterialTheme.typography.titleMedium, color = if (enabled) Color.White else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}


/** Premium gradient hero used at the top of the driver and host dashboards. */
@Composable
fun HeroHeader(title: String, subtitle: String, live: Boolean? = null, liveLabel: String? = null) {
    val reduced = rememberReducedMotion()
    val pulse = if (reduced || live != true || !LocalGraphics.current.decorativeMotion) 1f else rememberInfiniteTransition(label = "live").animateFloat(0.4f, 1f, infiniteRepeatable(tween(1100), RepeatMode.Reverse), label = "l").value
    Box(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.large).background(Brand.heroGradient).drawBehind {
        drawCircle(Brand.energyGlow, radius = size.width * 0.55f, center = Offset(size.width * 0.95f, 0f))
    }.padding(22.dp)) {
        Column {
            if (live != null && liveLabel != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(9.dp).graphicsLayer { alpha = pulse }.background(if (live) Brand.NeonMint else Brand.Sage, CircleShape))
                    Spacer(Modifier.width(8.dp))
                    Text(liveLabel, style = MaterialTheme.typography.labelMedium, color = Brand.Mint)
                }
                Spacer(Modifier.height(10.dp))
            }
            Text(title, style = MaterialTheme.typography.headlineMedium, color = Color.White)
            Spacer(Modifier.height(4.dp))
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Brand.Mint.copy(alpha = 0.85f))
        }
    }
}
