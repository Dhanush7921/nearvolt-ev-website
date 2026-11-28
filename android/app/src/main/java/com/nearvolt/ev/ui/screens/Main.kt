package com.nearvolt.ev.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.launch
import com.nearvolt.ev.R
import com.nearvolt.ev.ui.AppViewModel

/** composable() that also exposes its AnimatedVisibilityScope for shared-element transitions. */
private fun androidx.navigation.NavGraphBuilder.nvComposable(route: String, arguments: List<androidx.navigation.NamedNavArgument> = emptyList(),
    content: @Composable (androidx.navigation.NavBackStackEntry) -> Unit) =
    composable(route, arguments = arguments) { e -> CompositionLocalProvider(com.nearvolt.ev.ui.components.LocalNavAnimScope provides this) { content(e) } }

private data class Tab(val route: String, val label: Int, val icon: ImageVector)

/** Role-based shell: customers find charging; hosts manage their listing and incoming requests. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun MainScreen(vm: AppViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val isHost = state.me?.role == "host"
    val nav = rememberNavController()
    val tabs = if (isHost) listOf(Tab("dashboard", R.string.tab_dashboard, Icons.Outlined.SpaceDashboard), Tab("listing", R.string.tab_listing, Icons.Outlined.EvStation),
        Tab("alerts", R.string.tab_alerts, Icons.Outlined.Notifications), Tab("account", R.string.tab_account, Icons.Outlined.Person))
    // V1.2: Home | Map | Activity | Alerts | Account. The former "find" tab stays as a route (Home → Nearby, request alternatives).
    else listOf(Tab("home", R.string.tab_home, Icons.Outlined.Home), Tab("map", R.string.tab_map, Icons.Outlined.Map), Tab("activity", R.string.tab_activity, Icons.Outlined.History),
        Tab("alerts", R.string.tab_alerts, Icons.Outlined.Notifications), Tab("account", R.string.tab_account, Icons.Outlined.Person))
    var showIntro by remember { mutableStateOf(false) }
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination?.route?.substringBefore("?")

    LaunchedEffect(state.openRequestId) { state.openRequestId?.let { nav.navigate("request/$it"); vm.requestOpened() } }
    val uid = state.me?.uid
    val c = com.nearvolt.ev.NearVoltApp.instance.container
    val local by remember(uid) { if (uid != null) c.accountStore.data(uid) else kotlinx.coroutines.flow.flowOf(com.nearvolt.ev.data.prefs.LocalAccountData()) }
        .collectAsStateWithLifecycle(null)
    val scope = rememberCoroutineScope()
    val goTop: (String) -> Unit = { r -> nav.navigate(r) { launchSingleTop = true } }
    val tabTop: (String) -> Unit = { r -> nav.navigate(r) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true } }
    // VOLT actions only navigate (or open the dialler after a confirmation inside VOLT). Nothing books, pays or contacts a host.
    val onVolt: (com.nearvolt.ev.volt.VoltAction) -> Unit = { a -> when (a) {
        com.nearvolt.ev.volt.VoltAction.OPEN_MAP, com.nearvolt.ev.volt.VoltAction.FIND_COMPATIBLE_HOST -> if (isHost) goTop("find") else tabTop("map")
        com.nearvolt.ev.volt.VoltAction.OPEN_GARAGE, com.nearvolt.ev.volt.VoltAction.CALCULATE_CHARGING_TIME -> goTop("garage")
        com.nearvolt.ev.volt.VoltAction.OPEN_ACTIVITY -> if (isHost) goTop("hostHistory") else tabTop("activity")
        com.nearvolt.ev.volt.VoltAction.OPEN_SUPPORT -> goTop("support")
        com.nearvolt.ev.volt.VoltAction.OPEN_SAFETY -> goTop("safety")
        com.nearvolt.ev.volt.VoltAction.OPEN_EMERGENCY_DIALER -> goTop("contacts")
    } }

    Box(Modifier.fillMaxSize()) {
    Scaffold(bottomBar = {
        if (tabs.any { it.route == current }) NavigationBar {
            tabs.forEach { t ->
                NavigationBarItem(selected = current == t.route, onClick = {
                    nav.navigate(t.route) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true }
                }, icon = {
                    val sel = current == t.route
                    val s by animateFloatAsState(if (sel) 1.12f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "tab")
                    Icon(t.icon, null, Modifier.graphicsLayer { scaleX = s; scaleY = s })
                }, label = { Text(stringResource(t.label)) })
            }
        }
    }) { pad ->
        val reduced = com.nearvolt.ev.ui.components.rememberReducedMotion()
        SharedTransitionLayout { CompositionLocalProvider(com.nearvolt.ev.ui.components.LocalSharedScope provides this) {
        Box(Modifier.padding(pad).fillMaxSize()) {
        NavHost(nav, startDestination = tabs.first().route, modifier = Modifier.fillMaxSize(),
            enterTransition = { if (reduced) EnterTransition.None else fadeIn(tween(220)) + slideInHorizontally(tween(260)) { it / 12 } },
            exitTransition = { if (reduced) ExitTransition.None else fadeOut(tween(160)) },
            popEnterTransition = { if (reduced) EnterTransition.None else fadeIn(tween(220)) + slideInHorizontally(tween(260)) { -it / 12 } },
            popExitTransition = { if (reduced) ExitTransition.None else fadeOut(tween(160)) }) {
            nvComposable("find?exclude={exclude}", arguments = listOf(navArgument("exclude") { type = NavType.StringType; nullable = true; defaultValue = null })) { e ->
                FindScreen(vm, exclude = e.arguments?.getString("exclude"), openRequest = { nav.navigate("request/$it") })
            }
            nvComposable("find") { FindScreen(vm, null, openRequest = { nav.navigate("request/$it") }) }
            val go: (String) -> Unit = { r -> nav.navigate(r) { launchSingleTop = true } }
            val tab: (String) -> Unit = { r -> nav.navigate(r) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true } }
            nvComposable("home") { HomeScreen(vm, openMap = { tab("map") }, openFind = { go("find") }, openGarage = { go("garage") }, openFavourites = { go("favourites") },
                openSafety = { go("safety") }, openEmergency = { go("emergency") }, openAlerts = { tab("alerts") }, openAccount = { tab("account") },
                openRequest = { nav.navigate("request/$it") }, openActivity = { tab("activity") },
                openCatalogue = { go("catalogue") }, openVolt = { com.nearvolt.ev.ui.screens.VoltController.ask() }, openTools = { go("tools") }) }
            nvComposable("map") { MapScreen(vm, openRequest = { nav.navigate("request/$it") }, openEmergency = { go("emergency") }, openAlerts = { tab("alerts") }) }
            nvComposable("garage") { GarageScreen(vm, onBack = { nav.popBackStack() }) }
            nvComposable("favourites") { FavouritesScreen(vm, onBack = { nav.popBackStack() }, openMap = { tab("map") }) }
            nvComposable("safety") { SafetyScreen(onBack = { nav.popBackStack() }, openSupport = { go("support") }) }
            nvComposable("emergency") { EmergencyScreen(vm, onBack = { nav.popBackStack() }, openRequest = { nav.navigate("request/$it") }) }
            nvComposable("activity") { HistoryScreen(asRole = "customer", open = { nav.navigate("request/$it") }) }
            nvComposable("dashboard") { HostDashboard(openRequest = { nav.navigate("request/$it") }, openListing = { nav.navigate("listing") }, openHistory = { nav.navigate("hostHistory") }) }
            nvComposable("hostHistory") { HistoryScreen(asRole = "host", open = { nav.navigate("request/$it") }, onBack = { nav.popBackStack() }) }
            nvComposable("listing") { ListingEditor() }
            nvComposable("alerts") { NotificationsScreen(open = { nav.navigate("request/$it") }) }
            nvComposable("account") { AccountScreen(vm, openSupport = { nav.navigate("support") }, openGarage = { go("garage") }, openFavourites = { go("favourites") }, openSafety = { go("safety") }) }
            nvComposable("support") { SupportScreen(onBack = { nav.popBackStack() }) }
            // ---- V1.3: catalogue, VOLT-adjacent tools and utilities
            nvComposable("catalogue") { CatalogueScreen(vm, onBack = { nav.popBackStack() }, openVehicle = { nav.navigate("vehicle/$it") }, openCompare = { go("compare") }) }
            nvComposable("vehicle/{id}") { e -> VehicleDetailScreen(vm, e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, openCompare = { go("compare") },
                openMap = { if (isHost) go("find") else tab("map") }, openEmergency = { go("emergency") }, openGarage = { go("garage") },
                askVolt = { q, v -> com.nearvolt.ev.ui.screens.VoltController.ask(q, v) }) }
            nvComposable("compare") { CompareScreen(onBack = { nav.popBackStack() }, openVehicle = { nav.navigate("vehicle/$it") }) }
            nvComposable("tools") { ToolsScreen(vm, onBack = { nav.popBackStack() }, go = { r -> if (r == "intro") showIntro = true else go(r) }) }
            nvComposable("connectors") { ConnectorGuideScreen(onBack = { nav.popBackStack() }) }
            nvComposable("checklist") { ChecklistScreen(onBack = { nav.popBackStack() }, openSupport = { go("support") }) }
            nvComposable("glossary") { GlossaryScreen(onBack = { nav.popBackStack() }) }
            nvComposable("contacts") { EmergencyContactsScreen(vm, onBack = { nav.popBackStack() }) }
            nvComposable("trip") { TripScreen(vm, onBack = { nav.popBackStack() }, openMap = { if (isHost) go("find") else tab("map") }) }
            nvComposable("area") { ServiceAreaScreen(vm, onBack = { nav.popBackStack() }, openHome = { tab(tabs.first().route) }) }
            nvComposable("request/{id}") { e ->
                RequestScreen(id = e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() },
                    findAlternatives = { exclude -> nav.navigate("find?exclude=$exclude") { popUpTo("find") { inclusive = true } } },
                    openSupport = { nav.navigate("support") })
            }
        }
        // Floating VOLT orb: Home, Map, Activity, Alerts only (not Account forms, host dashboard, requests/PIN). It avoids registered controls.
        if (uid != null && current in setOf("home", "map", "activity", "alerts")) VoltOrb(bottomInset = 0.dp)
        }
        } }
    }
    if (uid != null) VoltOverlay(uid, onVolt)
    // One-time V1.3 feature intro (per account, device-local); re-openable from Tools.
    if (uid != null && (showIntro || (local != null && local?.seenIntro13 == false && !isHost))) FeatureIntro {
        showIntro = false; scope.launch { c.accountStore.update(uid) { it.copy(seenIntro13 = true) } } }
    }
}
