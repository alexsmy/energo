<?php
/**
 * Plugin Name: Energo Visits
 * Description: Приём и отображение статистики посещений сайта energo (GitHub Pages). Работает на одном сайте WordPress: endpoint в admin-ajax.php, данные в MySQL, просмотр только в админке.
 * Version: 2.2.2
 * Author: alexsmy
 * Text Domain: energo-visits
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Several copies of the plugin in /wp-content/plugins/ would redeclare the same
// functions and cause a fatal error. Only the first loaded copy is active.
if ( defined( 'ENERGO_VISITS_LOADED' ) ) {
	return;
}
define( 'ENERGO_VISITS_LOADED', true );

define( 'EV_VERSION', '2.2.2' );
define( 'EV_FILE', __FILE__ );
define( 'EV_DIR', plugin_dir_path( __FILE__ ) );
define( 'EV_URL', plugin_dir_url( __FILE__ ) );
define( 'EV_MAX_BODY', 65536 );

require_once EV_DIR . 'includes/class-ev-range.php';
require_once EV_DIR . 'includes/class-ev-activator.php';
require_once EV_DIR . 'includes/class-ev-cors.php';
require_once EV_DIR . 'includes/class-ev-geo.php';
require_once EV_DIR . 'includes/class-ev-store.php';
require_once EV_DIR . 'includes/class-ev-dashboard.php';
require_once EV_DIR . 'includes/class-ev-telegram.php';
require_once EV_DIR . 'includes/class-ev-inbox.php';
require_once EV_DIR . 'includes/class-ev-admin.php';
require_once EV_DIR . 'includes/class-ev-cron.php';

register_activation_hook( __FILE__, array( 'EV_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'EV_Activator', 'deactivate' ) );
add_action( 'plugins_loaded', array( 'EV_Activator', 'maybe_upgrade' ) );

// CORS must run on init before admin-ajax.php handles the request (as in TVS_CORS_Handler).
EV_CORS::init();

// Visitors are anonymous: both logged-in and nopriv handlers are registered.
add_action( 'wp_ajax_nopriv_energo_visit', array( 'EV_Inbox', 'handle' ) );
add_action( 'wp_ajax_energo_visit', array( 'EV_Inbox', 'handle' ) );

EV_Admin::init();
EV_Cron::init();

add_action( 'admin_enqueue_scripts', 'ev_admin_assets' );
add_action( 'wp_ajax_ev_live_poll', 'ev_live_poll' );

function ev_admin_assets( $hook ) {
	if ( 'toplevel_page_energo-visits' !== $hook ) { return; }
	wp_enqueue_style( 'ev-admin', EV_URL . 'assets/ev-admin.css', array(), EV_VERSION );
	wp_enqueue_script( 'ev-admin', EV_URL . 'assets/ev-admin.js', array(), EV_VERSION, true );
	$range = EV_Range::from_request();
	wp_localize_script( 'ev-admin', 'EV', array(
		'ajax'  => admin_url( 'admin-ajax.php' ),
		'nonce' => wp_create_nonce( 'ev_admin_ajax' ),
		'from'  => $range->from_local,
		'to'    => $range->to_local,
		'poll'  => 15000,
		'i18n'  => array( 'updated' => 'Обновлено', 'noData' => 'Нет данных за период' ),
	) );
}

function ev_live_poll() {
	check_ajax_referer( 'ev_admin_ajax' );
	if ( ! current_user_can( 'manage_options' ) ) { wp_send_json_error( null, 403 ); }
	$range = EV_Range::from_request();
	wp_send_json_success( array(
		'online' => EV_Store::online_count(),
		'total'  => EV_Dashboard::kpi_light( $range ),
		'ts'     => time(),
	) );
}

/**
 * Strict JSON response with an explicit HTTP status.
 */
function ev_json_response( $data, $status = 200 ) {
	status_header( $status );
	header( 'Content-Type: application/json; charset=utf-8' );
	header( 'Cache-Control: no-store' );
	echo wp_json_encode( $data );
	exit;
}

/**
 * Default settings. CORS origins are listed one per line in the admin UI.
 */
function ev_default_options() {
	return array(
		'allowed_origins' => 'https://alexsmy.github.io',
		'allowed_page'    => 'https://alexsmy.github.io/energo/',
		'rate_per_minute' => 20,
		'new_devices_per_minute' => 5,
		'geo_enabled'     => 1,
		'retention_days'  => 90,
		'tg_token'        => '',
		'tg_chat'         => '',
		'tg_notify_new'   => 1,
		'tg_digest'       => 0,
		'tg_sslverify'    => 1,
		'show_full_ip'    => 0,
		'trust_proxy'     => 0,
	);
}

function ev_options() {
	return wp_parse_args( get_option( 'ev_settings', array() ), ev_default_options() );
}
