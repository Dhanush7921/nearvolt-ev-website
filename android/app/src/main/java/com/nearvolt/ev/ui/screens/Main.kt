package com.nearvolt.ev.ui.screens

import androidx.compose.foundation.layout.padding
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

private data class Tab(val route: String, val label: Int, val icon: ImageVector)

/** Role-based shell: customers find charging; hosts manage their listing and incoming requests. */
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
                }, icon = { Icon(t.icon, null) }, label = { Text(stringResource(t.label)) })
            }
        }
    }) { pad ->
        NavHost(nav, startDestination = tabs.first().route, modifier = Modifier.padding(pad)) {
            composable("find?exclude={exclude}", arguments = listOf(navArgument("exclude") { type = NavType.StringType; nullable = true; defaultValue = null })) { e ->
                FindScreen(vm, exclude = e.arguments?.getString("exclude"), openRequest = { nav.navigate("request/$it") })
            }
            composable("find") { FindScreen(vm, null, openRequest = { nav.navigate("request/$it") }) }
            composable("activity") { HistoryScreen(asRole = "customer", open = { nav.navigate("request/$it") }) }
            composable("dashboard") { HostDashboard(openRequest = { nav.navigate("request/$it") }, openListing = { nav.navigate("listing") }, openHistory = { nav.navigate("hostHistory") }) }
            composable("hostHistory") { HistoryScreen(asRole = "host", open = { nav.navigate("request/$it") }, onBack = { nav.popBackStack() }) }
            composable("listing") { ListingEditor() }
            composable("alerts") { NotificationsScreen(open = { nav.navigate("request/$it") }) }
            composable("account") { AccountScreen(vm, openSupport = { nav.navigate("support") }) }
            composable("support") { SupportScreen(onBack = { nav.popBackStack() }) }
            composable("request/{id}") { e ->
                RequestScreen(id = e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() },
                    findAlternatives = { exclude -> nav.navigate("find?exclude=$exclude") { popUpTo("find") { inclusive = true } } },
                    openSupport = { nav.navigate("support") })
            }
        }
    }
}
