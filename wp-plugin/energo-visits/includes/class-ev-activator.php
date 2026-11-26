<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class EV_Activator {

	public static function activate() {
		self::create_tables();
		add_option( 'ev_settings', ev_default_options() );
		add_option( 'ev_db_version', EV_VERSION );
		self::schedule();
	}

	public static function maybe_upgrade() {
		$old = (string) get_option( 'ev_db_version', '' );
		if ( $old !== EV_VERSION ) {
			self::create_tables();
			update_option( 'ev_db_version', EV_VERSION );
			// 1.1.0: уведомления о новых устройствах включены по умолчанию.
			if ( '' !== $old && version_compare( $old, '1.1.0', '<' ) ) {
				$o = ev_options();
				$o['tg_notify_new'] = 1;
				update_option( 'ev_settings', $o );
			}
			if ( '' !== $old && version_compare( $old, '2.0.0', '<' ) ) {
				EV_Store::backfill_columns();
			}
			if ( '' !== $old && version_compare( $old, '2.2.0', '<' ) ) {
				EV_Store::rebuild_sessions();
			}
		}
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( 'ev_daily' );
	}

	private static function schedule() {
		if ( ! wp_next_scheduled( 'ev_daily' ) ) {
			// 06:00 Moscow time; WP-Cron time is site time, MOSCOW offset applied in the handler.
			wp_schedule_event( time() + 6 * HOUR_IN_SECONDS, 'daily', 'ev_daily' );
		}
	}

	private static function create_tables() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$prefix = $wpdb->prefix . 'energo_ev_';
		$charset = $wpdb->get_charset_collate();

		$events = "CREATE TABLE {$prefix}events (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id CHAR(36) NOT NULL,
			session_id CHAR(36) NOT NULL,
			device_id CHAR(36) NOT NULL,
			type VARCHAR(32) NOT NULL,
			event_ts DATETIME NOT NULL,
			received_at DATETIME NOT NULL,
			page VARCHAR(512) NOT NULL DEFAULT '',
			payload TEXT NOT NULL,
			ip VARCHAR(45) NOT NULL DEFAULT '',
			country VARCHAR(120) NOT NULL DEFAULT '',
			city VARCHAR(120) NOT NULL DEFAULT '',
			isp VARCHAR(200) NOT NULL DEFAULT '',
			is_vpn TINYINT NOT NULL DEFAULT 0,
			tab VARCHAR(64) NOT NULL DEFAULT '',
			act VARCHAR(32) NOT NULL DEFAULT '',
			seconds DECIMAL(10,2) NOT NULL DEFAULT 0,
			max_scroll DECIMAL(6,2) NOT NULL DEFAULT 0,
			seen_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
			is_headless TINYINT NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			UNIQUE KEY uniq_event (event_id),
			KEY idx_ts (event_ts),
			KEY idx_device (device_id),
			KEY idx_type (type),
			KEY idx_tab_act (type, tab, act)
		) $charset;";

		$devices = "CREATE TABLE {$prefix}devices (
			device_id CHAR(36) NOT NULL,
			hard_id VARCHAR(64) NOT NULL DEFAULT '',
			first_seen DATETIME NOT NULL,
			last_seen DATETIME NOT NULL,
			first_payload TEXT NOT NULL,
			ip VARCHAR(45) NOT NULL DEFAULT '',
			country VARCHAR(120) NOT NULL DEFAULT '',
			city VARCHAR(120) NOT NULL DEFAULT '',
			isp VARCHAR(200) NOT NULL DEFAULT '',
			is_vpn TINYINT NOT NULL DEFAULT 0,
			os VARCHAR(80) NOT NULL DEFAULT '',
			browser VARCHAR(80) NOT NULL DEFAULT '',
			device_type VARCHAR(40) NOT NULL DEFAULT '',
			events_count INT NOT NULL DEFAULT 0,
			PRIMARY KEY  (device_id),
			KEY idx_last (last_seen)
		) $charset;";

		$sessions = "CREATE TABLE {$prefix}sessions (
			session_id CHAR(36) NOT NULL,
			device_id CHAR(36) NOT NULL DEFAULT '',
			first_ts DATETIME NOT NULL,
			last_ts DATETIME NOT NULL,
			events INT NOT NULL DEFAULT 0,
			tabs INT NOT NULL DEFAULT 0,
			clicks INT NOT NULL DEFAULT 0,
			searches INT NOT NULL DEFAULT 0,
			browser VARCHAR(80) NOT NULL DEFAULT '',
			os VARCHAR(80) NOT NULL DEFAULT '',
			device_type VARCHAR(40) NOT NULL DEFAULT '',
			country VARCHAR(120) NOT NULL DEFAULT '',
			city VARCHAR(120) NOT NULL DEFAULT '',
			PRIMARY KEY  (session_id),
			KEY idx_last (last_ts),
			KEY idx_device (device_id)
		) $charset;";

		$refs = "CREATE TABLE {$prefix}refs (
			ref_id VARCHAR(120) NOT NULL,
			kind VARCHAR(32) NOT NULL,
			title VARCHAR(500) NOT NULL DEFAULT '',
			url VARCHAR(500) NOT NULL DEFAULT '',
			PRIMARY KEY  (ref_id, kind)
		) $charset;";

		$daily = "CREATE TABLE {$prefix}daily (
			day DATE NOT NULL,
			sessions INT NOT NULL DEFAULT 0,
			devices INT NOT NULL DEFAULT 0,
			events INT NOT NULL DEFAULT 0,
			clicks INT NOT NULL DEFAULT 0,
			searches INT NOT NULL DEFAULT 0,
			tabs INT NOT NULL DEFAULT 0,
			links INT NOT NULL DEFAULT 0,
			new_devices INT NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY  (day)
		) $charset;";

		dbDelta( $events );
		dbDelta( $devices );
		dbDelta( $daily );
		dbDelta( $refs );
		dbDelta( $sessions );
	}
}
