package com.nearvolt.ev.ui

import android.app.Application
import android.provider.Settings
import androidx.compose.material3.Text
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.ui.screens.BatteryMeter
import com.nearvolt.ev.ui.screens.OnboardingProgress
import com.nearvolt.ev.ui.theme.NearVoltTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Plain Application so the real NearVoltApp (Firebase init) is not started in JVM tests. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class UiComponentsTest {
    @get:Rule val rule = createComposeRule()

    @Test fun lightAndDarkThemesRenderComponents() {
        for (mode in listOf("light", "dark")) {
            rule.setContent { NearVoltTheme(mode) { GlassCard { Text("Glass $mode") } } }
            rule.onNodeWithText("Glass $mode").assertIsDisplayed()
        }
    }

    @Test fun batteryMeterShowsManualValueAndLabel() {
        rule.setContent { NearVoltTheme("dark") { BatteryMeter(43, System.currentTimeMillis()) } }
        rule.onNodeWithText("43%").assertIsDisplayed()
        rule.onNodeWithText("Entered manually", substring = true).assertIsDisplayed()
    }

    @Test fun batteryMeterWithoutValueAsksForInput() {
        rule.setContent { NearVoltTheme("light") { BatteryMeter(null, null) } }
        rule.onNodeWithText("Tap to enter your battery percentage").assertIsDisplayed()
    }

    @Test fun reducedMotionIsDetectedFromSystemSetting() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        Settings.Global.putFloat(app.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        var reduced = false
        rule.setContent { reduced = rememberReducedMotion() }
        rule.waitForIdle(); assertTrue(reduced)
        Settings.Global.putFloat(app.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    }

    @Test fun graphicsModesResolve() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        assertFalse(resolveGraphics("lite", app, false).glow)
        assertTrue(resolveGraphics("ultra", app, false).decorativeMotion)
        assertFalse(resolveGraphics("ultra", app, true).decorativeMotion)   // system reduced motion always wins
    }

    @Test fun onboardingProgressLabels() {
        rule.setContent { NearVoltTheme("light") { OnboardingProgress(2) } }
        rule.onNodeWithText("Consent").assertIsDisplayed(); rule.onNodeWithText("Profile").assertIsDisplayed()
    }

    @Test fun emergencyButtonIsImmediatelyClickable() {
        var clicks = 0
        rule.setContent { NearVoltTheme("dark") { EmergencyButton("Emergency charging", enabled = true, loading = false) { clicks++ } } }
        rule.onNodeWithText("Emergency charging").performClick()
        assertEquals(1, clicks)
    }
}
