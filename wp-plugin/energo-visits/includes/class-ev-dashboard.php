<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Query layer for the dashboard. All SQL uses UTC; labels are rendered in MSK. */
class EV_Dashboard {

	private static function table( $name ) { return EV_Store::prefix() . $name; }

	private static function where( $range, $type = '', $q = '' ) {
		global $wpdb;
		$parts = array( 'event_ts BETWEEN %s AND %s' );
		$args = array( $range->from_utc, $range->to_utc );
		if ( '' !== $type ) { $parts[] = 'type = %s'; $args[] = $type; }
		if ( '' !== $q ) {
			$q = mb_substr( trim( (string) $q ), 0, 100 );
			$parts[] = '(device_id LIKE %s OR payload LIKE %s)';
			$like = '%' . $wpdb->esc_like( $q ) . '%';
			$args[] = $like; $args[] = $like;
		}
		return array( implode( ' AND ', $parts ), $args );
	}

	private static function counts( $from, $to ) {
		global $wpdb;
		$table = self::table( 'events' );
		$row = $wpdb->get_row( $wpdb->prepare(
			"SELECT COUNT(*) events,
				SUM(type='session') sessions,
				COUNT(DISTINCT session_id) session_ids,
				COUNT(DISTINCT device_id) devices,
				SUM(type='click') clicks,
				SUM(type='search') searches,
				SUM(type='tab') tabs,
				SUM(type='link') links,
				ROUND(AVG(CASE WHEN type='tab' AND act='close' THEN max_scroll END),1) avg_scroll,
				SUM(is_headless) bots
			FROM $table WHERE event_ts BETWEEN %s AND %s", $from, $to ), ARRAY_A );
		return $row ? $row : array( 'events'=>0,'sessions'=>0,'session_ids'=>0,'devices'=>0,'clicks'=>0,
			'searches'=>0,'tabs'=>0,'links'=>0,'avg_scroll'=>0,'bots'=>0 );
	}

	public static function kpi( $range ) {
		$cur = self::counts( $range->from_utc, $range->to_utc );
		$cur['online'] = EV_Store::online_count();
		$cur['unique_devices'] = EV_Store::unique_devices_count();
		$cur['prev'] = $range->compare ? self::counts( $range->prev_from_utc, $range->prev_to_utc ) : null;
		return $cur;
	}

	public static function kpi_light( $range ) {
		global $wpdb;
		$table = self::table( 'events' );
		$row = $wpdb->get_row( $wpdb->prepare(
			"SELECT COUNT(*) events, SUM(type='session') sessions, SUM(type='click') clicks,
				SUM(type='search') searches FROM $table WHERE event_ts BETWEEN %s AND %s",
			$range->from_utc, $range->to_utc ), ARRAY_A );
		$row = $row ? $row : array( 'events'=>0,'sessions'=>0,'clicks'=>0,'searches'=>0 );
		$row['online'] = EV_Store::online_count();
		return $row;
	}

	public static function device_stats( $range ) {
		global $wpdb;
		$table = self::table( 'events' );
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT device_id,
				SUM(type='session') sessions,
				ROUND(SUM(CASE WHEN type='tab' AND act='close' THEN seconds ELSE 0 END),1) seconds,
				SUM(type='click') clicks, SUM(type='search') searches
			FROM $table WHERE event_ts BETWEEN %s AND %s GROUP BY device_id",
			$range->from_utc, $range->to_utc ) );
		$out = array();
		foreach ( $rows as $r ) { $out[ $r->device_id ] = $r; }
		return $out;
	}

