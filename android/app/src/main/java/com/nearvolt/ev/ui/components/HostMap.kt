package com.nearvolt.ev.ui.components

import android.annotation.SuppressLint
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.nearvolt.ev.data.api.HostSummary
import com.nearvolt.ev.data.api.LatLng as ApiLatLng
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.*
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point

/** Free OpenFreeMap vector styles (no API key, no billing). */
private const val STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron"
private const val STYLE_DARK = "https://tiles.openfreemap.org/styles/fiord"
private const val SRC_HOSTS = "nv-hosts"; private const val SRC_ME = "nv-me"
private const val LAYER_AREA = "nv-host-area"; private const val LAYER_DOT = "nv-host-dot"; private const val LAYER_SEL = "nv-host-selected"; private const val LAYER_ME = "nv-me"

@Composable
fun rememberReducedMotion(): Boolean {
    val ctx = LocalContext.current
    return remember { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

/**
 * Discovery map. Hosts are drawn as approximate ~1 km areas (never exact addresses) and stay in sync with the list:
 * tapping an area selects that host; [selectedId] highlights it. Map failure never blocks the list below it.
 */
@SuppressLint("ClickableViewAccessibility")
@Composable
fun HostMap(hosts: List<HostSummary>, me: ApiLatLng?, selectedId: String?, dark: Boolean, onSelect: (HostSummary) -> Unit, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val reduced = rememberReducedMotion()
    var failed by remember { mutableStateOf(false) }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var style by remember { mutableStateOf<Style?>(null) }
    val currentHosts by rememberUpdatedState(hosts)
    val currentOnSelect by rememberUpdatedState(onSelect)

    val mapView = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx, MapLibreMapOptions.createFromAttributes(ctx).textureMode(true).attributionEnabled(true).logoEnabled(true)).apply {
            onCreate(null)
            // Let the map take drag gestures instead of the scrolling list around it.
            setOnTouchListener { v, _ -> v.parent?.requestDisallowInterceptTouchEvent(true); false }
            addOnDidFailLoadingMapListener { failed = true }
            getMapAsync { m ->
                m.uiSettings.isRotateGesturesEnabled = false; m.uiSettings.isTiltGesturesEnabled = false
                m.addOnMapClickListener { pt ->
                    val hit = m.queryRenderedFeatures(m.projection.toScreenLocation(pt), LAYER_AREA, LAYER_DOT).firstOrNull()
                    val id = hit?.getStringProperty("id")
                    currentHosts.firstOrNull { it.hostId == id }?.let { currentOnSelect(it); true } ?: false
                }
                map = m
            }
        }
    }
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> mapView.onStart(); Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause(); Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs); mapView.onPause(); mapView.onStop(); mapView.onDestroy() }
    }
    // Style follows the app theme.
    LaunchedEffect(map, dark) {
        val m = map ?: return@LaunchedEffect
        style = null
        m.setStyle(Style.Builder().fromUri(if (dark) STYLE_DARK else STYLE_LIGHT)) { s -> addLayers(s, dark); style = s; failed = false }
    }
    // Data + camera.
    LaunchedEffect(style, hosts, me) {
        val m = map ?: return@LaunchedEffect; val s = style ?: return@LaunchedEffect
        val feats = hosts.mapNotNull { h -> h.approxArea?.let { a ->
            Feature.fromGeometry(Point.fromLngLat(a.lng, a.lat)).apply { addStringProperty("id", h.hostId); addBooleanProperty("bookable", h.bookableNow) } } }
        s.getSourceAs<GeoJsonSource>(SRC_HOSTS)?.setGeoJson(FeatureCollection.fromFeatures(feats))
        s.getSourceAs<GeoJsonSource>(SRC_ME)?.setGeoJson(FeatureCollection.fromFeatures(listOfNotNull(me?.let { Feature.fromGeometry(Point.fromLngLat(it.lng, it.lat)) })))
        val pts = feats.map { (it.geometry() as Point).let { p -> LatLng(p.latitude(), p.longitude()) } } + listOfNotNull(me?.let { LatLng(it.lat, it.lng) })
        val update = when {
            pts.size >= 2 -> CameraUpdateFactory.newLatLngBounds(LatLngBounds.Builder().includes(pts).build(), 72)
            pts.size == 1 -> CameraUpdateFactory.newLatLngZoom(pts[0], 13.5)
            else -> return@LaunchedEffect
        }
        if (reduced) m.moveCamera(update) else m.easeCamera(update, 700)
    }
    LaunchedEffect(style, selectedId) {
        (style?.getLayer(LAYER_SEL) as? CircleLayer)?.setFilter(eq(get("id"), literal(selectedId ?: "")))
        val h = hosts.firstOrNull { it.hostId == selectedId }?.approxArea ?: return@LaunchedEffect
        map?.let { m -> val u = CameraUpdateFactory.newLatLng(LatLng(h.lat, h.lng)); if (reduced) m.moveCamera(u) else m.animateCamera(u, 450) }
    }

    Column(modifier) {
        Box(Modifier.fillMaxWidth().height(260.dp).clip(RoundedCornerShape(20.dp))) {
            AndroidView({ mapView }, Modifier.fillMaxSize())
            if (failed) Text("Map unavailable right now. The list below is up to date.", style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.align(androidx.compose.ui.Alignment.Center).padding(16.dp))
        }
        Spacer(Modifier.height(4.dp))
        Text("Shaded circles show each host's approximate area. Exact address is shared after the host accepts. © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors",
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun addLayers(s: Style, dark: Boolean) {
    val emerald = if (dark) "#34D399" else "#059669"; val muted = if (dark) "#6B8A80" else "#8A9A93"; val mint = "#7CFFC4"
    s.addSource(GeoJsonSource(SRC_HOSTS)); s.addSource(GeoJsonSource(SRC_ME))
    // 800 m expressed in pixels at Visakhapatnam's latitude (~17.7°N), scaled exponentially with zoom.
    val areaRadius = interpolate(exponential(2), zoom(), stop(10, 5.5f), stop(16, 352f))
    val colour = switchCase(get("bookable"), literal(emerald), literal(muted))
    s.addLayer(CircleLayer(LAYER_AREA, SRC_HOSTS).withProperties(circleRadius(areaRadius), circleColor(colour), circleOpacity(0.18f),
        circleStrokeColor(colour), circleStrokeWidth(1.5f), circleStrokeOpacity(0.6f)))
    s.addLayer(CircleLayer(LAYER_DOT, SRC_HOSTS).withProperties(circleRadius(7f), circleColor(colour), circleStrokeColor("#FFFFFF"), circleStrokeWidth(2f)))
    s.addLayer(CircleLayer(LAYER_SEL, SRC_HOSTS).withProperties(circleRadius(11f), circleColor(mint), circleStrokeColor(emerald), circleStrokeWidth(3f))
        .withFilter(eq(get("id"), literal(""))))
    s.addLayer(CircleLayer(LAYER_ME, SRC_ME).withProperties(circleRadius(8f), circleColor("#2563EB"), circleStrokeColor("#FFFFFF"), circleStrokeWidth(3f)))
}
