package com.nearvolt.ev.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.nearvolt.ev.R

object Brand {
    val Forest = Color(0xFF051F20); val Pine = Color(0xFF0B2B26); val Spruce = Color(0xFF163832)
    val Moss = Color(0xFF235347); val Sage = Color(0xFF8EB69B); val Mint = Color(0xFFDAF1DE)
    val Danger = Color(0xFFB3261E); val Warning = Color(0xFF8A5A00)
    val heroGradient = Brush.linearGradient(listOf(Moss, Pine, Forest))
}

@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun variable(res: Int, w: Int) = Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))

private val Display = FontFamily(variable(R.font.unbounded_var, 500), variable(R.font.unbounded_var, 600), variable(R.font.unbounded_var, 700))
private val Body = FontFamily(variable(R.font.instrument_sans_var, 400), variable(R.font.instrument_sans_var, 500), variable(R.font.instrument_sans_var, 600))

private val type = Typography(
    displaySmall = TextStyle(fontFamily = Display, fontWeight = FontWeight(600), fontSize = 30.sp, lineHeight = 36.sp, letterSpacing = (-0.5).sp),
    headlineMedium = TextStyle(fontFamily = Display, fontWeight = FontWeight(600), fontSize = 24.sp, lineHeight = 30.sp),
    headlineSmall = TextStyle(fontFamily = Display, fontWeight = FontWeight(500), fontSize = 20.sp, lineHeight = 26.sp),
    titleLarge = TextStyle(fontFamily = Display, fontWeight = FontWeight(500), fontSize = 18.sp, lineHeight = 24.sp),
    titleMedium = TextStyle(fontFamily = Body, fontWeight = FontWeight(600), fontSize = 16.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontFamily = Body, fontWeight = FontWeight(600), fontSize = 14.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontFamily = Body, fontWeight = FontWeight(400), fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = Body, fontWeight = FontWeight(400), fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = Body, fontWeight = FontWeight(400), fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontFamily = Body, fontWeight = FontWeight(600), fontSize = 15.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = Body, fontWeight = FontWeight(500), fontSize = 12.sp, lineHeight = 16.sp),
)

private val light = lightColorScheme(
    primary = Brand.Moss, onPrimary = Color.White, primaryContainer = Brand.Mint, onPrimaryContainer = Brand.Forest,
    secondary = Color(0xFF3E6B5A), onSecondary = Color.White, secondaryContainer = Color(0xFFE3F1E6), onSecondaryContainer = Brand.Pine,
    background = Color(0xFFFBFDFB), onBackground = Brand.Forest, surface = Color.White, onSurface = Brand.Forest,
    surfaceVariant = Color(0xFFF1F8F2), onSurfaceVariant = Color(0xFF3C5A52), surfaceContainer = Color(0xFFF4FAF5),
    surfaceContainerHigh = Color(0xFFEAF4EC), outline = Color(0xFF6B857D), outlineVariant = Color(0xFFD3E2D7),
    error = Brand.Danger, onError = Color.White, errorContainer = Color(0xFFFCE4E2), onErrorContainer = Color(0xFF5F1410),
)
private val dark = darkColorScheme(
    primary = Brand.Sage, onPrimary = Brand.Forest, primaryContainer = Brand.Moss, onPrimaryContainer = Brand.Mint,
    secondary = Color(0xFFA9CDB5), onSecondary = Brand.Forest, secondaryContainer = Brand.Spruce, onSecondaryContainer = Brand.Mint,
    background = Color(0xFF04191A), onBackground = Brand.Mint, surface = Color(0xFF0A2522), onSurface = Brand.Mint,
    surfaceVariant = Color(0xFF0D302A), onSurfaceVariant = Color(0xFFB4D0BF), surfaceContainer = Color(0xFF0D2C28),
    surfaceContainerHigh = Color(0xFF123832), outline = Color(0xFF7FA08F), outlineVariant = Color(0xFF24463E),
    error = Color(0xFFF2B8B5), onError = Color(0xFF601410), errorContainer = Color(0xFF8C1D18), onErrorContainer = Color(0xFFF9DEDC),
)

@Composable
fun NearVoltTheme(mode: String = "system", content: @Composable () -> Unit) {
    val darkMode = when (mode) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    MaterialTheme(colorScheme = if (darkMode) dark else light, typography = type,
        shapes = Shapes(small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(24.dp)), content = content)
}
