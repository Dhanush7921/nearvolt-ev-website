package com.nearvolt.ev

import com.nearvolt.ev.data.api.*
import com.nearvolt.ev.ui.components.PhoneRules
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import org.junit.Assert.*
import org.junit.Test

/** V1.1 app ↔ V1.0 backend compatibility: the V1.0 server validates bodies with strict schemas (unknown keys = 400). */
class CompatibilityTest {
    @Test fun createBodyOmitsBatteryWhenNotAdvertised() {
        val json = NvJson.encodeToString(CreateRequestBody("h1", "car", "TYPE2_AC", LatLng(17.7, 83.3), true, null, null))
        assertFalse(json.contains("batteryPercent")); assertFalse(json.contains("note"))
    }
    @Test fun transitionBodyOmitsPinWhenNull() {
        val json = NvJson.encodeToString(TransitionBody("start"))
        assertEquals("""{"action":"start"}""", json)
    }
    @Test fun v10ConfigHasNoCapabilities() {
        val cfg = NvJson.decodeFromString<PublicConfig>("""{"maintenance":{"enabled":false},"minSupportedVersionCode":1,"latestVersionCode":1,"featureFlags":{}}""")
        assertFalse(cfg.capabilities.sessionPin); assertFalse(cfg.capabilities.batteryPercent); assertEquals(1, cfg.capabilities.apiLevel)
    }
    @Test fun v10RequestHasNoPinState() {
        val r = NvJson.decodeFromString<ChargeRequest>("""{"id":"r1","status":"ARRIVED","role":"host","hostId":"h1"}""")
        assertNull(r.pinStatus); assertNull(r.pin)
    }
    @Test fun phoneRules() {
        assertTrue(PhoneRules.validIndian("9876543210")); assertFalse(PhoneRules.validIndian("5876543210")); assertFalse(PhoneRules.validIndian("98765"))
        assertEquals("9876543210", PhoneRules.digits("+91 98765 43210"))
        assertEquals("+91 ••••• •3210", PhoneRules.mask("+919876543210")); assertNull(PhoneRules.mask(null))
    }
}
