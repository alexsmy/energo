<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class EV_Cron {

	public static function init() {
		add_action( 'ev_daily', array( __CLASS__, 'run' ) );
	}

	public static function run() {
		// WP-Cron runs in server time; aggregate Moscow "yesterday" explicitly.
		$tz = new DateTimeZone( 'Europe/Moscow' );
		$now = new DateTime( 'now', $tz );
		$yesterday = $now->modify( '-1 day' )->format( 'Y-m-d' );

		$counts = EV_Store::aggregate( $yesterday );
		EV_Telegram::digest( $counts, $yesterday );

		$days = max( 1, (int) ev_options()['retention_days'] );
		$before = gmdate( 'Y-m-d', time() - $days * DAY_IN_SECONDS );
		EV_Store::cleanup( 'before', $before );
	}
}
