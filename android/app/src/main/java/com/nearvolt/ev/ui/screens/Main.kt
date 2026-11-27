package com.nearvolt.ev.ui.screens

import androidx.compose.foundation.layout.padding
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
    else listOf(Tab("find", R.string.tab_find, Icons.Outlined.Search), Tab("activity", R.string.tab_activity, Icons.Outlined.History),
        Tab("alerts", R.string.tab_alerts, Icons.Outlined.Notifications), Tab("account", R.string.tab_account, Icons.Outlined.Person))
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination?.route?.substringBefore("?")

    LaunchedEffect(state.openRequestId) { state.openRequestId?.let { nav.navigate("request/$it"); vm.requestOpened() } }

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
        NavHost(nav, startDestination = tabs.first().route, modifier = Modifier.padding(pad),
            enterTransition = { if (reduced) EnterTransition.None else fadeIn(tween(220)) + slideInHorizontally(tween(260)) { it / 12 } },
            exitTransition = { if (reduced) ExitTransition.None else fadeOut(tween(160)) },
            popEnterTransition = { if (reduced) EnterTransition.None else fadeIn(tween(220)) + slideInHorizontally(tween(260)) { -it / 12 } },
            popExitTransition = { if (reduced) ExitTransition.None else fadeOut(tween(160)) }) {
            nvComposable("find?exclude={exclude}", arguments = listOf(navArgument("exclude") { type = NavType.StringType; nullable = true; defaultValue = null })) { e ->
                FindScreen(vm, exclude = e.arguments?.getString("exclude"), openRequest = { nav.navigate("request/$it") })
            }
            nvComposable("find") { FindScreen(vm, null, openRequest = { nav.navigate("request/$it") }) }
            nvComposable("activity") { HistoryScreen(asRole = "customer", open = { nav.navigate("request/$it") }) }
            nvComposable("dashboard") { HostDashboard(openRequest = { nav.navigate("request/$it") }, openListing = { nav.navigate("listing") }, openHistory = { nav.navigate("hostHistory") }) }
            nvComposable("hostHistory") { HistoryScreen(asRole = "host", open = { nav.navigate("request/$it") }, onBack = { nav.popBackStack() }) }
            nvComposable("listing") { ListingEditor() }
            nvComposable("alerts") { NotificationsScreen(open = { nav.navigate("request/$it") }) }
            nvComposable("account") { AccountScreen(vm, openSupport = { nav.navigate("support") }) }
            nvComposable("support") { SupportScreen(onBack = { nav.popBackStack() }) }
            nvComposable("request/{id}") { e ->
                RequestScreen(id = e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() },
                    findAlternatives = { exclude -> nav.navigate("find?exclude=$exclude") { popUpTo("find") { inclusive = true } } },
                    openSupport = { nav.navigate("support") })
            }
        }
        } }
    }
}
