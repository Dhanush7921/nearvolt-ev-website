package com.nearvolt.ev

import com.nearvolt.ev.catalogue.*
import com.nearvolt.ev.catalogue.CompatibilityEngine.Level
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class CatalogueTest {
    private val cat = CatalogueRepo.parse(File("src/main/assets/catalogue/vehicles.json").readText())
    private fun v(id: String) = cat.vehicles.first { it.id == id }

    @Test fun countsAndIntegrity() {
        assertEquals(62, cat.vehicles.size); assertEquals(19, cat.supplementaryClaims.size)
        assertEquals(62, cat.vehicles.map { it.id }.toSet().size)
        assertTrue(cat.vehicles.all { it.sourceUrl?.startsWith("http") == true })
        // Unverified is null, never zero.
        assertTrue(cat.vehicles.none { it.batteryKwh == 0.0 || it.acMaxKw == 0.0 || it.dcMaxKw == 0.0 })
        // Only verified, supported inlets map to app connector codes.
        assertTrue(cat.vehicles.all { (it.acConnector == null || it.acSupported == true) && (it.dcConnector == null || it.dcSupported == true) })
        assertTrue(cat.vehicles.flatMap { it.verifiedConnectors }.all { it in setOf("TYPE2_AC", "CCS2") })
    }
    @Test fun knownRecords() {
        val punch = v("IN-EV-026"); assertEquals(30.0, punch.batteryKwh!!, 0.0); assertEquals(7.2, punch.acMaxKw!!, 0.0); assertEquals(65.0, punch.dcMaxKw!!, 0.0)
        val reva = v("IN-EV-001"); assertNull(reva.acConnector); assertNull(reva.dcConnector); assertEquals(6.0, reva.ac0to100h!!, 0.0)
        assertNull(v("IN-EV-031").acMaxKw)   // Harrier.ev: AC limit not publicly verified
    }
    @Test fun search() {
        assertTrue(CatalogueSearch.apply(cat.vehicles, CatalogueFilter(query = "nexon")).all { it.model.contains("Nexon", true) })
        assertTrue(CatalogueSearch.apply(cat.vehicles, CatalogueFilter(dcOnly = true)).all { it.dcSupported == true })
        val byRange = CatalogueSearch.apply(cat.vehicles, CatalogueFilter(sort = CatalogueFilter.Sort.RANGE))
        assertNull(byRange.last().rangeKm)   // unknowns sort last, never treated as 0 km
    }
    @Test fun compatTypeTwoHost() {
        val r = CompatibilityEngine.screen(v("IN-EV-026"), listOf("TYPE2_AC"), 11.0)
        assertEquals(Level.SCREENED_MATCH, r.level); assertEquals(7.2, r.effectiveAcKw!!, 0.0)   // limited by vehicle, not station
        assertTrue(r.reasons.any { it.contains("not a guarantee") })
    }
    @Test fun compatUnverifiedLimitIsNotAMatch() {
        val r = CompatibilityEngine.screen(v("IN-EV-031"), listOf("TYPE2_AC"), 7.2)
        assertEquals(Level.UNVERIFIED, r.level); assertNull(r.effectiveAcKw); assertFalse(r.blocksRequest)
    }
    @Test fun compatLegacyCarIsUnverifiedNotCompatible() {
        assertEquals(Level.UNVERIFIED, CompatibilityEngine.screen(v("IN-EV-001"), listOf("TYPE2_AC"), 7.2).level)
    }
    @Test fun compatDomesticSocketNeverIncompatible() {
        val r = CompatibilityEngine.screen(v("IN-EV-026"), listOf("DOMESTIC_15A"), 3.3); assertEquals(Level.UNVERIFIED, r.level); assertFalse(r.blocksRequest)
    }
    @Test fun compatMismatchIsIncompatible() {
        val r = CompatibilityEngine.screen(v("IN-EV-026"), listOf("CHADEMO"), 50.0); assertEquals(Level.INCOMPATIBLE, r.level); assertTrue(r.blocksRequest)
    }
    @Test fun chargeTime() {
        val e = ChargeTime.acEstimate(v("IN-EV-026"), 20.0, 80.0, 11.0)!!
        assertEquals(18.0, e.energyKwh, 1e-9); assertEquals(7.2, e.powerKw, 0.0); assertEquals(18.0 / (7.2 * 0.9), e.hours, 1e-9)
        assertNull(ChargeTime.acEstimate(v("IN-EV-026"), 80.0, 20.0, 7.2)); assertNull(ChargeTime.acEstimate(v("IN-EV-026"), 20.0, 80.0, 0.0))
        // No DC estimate exists at all — only claims with their SOC window.
        assertTrue(ChargeTime.claims(v("IN-EV-026")).all { it.window.isNotBlank() })
        assertEquals("2 h 30 min", ChargeTime.hours(2.5)); assertEquals("45 min", ChargeTime.hours(0.75))
    }

    // ---------- V1.3 request gate ----------
    private fun gate(type: String? = "car", conn: String? = "TYPE2_AC", hc: List<String> = listOf("TYPE2_AC"), ht: List<String> = listOf("car"), kw: Double = 7.2,
                     phase: String = "single", dedicated: Boolean? = null, amps: Double? = null, scr: CompatibilityEngine.Result? = null) =
        RequestGate.evaluate(type, conn, hc, ht, kw, phase, dedicated, amps, scr)

    @Test fun gateBasics() {
        assertEquals(RequestGate.Allowed, gate())
        assertEquals(RequestGate.Reason.PROFILE_UNKNOWN, (gate(conn = null) as RequestGate.Blocked).reason)
        assertEquals(RequestGate.Reason.PROFILE_UNKNOWN, (gate(type = null) as RequestGate.Blocked).reason)
        assertEquals(RequestGate.Reason.CONNECTOR_OR_TYPE_MISMATCH, (gate(hc = listOf("CCS2")) as RequestGate.Blocked).reason)
        assertEquals(RequestGate.Reason.CONNECTOR_OR_TYPE_MISMATCH, (gate(ht = listOf("two_wheeler")) as RequestGate.Blocked).reason)
    }
    @Test fun gateUnknownHostElectricsBlock() {
        assertEquals(RequestGate.Reason.HOST_SPEC_UNKNOWN, (gate(kw = 0.0) as RequestGate.Blocked).reason)
        assertEquals(RequestGate.Reason.HOST_SPEC_UNKNOWN, (gate(phase = "") as RequestGate.Blocked).reason)
        assertEquals(RequestGate.Reason.HOST_SPEC_UNKNOWN, (gate(kw = Double.NaN) as RequestGate.Blocked).reason)
    }
    @Test fun wallSocketNeverAutomaticallyCompatible() {
        for (sock in listOf("DOMESTIC_15A", "INDUSTRIAL_16A")) {
            // Current backend sends no dedicated-circuit info -> blocked.
            assertEquals(RequestGate.Reason.SOCKET_CIRCUIT_UNCONFIRMED, (gate(conn = sock, hc = listOf(sock), kw = 3.0) as RequestGate.Blocked).reason)
            assertEquals(RequestGate.Reason.SOCKET_CIRCUIT_UNCONFIRMED, (gate(conn = sock, hc = listOf(sock), kw = 3.0, dedicated = false) as RequestGate.Blocked).reason)
            // Declared power above the socket rating -> blocked.
            assertEquals(RequestGate.Reason.SOCKET_OVER_RATING, (gate(conn = sock, hc = listOf(sock), kw = 7.2, dedicated = true) as RequestGate.Blocked).reason)
            assertEquals(RequestGate.Reason.SOCKET_OVER_RATING, (gate(conn = sock, hc = listOf(sock), kw = 3.0, dedicated = true, amps = 32.0) as RequestGate.Blocked).reason)
            // Even with everything declared, never Allowed outright: explicit user confirmation required.
            assertTrue(gate(conn = sock, hc = listOf(sock), kw = 3.0, dedicated = true, amps = 13.0) is RequestGate.NeedsConfirmation)
        }
        // Catalogue screening of a socket host is never a match.
        assertNotEquals(Level.SCREENED_MATCH, CompatibilityEngine.screen(v("IN-EV-026"), listOf("DOMESTIC_15A"), 3.0).level)
    }
    @Test fun gateUsesScreening() {
        val inc = CompatibilityEngine.screen(v("IN-EV-026"), listOf("CHADEMO"), 50.0)
        assertEquals(RequestGate.Reason.VEHICLE_INCOMPATIBLE, (gate(conn = "CHADEMO", hc = listOf("CHADEMO"), kw = 50.0, scr = inc) as RequestGate.Blocked).reason)
        val legacy = CompatibilityEngine.screen(v("IN-EV-001"), listOf("TYPE2_AC"), 7.2)   // REVA: inlet not verified
        assertTrue(legacy.inletUnverified)
        assertEquals(RequestGate.Reason.VEHICLE_INLET_UNVERIFIED, (gate(scr = legacy) as RequestGate.Blocked).reason)
        // Verified Type 2 inlet with unpublished OBC limit: allowed (car limits its own AC draw); estimate shown as unverified.
        val harrier = CompatibilityEngine.screen(v("IN-EV-031"), listOf("TYPE2_AC"), 7.2)
        assertFalse(harrier.inletUnverified); assertEquals(RequestGate.Allowed, gate(scr = harrier))
    }
    // ---------- provenance: every record traces to the source database unchanged ----------
    @Test fun provenancePreserved() {
        cat.vehicles.forEach { x ->
            assertTrue(x.id, x.id.matches(Regex("IN-EV-\\d{3}")))
            assertNotNull(x.id, x.checkedAt); assertNotNull(x.id, x.sourceUrl); assertNotNull(x.id, x.status)
        }
        // Exact variants kept (e.g. two XUV400 EC packs differ only by on-board charger)
        assertEquals("EC 34.5 kWh / 3.3kW supply", v("IN-EV-036").variant); assertEquals("EC 34.5 kWh / 7.2kW AC option", v("IN-EV-037").variant)
    }
}
