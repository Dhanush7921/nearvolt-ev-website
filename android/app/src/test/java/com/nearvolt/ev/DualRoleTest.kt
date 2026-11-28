package com.nearvolt.ev

import com.nearvolt.ev.data.api.*
import com.nearvolt.ev.ui.AppState
import com.nearvolt.ev.volt.VoltEngine
import com.nearvolt.ev.ui.screens.HOST_SUGGESTIONS
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** V1.4 dual role: mode derivation, backward compatibility with pre-V1.4 servers, request body compatibility, VOLT host context. */
class DualRoleTest {
    private fun me(role: String?, caps: UserModes? = null) = Me(uid = "u", name = "N", role = role, capabilities = caps)

    @Test fun legacyServerDerivesModesFromRole() {
        val m = NvJson.decodeFromString<Me>("""{"uid":"u","name":"N","role":"host"}""")
        assertTrue(m.canHost); assertFalse(m.canDrive)
        assertTrue(me("customer").canDrive); assertFalse(me("customer").canHost)
        assertFalse(me(null).canDrive || me(null).canHost)
    }
    @Test fun capabilitiesOverrideLegacyRole() {
        val m = NvJson.decodeFromString<Me>("""{"uid":"u","role":"customer","capabilities":{"driver":true,"host":true}}""")
        assertTrue(m.canDrive && m.canHost)
    }
    @Test fun effectiveModeNeverExceedsServerCapabilities() {
        // Stored "host" preference is ignored when the account has no host capability (e.g. stale pref from another account).
        assertFalse(AppState(me = me("customer"), uiMode = "host").hostMode)
        assertTrue(AppState(me = me("customer", UserModes(true, true)), uiMode = "host").hostMode)
        assertFalse(AppState(me = me("host", UserModes(true, true)), uiMode = "driver").hostMode)
        assertTrue(AppState(me = me("host"), uiMode = null).hostMode)                 // legacy host keeps host shell
        assertFalse(AppState(me = me("customer"), uiMode = null).hostMode)
        assertTrue(AppState(me = me("host"), uiMode = "driver").hostMode)              // can't enter driver mode without capability
    }
    @Test fun dualRoleSwitchOnlyWithServerSupport() {
        assertFalse(AppState(config = NvJson.decodeFromString("""{"capabilities":{"apiLevel":2}}""")).dualRoleServer)
        assertTrue(AppState(config = NvJson.decodeFromString("""{"capabilities":{"apiLevel":3,"dualRole":true,"socketGate":true}}""")).dualRoleServer)
    }
    @Test fun socketConfirmationOmittedUnlessSet() {
        val base = CreateRequestBody("h", "car", "TYPE2_AC", LatLng(17.7, 83.3), true, null, null)
        assertFalse(NvJson.encodeToString(base).contains("socketConfirmation"))   // old strict servers keep accepting
        assertTrue(NvJson.encodeToString(base.copy(socketConfirmation = true)).contains("\"socketConfirmation\":true"))
    }
    @Test fun voltHostSuggestionsHitReviewedSafetyRecords() {
        val e = VoltEngine.fromJson(File("src/main/assets/volt/knowledge.json").readText())
        val expected = listOf("dedicated", "rcd", "extension", "home-safety", "host-registration", "session-pin")
        HOST_SUGGESTIONS.zip(expected).forEach { (q, id) -> assertEquals(q, listOf(id), e.respond(q).knowledgeIds) }
        assertTrue(e.respond("Session PIN verification").text.contains("4-digit"))
    }
}
