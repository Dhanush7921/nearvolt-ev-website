package com.nearvolt.ev

import com.nearvolt.ev.data.api.ApiResult
import com.nearvolt.ev.data.api.ApiService
import com.nearvolt.ev.data.api.CreateRequestBody
import com.nearvolt.ev.data.api.LatLng
import com.nearvolt.ev.data.api.NvJson
import com.nearvolt.ev.data.api.call
import com.nearvolt.ev.location.LocationHelper
import com.nearvolt.ev.util.Labels
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class CoreTest {
    private lateinit var server: MockWebServer
    private lateinit var api: ApiService

    @Before fun setUp() {
        server = MockWebServer(); server.start()
        api = Retrofit.Builder().baseUrl(server.url("/")).client(OkHttpClient())
            .addConverterFactory(NvJson.asConverterFactory("application/json".toMediaType())).build().create(ApiService::class.java)
    }
    @After fun tearDown() = server.close()

    @Test fun parsesCoordinatesAndMapsLinks() {
        assertEquals(LatLng(17.7231, 83.3013), LocationHelper.parseCoordinates("17.7231, 83.3013"))
        assertEquals(LatLng(17.72, 83.301), LocationHelper.parseCoordinates("https://www.google.com/maps/place/x/@17.72,83.301,15z"))
        assertNull(LocationHelper.parseCoordinates("MVP Colony"))
        assertNull(LocationHelper.parseCoordinates("95.1234, 83.3013"))
    }

    @Test fun labels() {
        assertEquals("1.2 km", Labels.km(1.23)); assertEquals("7 kW", Labels.kw(7.0)); assertEquals("3.3 kW", Labels.kw(3.3))
        assertEquals("Type 2 (AC)", Labels.connector("TYPE2_AC"))
    }

    @Test fun okEnvelopeIsUnwrapped() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"ok":true,"data":{"uid":"u1","name":"Ravi","role":"customer","unknownField":1}}""").build())
        val r = call { api.me() }
        assertTrue(r is ApiResult.Ok); assertEquals("Ravi", (r as ApiResult.Ok).value.name)
    }

    @Test fun serverErrorCodeIsPreserved() = runTest {
        server.enqueue(MockResponse.Builder().code(409).body("""{"ok":false,"error":{"code":"ACTIVE_REQUEST_EXISTS","message":"You already have an active charging request."}}""").build())
        val r = call { api.createRequest("key-123456789012345", CreateRequestBody("h", "car", "TYPE2_AC", LatLng(17.7, 83.3))) }
        assertTrue(r is ApiResult.Err); r as ApiResult.Err
        assertEquals("ACTIVE_REQUEST_EXISTS", r.code); assertEquals(409, r.http)
        val sent = server.takeRequest()
        assertEquals("key-123456789012345", sent.headers["Idempotency-Key"])
        assertTrue(sent.body!!.utf8().contains("\"compatibilityConfirmed\":true"))
    }

    @Test fun retriesTransient5xxThenSucceeds() = runTest {
        server.enqueue(MockResponse.Builder().code(502).body("{}").build())
        server.enqueue(MockResponse.Builder().code(200).body("""{"ok":true,"data":{"minSupportedVersionCode":1}}""").build())
        val r = call(retries = 2) { api.config() }
        assertTrue(r is ApiResult.Ok); assertEquals(2, server.requestCount)
    }

    @Test fun maintenance503IsNotRetried() = runTest {
        server.enqueue(MockResponse.Builder().code(503).body("""{"ok":false,"error":{"code":"MAINTENANCE","message":"Down"}}""").build())
        val r = call(retries = 2) { api.config() }
        assertEquals("MAINTENANCE", (r as ApiResult.Err).code); assertEquals(1, server.requestCount)
    }
}
