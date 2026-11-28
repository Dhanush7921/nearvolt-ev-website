package com.nearvolt.ev.ui.components

import com.nearvolt.ev.ui.screens.voltAvoid

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
private const val LAYER_CLUSTER = "nv-host-cluster"
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
fun HostMap(hosts: List<HostSummary>, me: ApiLatLng?, selectedId: String?, dark: Boolean, onSelect: (HostSummary) -> Unit, modifier: Modifier = Modifier,
            fullScreen: Boolean = false, recenterKey: Int = 0, initialCenter: ApiLatLng? = null, onFailed: () -> Unit = {}) {
    val ctx = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val reduced = rememberReducedMotion()
    var failed by remember { mutableStateOf(false) }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var style by remember { mutableStateOf<Style?>(null) }
    val currentHosts by rememberUpdatedState(hosts)
    val currentOnSelect by rememberUpdatedState(onSelect)
    val currentOnFailed by rememberUpdatedState(onFailed)

    val mapView = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx, MapLibreMapOptions.createFromAttributes(ctx).textureMode(true).attributionEnabled(true).logoEnabled(true)).apply {
            onCreate(null)
            // Let the map take drag gestures instead of the scrolling list around it.
            setOnTouchListener { v, _ -> v.parent?.requestDisallowInterceptTouchEvent(true); false }
            addOnDidFailLoadingMapListener { failed = true; currentOnFailed() }
            getMapAsync { m ->
                m.uiSettings.isRotateGesturesEnabled = fullScreen; m.uiSettings.isTiltGesturesEnabled = false
                m.uiSettings.isCompassEnabled = fullScreen
                if (fullScreen) { val d = ctx.resources.displayMetrics.density; m.uiSettings.setCompassMargins(0, (12 * d).toInt(), (16 * d).toInt(), 0) }
                m.addOnMapClickListener { pt ->
                    val screen = m.projection.toScreenLocation(pt)
                    // Tapping a cluster zooms in to reveal its hosts.
                    m.queryRenderedFeatures(screen, LAYER_CLUSTER).firstOrNull()?.let {
                        val u = CameraUpdateFactory.newLatLngZoom(pt, m.cameraPosition.zoom + 2); if (reduced) m.moveCamera(u) else m.easeCamera(u, 350); return@addOnMapClickListener true }
                    val hit = m.queryRenderedFeatures(screen, LAYER_AREA, LAYER_DOT).firstOrNull()
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
        m.setStyle(Style.Builder().fromUri(if (dark) STYLE_DARK else STYLE_LIGHT)) { s -> addLayers(s, dark, fullScreen); style = s; failed = false }
    }
    // Data + camera.
    LaunchedEffect(style, hosts, me) {
        val m = map ?: return@LaunchedEffect; val s = style ?: return@LaunchedEffect
        val feats = hosts.mapNotNull { h -> h.approxArea?.let { a ->
            Feature.fromGeometry(Point.fromLngLat(a.lng, a.lat)).apply { addStringProperty("id", h.hostId); addBooleanProperty("bookable", h.bookableNow) } } }
        s.getSourceAs<GeoJsonSource>(SRC_HOSTS)?.setGeoJson(FeatureCollection.fromFeatures(feats))
        s.getSourceAs<GeoJsonSource>(SRC_ME)?.setGeoJson(FeatureCollection.fromFeatures(listOfNotNull(me?.let { Feature.fromGeometry(Point.fromLngLat(it.lng, it.lat)) })))
        if (fullScreen) return@LaunchedEffect // filter refreshes must not reset the user's camera
        val pts = feats.map { (it.geometry() as Point).let { p -> LatLng(p.latitude(), p.longitude()) } } + listOfNotNull(me?.let { LatLng(it.lat, it.lng) })
        val update = when {
            pts.size >= 2 -> CameraUpdateFactory.newLatLngBounds(LatLngBounds.Builder().includes(pts).build(), 72)
            pts.size == 1 -> CameraUpdateFactory.newLatLngZoom(pts[0], 13.5)
            else -> return@LaunchedEffect
        }
        if (reduced) m.moveCamera(update) else m.easeCamera(update, 700)
    }
    // Full-screen camera is centered only on initial style/location changes, not host/filter refreshes.
    LaunchedEffect(style, me, initialCenter, fullScreen) {
        if (!fullScreen || style == null) return@LaunchedEffect
        val p = me ?: initialCenter ?: return@LaunchedEffect
        map?.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(p.lat, p.lng), if (me == null) 10.5 else 13.5))
    }
    LaunchedEffect(recenterKey) {
        if (recenterKey == 0) return@LaunchedEffect
        val p = me ?: return@LaunchedEffect
        map?.let { m -> val u = CameraUpdateFactory.newLatLngZoom(LatLng(p.lat, p.lng), 13.5); if (reduced) m.moveCamera(u) else m.easeCamera(u, 500) }
    }
    LaunchedEffect(style, selectedId) {
        val sel = style?.getLayer(LAYER_SEL) as? CircleLayer
        sel?.setFilter(eq(get("id"), literal(selectedId ?: "")))
        // Marker selection pop: 11dp → 15dp → 11dp spring (skipped with reduced motion).
        if (sel != null && selectedId != null && !reduced) {
            val a = androidx.compose.animation.core.Animatable(11f)
            a.animateTo(15f, androidx.compose.animation.core.tween(140)) { sel.setProperties(circleRadius(value)) }
            a.animateTo(11f, androidx.compose.animation.core.spring(dampingRatio = 0.45f)) { sel.setProperties(circleRadius(value)) }
        }
        val h = hosts.firstOrNull { it.hostId == selectedId }?.approxArea ?: return@LaunchedEffect
        map?.let { m -> val u = CameraUpdateFactory.newLatLng(LatLng(h.lat, h.lng)); if (reduced) m.moveCamera(u) else m.animateCamera(u, 450) }
    }

    if (fullScreen) {
        Box(modifier) {
            AndroidView({ mapView }, Modifier.fillMaxSize())
            // Keep the VOLT orb clear of MapLibre's compass (top-end) and logo/attribution button (bottom-start).
            Box(Modifier.align(androidx.compose.ui.Alignment.TopEnd).size(72.dp).voltAvoid("map-compass"))
            Box(Modifier.align(androidx.compose.ui.Alignment.BottomStart).size(width = 120.dp, height = 40.dp).voltAvoid("map-attribution"))
            Text("© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors", style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(androidx.compose.ui.Alignment.BottomStart).padding(start = 92.dp, bottom = 6.dp))
        }
        return
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

private fun addLayers(s: Style, dark: Boolean, cluster: Boolean = false) {
    val emerald = if (dark) "#34D399" else "#059669"; val muted = if (dark) "#6B8A80" else "#8A9A93"; val mint = "#6BFFCB"
    s.addSource(if (cluster) GeoJsonSource(SRC_HOSTS, org.maplibre.android.style.sources.GeoJsonOptions().withCluster(true).withClusterRadius(48).withClusterMaxZoom(14))
        else GeoJsonSource(SRC_HOSTS))
    s.addSource(GeoJsonSource(SRC_ME))
    // 800 m expressed in pixels at Visakhapatnam's latitude (~17.7°N), scaled exponentially with zoom.
    val areaRadius = interpolate(exponential(2), zoom(), stop(10, 5.5f), stop(16, 352f))
    val colour = switchCase(get("bookable"), literal(emerald), literal(muted))
    val single = not(has("point_count"))
    s.addLayer(CircleLayer(LAYER_AREA, SRC_HOSTS).withProperties(circleRadius(areaRadius), circleColor(colour), circleOpacity(0.18f),
        circleStrokeColor(colour), circleStrokeWidth(1.5f), circleStrokeOpacity(0.6f)).withFilter(single))
    s.addLayer(CircleLayer(LAYER_DOT, SRC_HOSTS).withProperties(circleRadius(7f), circleColor(colour), circleStrokeColor("#FFFFFF"), circleStrokeWidth(2f)).withFilter(single))
    if (cluster) {
        s.addLayer(CircleLayer(LAYER_CLUSTER, SRC_HOSTS).withProperties(circleRadius(18f), circleColor(emerald), circleOpacity(0.9f),
            circleStrokeColor(mint), circleStrokeWidth(2f)).withFilter(has("point_count")))
        s.addLayer(org.maplibre.android.style.layers.SymbolLayer("$LAYER_CLUSTER-count", SRC_HOSTS).withProperties(
            textField(toString(get("point_count"))), textFont(arrayOf("Noto Sans Bold")), textSize(13f), textColor("#FFFFFF"), textAllowOverlap(true), textIgnorePlacement(true))
            .withFilter(has("point_count")))
    }
    s.addLayer(CircleLayer(LAYER_SEL, SRC_HOSTS).withProperties(circleRadius(11f), circleColor(mint), circleStrokeColor(emerald), circleStrokeWidth(3f))
        .withFilter(eq(get("id"), literal(""))))
    s.addLayer(CircleLayer(LAYER_ME, SRC_ME).withProperties(circleRadius(8f), circleColor("#2563EB"), circleStrokeColor("#FFFFFF"), circleStrokeWidth(3f)))
}

