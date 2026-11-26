<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class EV_Store {

	public static function prefix() {
		global $wpdb;
		return $wpdb->prefix . 'energo_ev_';
	}

	public static function now_utc() {
		return gmdate( 'Y-m-d H:i:s' );
	}

	public static function to_utc( $ts ) {
		$t = strtotime( (string) $ts );
		return $t ? gmdate( 'Y-m-d H:i:s', $t ) : self::now_utc();
	}

	/**
	 * Insert a batch of events. Returns counters for the JSON response.
	 */
	public static function store( $payload, $geo, $ip ) {
		global $wpdb;
		$events_table  = self::prefix() . 'events';
		$devices_table = self::prefix() . 'devices';
		$stored = 0;
		$duplicates = 0;
		$new_devices = array();

		foreach ( $payload['events'] as $ev ) {
			$session_id = substr( (string) ( $ev['sessionId'] ?? '' ), 0, 36 );
			$device_id  = substr( (string) ( $ev['deviceId'] ?? '' ), 0, 36 );
			if ( '' === $session_id || '' === $device_id ) { continue; }

			$type = substr( (string) ( $ev['type'] ?? '' ), 0, 32 );
			if ( '' === $type ) { continue; }

			$raw_id = isset( $ev['eid'] ) ? (string) $ev['eid'] : '';
			$event_id = ( '' !== $raw_id && strlen( $raw_id ) <= 36 )
				? $raw_id
				: md5( $session_id . '|' . $device_id . '|' . $type . '|' . (string) ( $ev['ts'] ?? '' ) . '|' . wp_json_encode( $ev ) );

			$event_ts = self::to_utc( $ev['ts'] ?? '' );
			$json = wp_json_encode( $ev );
			$page = substr( (string) ( $payload['page'] ?? '' ), 0, 512 );
			$tab = substr( (string) ( $ev['tab'] ?? '' ), 0, 64 );
			$act = substr( (string) ( $ev['action'] ?? $ev['kind'] ?? '' ), 0, 32 );
			$seconds = isset( $ev['seconds'] ) ? (float) $ev['seconds'] : 0;
			$max_scroll = isset( $ev['maxScroll'] ) ? (float) $ev['maxScroll'] : 0;
			$seen_pct = isset( $ev['seenPct'] ) ? (float) $ev['seenPct'] : 0;
			$is_headless = ! empty( $ev['isHeadless'] ) ? 1 : 0;

			$sql = $wpdb->prepare(
				"INSERT IGNORE INTO $events_table
				(event_id, session_id, device_id, type, event_ts, received_at, page, payload, ip, country, city, isp, is_vpn,
				 tab, act, seconds, max_scroll, seen_pct, is_headless)
				VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %d, %s, %s, %f, %f, %f, %d)",
				$event_id, $session_id, $device_id, $type, $event_ts, self::now_utc(), $page, $json,
				$ip, $geo['country'], $geo['city'], $geo['isp'], (int) $geo['is_vpn'],
				$tab, $act, $seconds, $max_scroll, $seen_pct, $is_headless
			);

			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- $sql built with $wpdb->prepare above.
			$wpdb->query( $sql );
			if ( 0 === $wpdb->rows_affected ) {
				$duplicates++;
				continue;
			}
			$stored++;
			self::upsert_session( $session_id, $device_id, $type, $event_ts, $ev, $geo );

			if ( 'session' === $type ) {
				if ( self::upsert_device( $device_id, $ev, $geo, $ip, $event_ts ) ) {
					$new_devices[] = $device_id;
				}
			} elseif ( 'fingerprint' === $type && ! empty( $ev['hardId'] ) ) {
				$wpdb->query( $wpdb->prepare(
					"UPDATE $devices_table SET hard_id = %s WHERE device_id = %s AND hard_id = ''",
					substr( (string) $ev['hardId'], 0, 64 ), $device_id
				) );
			} else {
				$wpdb->query( $wpdb->prepare(
					"UPDATE $devices_table SET last_seen = GREATEST(last_seen, %s), events_count = events_count + 1 WHERE device_id = %s",
					$event_ts, $device_id
				) );
			}
		}

		return array(
			'stored'      => $stored,
			'duplicates'  => $duplicates,
			'new_devices' => array_values( array_unique( $new_devices ) ),
		);
	}

	private static function upsert_device( $device_id, $ev, $geo, $ip, $event_ts ) {
		global $wpdb;
		$table = self::prefix() . 'devices';
		$exists = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $table WHERE device_id = %s", $device_id ) );

		$data = array(
			'last_seen'    => $event_ts,
			'ip'           => $ip,
			'country'      => $geo['country'],
			'city'         => $geo['city'],
			'isp'          => $geo['isp'],
			'is_vpn'       => (int) $geo['is_vpn'],
			'os'           => substr( (string) ( $ev['os'] ?? '' ), 0, 80 ),
			'browser'      => substr( (string) ( $ev['browser'] ?? '' ), 0, 80 ),
			'device_type'  => substr( (string) ( $ev['device'] ?? '' ), 0, 40 ),
			'first_payload' => wp_json_encode( $ev ),
			'events_count' => 1,
		);
		$format = array( '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%d' );

		if ( $exists ) {
			unset( $data['first_payload'], $data['events_count'] );
			array_pop( $format );
			array_pop( $format );
			$wpdb->update( $table, $data, array( 'device_id' => $device_id ), $format, array( '%s' ) );
			return false;
		}

		$data['device_id'] = $device_id;
		$data['hard_id'] = substr( (string) ( $ev['hardId'] ?? '' ), 0, 64 );
		$data['first_seen'] = $event_ts;
		$format[] = '%s';
		$format[] = '%s';
		$format[] = '%s';
		$wpdb->insert( $table, $data, $format );
		return true;
	}

	/** Keep the session dimension as a first-class table. */
	private static function upsert_session( $session_id, $device_id, $type, $event_ts, $ev, $geo ) {
		global $wpdb;
		$table = self::prefix() . 'sessions';
		$exists = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $table WHERE session_id = %s", $session_id ) );
		$field = 'events';
		if ( 'tab' === $type ) { $field = 'tabs'; }
		if ( 'click' === $type ) { $field = 'clicks'; }
		if ( 'search' === $type ) { $field = 'searches'; }
		if ( $exists ) {
			$wpdb->query( $wpdb->prepare(
				"UPDATE $table SET last_ts = GREATEST(last_ts, %s), $field = $field + 1 WHERE session_id = %s",
				$event_ts, $session_id
			) );
			return;
		}
		$wpdb->insert( $table, array(
			'session_id'  => $session_id,
			'device_id'   => $device_id,
			'first_ts'    => $event_ts,
			'last_ts'     => $event_ts,
			'events'      => 1,
			'tabs'        => 'tab' === $type ? 1 : 0,
			'clicks'      => 'click' === $type ? 1 : 0,
			'searches'    => 'search' === $type ? 1 : 0,
			'browser'     => substr( (string) ( $ev['browser'] ?? '' ), 0, 80 ),
			'os'          => substr( (string) ( $ev['os'] ?? '' ), 0, 80 ),
			'device_type' => substr( (string) ( $ev['device'] ?? '' ), 0, 40 ),
			'country'     => substr( (string) ( $geo['country'] ?? '' ), 0, 120 ),
			'city'        => substr( (string) ( $geo['city'] ?? '' ), 0, 120 ),
		), array( '%s', '%s', '%s', '%s', '%d', '%d', '%d', '%d', '%s', '%s', '%s', '%s', '%s' ) );
	}

	public static function backfill_columns() {
		global $wpdb;
		$table = self::prefix() . 'events';
		$rows = $wpdb->get_results( "SELECT id, payload FROM $table WHERE tab = '' AND act = '' LIMIT 100000" );
		foreach ( $rows as $row ) {
			$data = json_decode( (string) $row->payload, true );
			if ( ! is_array( $data ) ) { continue; }
			$wpdb->update( $table, array(
				'tab' => substr( (string) ( $data['tab'] ?? '' ), 0, 64 ),
				'act' => substr( (string) ( $data['action'] ?? $data['kind'] ?? '' ), 0, 32 ),
				'seconds' => isset( $data['seconds'] ) ? (float) $data['seconds'] : 0,
				'max_scroll' => isset( $data['maxScroll'] ) ? (float) $data['maxScroll'] : 0,
				'seen_pct' => isset( $data['seenPct'] ) ? (float) $data['seenPct'] : 0,
				'is_headless' => ! empty( $data['isHeadless'] ) ? 1 : 0,
			), array( 'id' => $row->id ), array( '%s', '%s', '%f', '%f', '%f', '%d' ), array( '%d' ) );
		}
	}

	public static function rebuild_sessions() {
		global $wpdb;
		$events = self::prefix() . 'events';
		$sessions = self::prefix() . 'sessions';
		$wpdb->query( 'TRUNCATE TABLE ' . $sessions ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$rows = $wpdb->get_results( "SELECT session_id, device_id, type, event_ts, country, city FROM $events ORDER BY event_ts ASC LIMIT 200000" );
		$acc = array();
		foreach ( $rows as $r ) {
			$id = $r->session_id;
			if ( ! isset( $acc[ $id ] ) ) {
				$acc[ $id ] = array( 'session_id' => $id, 'device_id' => $r->device_id, 'first_ts' => $r->event_ts, 'last_ts' => $r->event_ts,
					'events' => 0, 'tabs' => 0, 'clicks' => 0, 'searches' => 0, 'country' => $r->country, 'city' => $r->city );
			}
			$acc[ $id ]['last_ts'] = $r->event_ts;
			$acc[ $id ]['events']++;
			if ( 'tab' === $r->type ) { $acc[ $id ]['tabs']++; }
			if ( 'click' === $r->type ) { $acc[ $id ]['clicks']++; }
			if ( 'search' === $r->type ) { $acc[ $id ]['searches']++; }
		}
		$dev_map = array();
		foreach ( $wpdb->get_results( 'SELECT device_id, browser, os, device_type FROM ' . self::prefix() . 'devices' ) as $dev ) {
			$dev_map[ $dev->device_id ] = $dev;
		}
		foreach ( $acc as $row ) {
			if ( isset( $dev_map[ $row['device_id'] ] ) ) {
				$dev = $dev_map[ $row['device_id'] ];
				$row['browser'] = $dev->browser; $row['os'] = $dev->os; $row['device_type'] = $dev->device_type;
			}
			$wpdb->insert( $sessions, $row, array( '%s','%s','%s','%s','%d','%d','%d','%d','%s','%s','%s','%s','%s' ) );
		}
	}

	public static function list_devices( $from, $to, $search = '' ) {
		global $wpdb;
		$table = self::prefix() . 'devices';
		$where = 'WHERE last_seen BETWEEN %s AND %s';
		$args = array( $from, $to );
		$search = trim( (string) $search );
		if ( '' !== $search ) {
			$search = mb_substr( $search, 0, 100 );
			$like = '%' . $wpdb->esc_like( $search ) . '%';
			$where .= ' AND (device_id LIKE %s OR os LIKE %s OR browser LIKE %s OR device_type LIKE %s OR country LIKE %s OR city LIKE %s OR ip LIKE %s)';
			$args = array_merge( $args, array_fill( 0, 7, $like ) );
		}
		$sql = "SELECT * FROM $table $where ORDER BY last_seen DESC LIMIT 300";
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- fixed parts, values prepared.
		return $wpdb->get_results( $wpdb->prepare( $sql, $args ) );
	}

	public static function online_count() {
		global $wpdb;
		$table = self::prefix() . 'devices';
		$since = gmdate( 'Y-m-d H:i:s', time() - 3 * MINUTE_IN_SECONDS );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $table WHERE last_seen >= %s", $since ) );
	}

	/** Top click targets and search queries — one SQL aggregate, no JSON parsing. */
	public static function top_actions( $from, $to, $limit = 15, $device_id = '' ) {
		global $wpdb;
		$table = self::prefix() . 'events';
		$where = 'WHERE type IN (\'click\',\'search\') AND event_ts BETWEEN %s AND %s';
		$args = array( $from, $to );
		if ( '' !== $device_id ) { $where .= ' AND device_id = %s'; $args[] = $device_id; }
		$args[] = 5000;
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT type, payload FROM $table $where ORDER BY event_ts DESC, id DESC LIMIT %d", $args ) );

		$refs = array();
		$ref_rows = $wpdb->get_results( 'SELECT ref_id, kind, title FROM ' . self::prefix() . 'refs LIMIT 5000' );
		foreach ( $ref_rows as $r ) { $refs[ $r->kind . '|' . $r->ref_id ] = $r->title; }

		$clicks = array(); $searches = array();
		foreach ( $rows as $row ) {
			$data = json_decode( (string) $row->payload, true );
			if ( ! is_array( $data ) ) { continue; }
			if ( 'click' === $row->type ) {
				$kind = (string) ( $data['kind'] ?? '' );
				$id = (string) ( $data['id'] ?? '' );
				$label = (string) ( $data['label'] ?? '' );
				$labels = array(
					'filterToggle' => 'Фильтры', 'tFilterToggle' => 'Фильтры закупок', 'tReset' => 'Сброс закупок',
					'resetBtn' => 'Сброс реестра', 'exportBtn' => 'Экспорт CSV', 'tOpenSearch' => 'Поиск закупок',
					'tSort' => 'Сортировка закупок', 'sort' => 'Сортировка', 'tenders' => 'Вкладка: Закупки',
					'map' => 'Вкладка: Карта', 'registry' => 'Вкладка: Реестр',
				);
				if ( '' !== $id && in_array( $kind, array( 'org_card', 'tender_card' ), true ) ) {
					$key = $refs[ ( 'org_card' === $kind ? 'org' : 'tender' ) . '|' . $id ] ?? $id;
				} elseif ( '' !== $label && isset( $labels[ $label ] ) ) {
					$key = $labels[ $label ];
				} else { $key = '' !== $label ? $label : $kind; }
				if ( '' !== $key ) { $clicks[ $key ] = ( $clicks[ $key ] ?? 0 ) + 1; }
			} elseif ( 'search' === $row->type ) {
				$q = trim( (string) ( $data['query'] ?? '' ) );
				if ( '' !== $q ) { $searches[ $q ] = ( $searches[ $q ] ?? 0 ) + 1; }
			}
		}
		arsort( $clicks ); arsort( $searches );
		return array( 'clicks' => array_slice( $clicks, 0, $limit, true ), 'searches' => array_slice( $searches, 0, $limit, true ) );
	}

	public static function get_device( $device_id ) {
		global $wpdb;
		$table = self::prefix() . 'devices';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $table WHERE device_id = %s", $device_id ) );
	}

	public static function device_events( $device_id, $limit = 300 ) {
		global $wpdb;
		$table = self::prefix() . 'events';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $table WHERE device_id = %s ORDER BY event_ts DESC LIMIT %d", $device_id, (int) $limit ) );
	}

	public static function recent_events( $from, $to, $limit = 100, $type = '', $device_id = '' ) {
		global $wpdb;
		$table = self::prefix() . 'events';
		$where = 'WHERE event_ts BETWEEN %s AND %s';
		$args = array( $from, $to );
		if ( '' !== $type ) {
			$where .= ' AND type = %s';
			$args[] = $type;
		}
		if ( '' !== $device_id ) {
			$where .= ' AND device_id = %s';
			$args[] = $device_id;
		}
		$args[] = (int) $limit;
		$sql = "SELECT * FROM $table $where ORDER BY event_ts DESC, id DESC LIMIT %d";
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- built from fixed parts and prepared values.
		return $wpdb->get_results( $wpdb->prepare( $sql, $args ) );
	}

	public static function summary( $days ) {
		global $wpdb;
		$table = self::prefix() . 'events';
		$since = gmdate( 'Y-m-d H:i:s', time() - (int) $days * DAY_IN_SECONDS );
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT type, COUNT(*) AS n FROM $table WHERE event_ts >= %s GROUP BY type",
			$since
		) );
		$out = array( 'sessions' => 0, 'events' => 0, 'clicks' => 0, 'searches' => 0, 'tabs' => 0, 'links' => 0, 'heartbeat' => 0, 'devices' => 0 );
		foreach ( $rows as $row ) {
			$out['events'] += (int) $row->n;
			if ( isset( $out[ $row->type ] ) ) { $out[ $row->type ] += (int) $row->n; }
		}
		$devices = self::prefix() . 'devices';
		$out['devices'] = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $devices WHERE last_seen >= %s", $since ) );
		return $out;
	}

	public static function aggregate( $day ) {
		global $wpdb;
		$events = self::prefix() . 'events';
		$daily = self::prefix() . 'daily';
		$start = $day . ' 00:00:00';
		$end = gmdate( 'Y-m-d H:i:s', strtotime( $day . ' +1 day' ) );
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT type, COUNT(*) AS n, COUNT(DISTINCT device_id) AS d FROM $events WHERE event_ts >= %s AND event_ts < %s GROUP BY type",
			$start, $end
		) );
		$counts = array( 'sessions' => 0, 'devices' => 0, 'events' => 0, 'clicks' => 0, 'searches' => 0, 'tabs' => 0, 'links' => 0, 'new_devices' => 0 );
		foreach ( $rows as $row ) {
			$counts['events'] += (int) $row->n;
			if ( 'session' === $row->type ) {
				$counts['sessions'] = (int) $row->n;
				$counts['new_devices'] = (int) $row->d;
			}
			$key = 'clicks' === $row->type || 'link' === $row->type ? 'clicks' : ( 'search' === $row->type ? 'searches' : ( 'tab' === $row->type ? 'tabs' : '' ) );
			if ( '' !== $key ) { $counts[ $key ] += (int) $row->n; }
		}
		$data = array_merge( $counts, array( 'day' => $day, 'updated_at' => self::now_utc() ) );
		$format = array( '%s', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%s' );
		$wpdb->replace( $daily, $data, $format );
		return $counts;
	}

	public static function daily_rows( $limit = 30 ) {
		global $wpdb;
		$table = self::prefix() . 'daily';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $table ORDER BY day DESC LIMIT %d", (int) $limit ) );
	}

	public static function count_events() {
		global $wpdb;
		$table = self::prefix() . 'events';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM $table" );
	}

	public static function unique_devices_count() {
		global $wpdb;
		$table = self::prefix() . 'devices';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM $table" );
	}

	/** Fetch public registry/tender JSON from GitHub Pages and build a readable ID -> title dictionary. */
	public static function sync_refs() {
		global $wpdb;
		$table = self::prefix() . 'refs';
		$sources = array(
			array( 'https://alexsmy.github.io/energo/registry.json', 'org' ),
			array( 'https://alexsmy.github.io/energo/data/tenders.json', 'tender' ),
		);
		$found = array();
		$ok = 0;
		foreach ( $sources as $src ) {
			$response = wp_remote_get( $src[0], array( 'timeout' => 20 ) );
			if ( is_wp_error( $response ) ) { continue; }
			$code = (int) wp_remote_retrieve_response_code( $response );
			if ( $code < 200 || $code >= 300 ) { continue; }
			$data = json_decode( wp_remote_retrieve_body( $response ), true );
			if ( ! is_array( $data ) ) { continue; }
			$ok++;
			self::collect_refs( $data, $src[1], $found );
		}
		if ( 0 === $ok || count( $found ) < 50 ) { return 0; }
		$wpdb->query( 'TRUNCATE TABLE ' . $table ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		foreach ( $found as $row ) {
			$wpdb->insert( $table, $row, array( '%s', '%s', '%s', '%s' ) );
		}
		return count( $found );
	}

	private static function collect_refs( $node, $kind, &$found ) {
		if ( ! is_array( $node ) ) { return; }
		if ( isset( $node['id'] ) && is_scalar( $node['id'] ) ) {
			$id = trim( (string) $node['id'] );
			$title = '';
			foreach ( array( 'name', 'full', 'title', 'shortName' ) as $field ) {
				if ( ! empty( $node[ $field ] ) && is_scalar( $node[ $field ] ) ) {
					$title = trim( (string) $node[ $field ] );
					break;
				}
			}
			if ( '' !== $id && '' !== $title ) {
				$found[ $kind . '|' . $id ] = array(
					'ref_id' => substr( $id, 0, 120 ),
					'kind'   => $kind,
					'title'  => substr( $title, 0, 500 ),
					'url'    => substr( ! empty( $node['url'] ) && is_scalar( $node['url'] ) ? (string) $node['url'] : '', 0, 500 ),
				);
			}
		}
		foreach ( $node as $value ) {
			if ( is_array( $value ) ) { self::collect_refs( $value, $kind, $found ); }
		}
	}

	public static function ref_title( $ref_id, $kind ) {
		global $wpdb;
		$table = self::prefix() . 'refs';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name from prefix.
		return $wpdb->get_var( $wpdb->prepare( "SELECT title FROM $table WHERE ref_id = %s AND kind = %s", $ref_id, $kind ) );
	}

	/** What users actually opened — one SQL aggregate with a single refs JOIN. */
	public static function viewed_items( $from, $to, $limit = 100, $device_id = '' ) {
		global $wpdb;
		$table = self::prefix() . 'events';
		$where = 'WHERE type=\'click\' AND event_ts BETWEEN %s AND %s';
		$args = array( $from, $to );
		if ( '' !== $device_id ) { $where .= ' AND device_id = %s'; $args[] = $device_id; }
		$args[] = 5000;
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT device_id, session_id, event_ts, payload FROM $table $where ORDER BY event_ts DESC, id DESC LIMIT %d", $args ) );

		$refs = array();
		foreach ( $wpdb->get_results( 'SELECT ref_id, kind, title, url FROM ' . self::prefix() . 'refs LIMIT 5000' ) as $r ) {
			$refs[ $r->kind . '|' . $r->ref_id ] = $r;
		}
		$out = array();
		foreach ( $rows as $row ) {
			$data = json_decode( (string) $row->payload, true );
			if ( ! is_array( $data ) ) { continue; }
			$kind = (string) ( $data['kind'] ?? '' );
			if ( ! in_array( $kind, array( 'org_card', 'tender_card' ), true ) ) { continue; }
			$id = (string) ( $data['id'] ?? '' );
			if ( '' === $id ) { continue; }
			$key = $kind . '|' . $id;
			if ( ! isset( $out[ $key ] ) ) {
				$ref = $refs[ ( 'org_card' === $kind ? 'org' : 'tender' ) . '|' . $id ] ?? null;
				$out[ $key ] = (object) array(
					'kind' => $kind, 'ref_id' => $id, 'n' => 0,
					'devices' => array(), 'sessions' => array(), 'last' => $row->event_ts,
					'title' => $ref ? $ref->title : '', 'url' => $ref ? $ref->url : '',
				);
			}
			$out[ $key ]->n++;
			$out[ $key ]->devices[ $row->device_id ] = 1;
			$out[ $key ]->sessions[ $row->session_id ] = 1;
		}
		usort( $out, function ( $a, $b ) { return $b->n - $a->n; } );
		foreach ( $out as &$item ) {
			$item->devices = count( $item->devices );
			$item->sessions = count( $item->sessions );
		}
		return array_slice( $out, 0, $limit );
	}

	public static function cleanup( $scope, $before = '' ) {
		global $wpdb;
		$events = self::prefix() . 'events';
		if ( 'all' === $scope ) {
			$wpdb->query( "TRUNCATE TABLE $events" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->query( 'TRUNCATE TABLE ' . self::prefix() . 'devices' ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->query( 'TRUNCATE TABLE ' . self::prefix() . 'daily' ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->query( 'TRUNCATE TABLE ' . self::prefix() . 'sessions' ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return;
		}
		$before = preg_match( '/^\d{4}-\d{2}-\d{2}$/', $before ) ? $before : gmdate( 'Y-m-d', time() - 90 * DAY_IN_SECONDS );
		$wpdb->query( $wpdb->prepare( "DELETE FROM $events WHERE event_ts < %s", $before . ' 00:00:00' ) );
		$devices = self::prefix() . 'devices';
		$wpdb->query( $wpdb->prepare( "DELETE FROM $devices WHERE last_seen < %s", $before . ' 00:00:00' ) );
		$sessions = self::prefix() . 'sessions';
		$wpdb->query( $wpdb->prepare( "DELETE FROM $sessions WHERE last_ts < %s", $before . ' 00:00:00' ) );
		$daily = self::prefix() . 'daily';
		$wpdb->query( $wpdb->prepare( "DELETE FROM $daily WHERE day < %s", $before ) );
	}

	public static function delete_device( $device_id ) {
		global $wpdb;
		$devices = self::prefix() . 'devices';
		$events = self::prefix() . 'events';
		$sessions = self::prefix() . 'sessions';
		$wpdb->query( $wpdb->prepare( "DELETE FROM $events WHERE device_id = %s", $device_id ) );
		$wpdb->query( $wpdb->prepare( "DELETE FROM $sessions WHERE device_id = %s", $device_id ) );
		$wpdb->query( $wpdb->prepare( "DELETE FROM $devices WHERE device_id = %s", $device_id ) );
	}
}