	public static function daily( $range ) {
		global $wpdb;
		$table = self::table( 'events' );
		return $wpdb->get_results( $wpdb->prepare(
			"SELECT DATE(CONVERT_TZ(event_ts,'+00:00','+03:00')) day,
				COUNT(*) n, SUM(type='session') sessions, COUNT(DISTINCT device_id) devices,
				SUM(type='click') clicks, SUM(type='search') searches, SUM(type='tab') tabs
			FROM $table WHERE event_ts BETWEEN %s AND %s
			GROUP BY day ORDER BY day DESC LIMIT 180", $range->from_utc, $range->to_utc ) );
	}

	public static function tabs( $range ) {
		global $wpdb;
		$table = self::table( 'events' );
		return $wpdb->get_results( $wpdb->prepare(
			"SELECT tab, ROUND(SUM(seconds),1) seconds, COUNT(*) closes,
				MAX(max_scroll) scroll, MAX(seen_pct) seen, COUNT(DISTINCT device_id) devices
			FROM $table WHERE type='tab' AND act='close' AND tab<>'' AND event_ts BETWEEN %s AND %s
			GROUP BY tab ORDER BY seconds DESC LIMIT 20", $range->from_utc, $range->to_utc ) );
	}

	public static function geo( $range ) {
		global $wpdb;
		$table = self::table( 'devices' );
		return $wpdb->get_results( $wpdb->prepare(
			"SELECT country, city, isp, is_vpn, COUNT(*) n, SUM(events_count) ev
			FROM $table WHERE last_seen BETWEEN %s AND %s
			GROUP BY country, city, isp, is_vpn ORDER BY n DESC LIMIT 30", $range->from_utc, $range->to_utc ) );
	}

	public static function browsers( $range ) {
		global $wpdb;
		$table = self::table( 'devices' );
		return $wpdb->get_results( $wpdb->prepare(
			"SELECT os, browser, device_type, COUNT(*) n FROM $table
			WHERE last_seen BETWEEN %s AND %s GROUP BY os, browser, device_type ORDER BY n DESC LIMIT 20",
			$range->from_utc, $range->to_utc ) );
	}

	public static function sessions( $range, $limit = 100, $offset = 0, $device_id = '' ) {
		global $wpdb;
		$sessions = self::table( 'sessions' );
		$devices = self::table( 'devices' );
		$where = 'WHERE s.last_ts BETWEEN %s AND %s';
		$args = array( $range->from_utc, $range->to_utc );
		if ( '' !== $device_id ) { $where .= ' AND s.device_id = %s'; $args[] = $device_id; }
		$args[] = (int) $limit; $args[] = (int) $offset;
		$sql = "SELECT s.*,
			COALESCE(NULLIF(s.browser,''), d.browser) browser,
			COALESCE(NULLIF(s.os,''), d.os) os,
			COALESCE(NULLIF(s.device_type,''), d.device_type) device_type,
			COALESCE(NULLIF(s.city,''), d.city) city
			FROM $sessions s LEFT JOIN $devices d ON d.device_id = s.device_id
			$where ORDER BY s.last_ts DESC LIMIT %d OFFSET %d";
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- fixed parts, prepared values.
		return $wpdb->get_results( $wpdb->prepare( $sql, $args ) );
	}

	public static function sessions_count( $range, $device_id = '' ) {
		global $wpdb;
		$table = self::table( 'sessions' );
		$where = 'WHERE last_ts BETWEEN %s AND %s';
		$args = array( $range->from_utc, $range->to_utc );
		if ( '' !== $device_id ) { $where .= ' AND device_id = %s'; $args[] = $device_id; }
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- fixed parts, prepared values.
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $table $where", $args ) );
	}

	public static function session_events( $session_id, $limit = 100, $offset = 0 ) {
		global $wpdb;
		$table = self::table( 'events' );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $table WHERE session_id = %s ORDER BY event_ts ASC, id ASC LIMIT %d OFFSET %d",
			$session_id, (int) $limit, (int) $offset ) );
	}

	public static function session_events_count( $session_id ) {
		global $wpdb;
		$table = self::table( 'events' );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $table WHERE session_id = %s", $session_id ) );
	}

	public static function log( $range, $type = '', $q = '', $limit = 100, $offset = 0 ) {
		global $wpdb;
		$table = self::table( 'events' );
		list( $where, $args ) = self::where( $range, $type, $q );
		$args[] = (int) $limit; $args[] = (int) $offset;
		$sql = "SELECT * FROM $table WHERE $where ORDER BY event_ts DESC, id DESC LIMIT %d OFFSET %d";
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- fixed parts, prepared values.
		return $wpdb->get_results( $wpdb->prepare( $sql, $args ) );
	}

	public static function log_count( $range, $type = '', $q = '' ) {
		global $wpdb;
		$table = self::table( 'events' );
		list( $where, $args ) = self::where( $range, $type, $q );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- fixed parts, prepared values.
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $table WHERE $where", $args ) );
	}

	public static function export_rows( $range, $type = '', $q = '', $limit = 100000 ) {
		global $wpdb;
		$table = self::table( 'events' );
		list( $where, $args ) = self::where( $range, $type, $q );
		$args[] = (int) $limit;
		$sql = "SELECT * FROM $table WHERE $where ORDER BY event_ts ASC, id ASC LIMIT %d";
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- fixed parts, prepared values.
		return $wpdb->get_results( $wpdb->prepare( $sql, $args ) );
	}

	public static function online_devices() {
		global $wpdb;
		$table = self::table( 'devices' );
		$since = gmdate( 'Y-m-d H:i:s', time() - 3 * MINUTE_IN_SECONDS );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return $wpdb->get_results( $wpdb->prepare( "SELECT device_id, browser, os, device_type, country, city, isp, last_seen FROM $table WHERE last_seen >= %s ORDER BY last_seen DESC LIMIT 30", $since ) );
	}
}
