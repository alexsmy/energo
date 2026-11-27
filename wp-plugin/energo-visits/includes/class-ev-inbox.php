<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class EV_Inbox {

	public static function handle() {
		if ( ! EV_CORS::is_allowed_origin() ) {
			ev_json_response( array( 'ok' => false, 'error' => 'origin not allowed' ), 403 );
		}

		// Primary: FormData field (CORS-safelisted, no preflight). Fallback: raw JSON body.
		$body = isset( $_POST['payload'] ) ? wp_unslash( $_POST['payload'] ) : file_get_contents( 'php://input' );
		if ( ! is_string( $body ) || strlen( $body ) > EV_MAX_BODY ) {
			ev_json_response( array( 'ok' => false, 'error' => 'payload too large' ), 413 );
		}

		$payload = json_decode( $body, true );
		if ( ! self::valid_payload( $payload ) ) {
			ev_json_response( array( 'ok' => false, 'error' => 'invalid payload' ), 400 );
		}
		// Жёсткий whitelist полей и длин: публичный endpoint получает
		// произвольный JSON, лишние поля не должны попадать в БД и Telegram.
		$payload = self::sanitize_payload( $payload );
		if ( ! $payload ) {
			ev_json_response( array( 'ok' => false, 'error' => 'invalid payload' ), 400 );
		}

		$ip = self::client_ip();
		if ( ! self::rate_ok( $ip, $payload ) ) {
			ev_json_response( array( 'ok' => false, 'error' => 'rate limited' ), 429 );
		}

		$geo = EV_Geo::lookup( $ip );
		$result = EV_Store::store( $payload, $geo, $ip );

		// Ограничиваем спам уведомлениями: один запрос может принести
		// сотни новых deviceId, но уведомлений должно быть не больше квоты.
		$notify_cap = max( 0, (int) ev_options()['new_devices_per_minute'] );
		$notify_key = 'ev_newdev_' . gmdate( 'YmdHi' );
		$used = (int) get_transient( $notify_key );
		$devices = array_slice( (array) ( $result['new_devices'] ?? array() ), 0, max( 0, $notify_cap - $used ) );
		if ( count( $devices ) ) {
			set_transient( $notify_key, $used + count( $devices ), 2 * MINUTE_IN_SECONDS );
		}
		foreach ( $devices as $device_id ) {
			foreach ( $payload['events'] as $ev ) {
				if ( 'session' === ( $ev['type'] ?? '' ) && ( $ev['deviceId'] ?? '' ) === $device_id ) {
					EV_Telegram::new_device( $device_id, $ev, $geo );
					break;
				}
			}
		}

		ev_json_response( array( 'ok' => true ) + $result );
	}

	private static function valid_payload( $payload ) {
		if ( ! is_array( $payload ) ) { return false; }
		if ( ( $payload['schema'] ?? '' ) !== 'energo-visits-v1' ) { return false; }

		$page = (string) ( $payload['page'] ?? '' );
		$allowed = rtrim( (string) ev_options()['allowed_page'], '/' ) . '/';
		if ( '' === $allowed || 0 !== strpos( $page, $allowed ) ) { return false; }

		$events = $payload['events'] ?? null;
		if ( ! is_array( $events ) || count( $events ) < 1 || count( $events ) > 300 ) { return false; }
		foreach ( $events as $ev ) {
			if ( ! is_array( $ev ) ) { return false; }
			foreach ( array( 'type', 'ts', 'sessionId', 'deviceId' ) as $field ) {
				if ( ! isset( $ev[ $field ] ) || ! is_string( $ev[ $field ] ) || '' === $ev[ $field ] ) { return false; }
			}
			if ( strlen( $ev['type'] ) > 32 || strlen( $ev['ts'] ) > 40 ) { return false; }
		}
		return true;
	}

	/* Поля событий, которые приходят из js/visits.js. Всё остальное
	 * отбрасывается: публичный endpoint не должен хранить произвольный JSON. */
	private static $base_keys = array( 'type', 'ts', 'eid', 'sessionId', 'deviceId', 'tab' );
	private static $type_keys = array(
		'session'     => array( 'userAgent', 'browser', 'os', 'device', 'screen', 'network', 'language', 'timezoneOffset', 'referrer', 'utm', 'hasInteracted', 'isHeadless' ),
		'fingerprint' => array( 'hardId' ),
		'tab'         => array( 'action', 'seconds', 'maxScroll', 'seenPct' ),
		'click'       => array( 'kind', 'label', 'id' ),
		'search'      => array( 'kind', 'source', 'query', 'field' ),
		'link'        => array( 'kind', 'href' ),
		'heartbeat'   => array(),
	);
	private static $max_len = array(
		'query' => 512, 'href' => 512, 'userAgent' => 512, 'referrer' => 512,
		'label' => 256, 'id' => 128, 'hardId' => 128, 'type' => 32, 'ts' => 40,
		'sessionId' => 128, 'deviceId' => 128, 'eid' => 64, 'tab' => 64,
		'kind' => 64, 'source' => 64, 'field' => 64, 'action' => 64,
		'browser' => 64, 'os' => 64, 'device' => 64, 'language' => 64,
	);

	private static function clean_value( $key, $value, $depth ) {
		if ( is_string( $value ) ) {
			$s = trim( $value );
			$max = isset( self::$max_len[ $key ] ) ? self::$max_len[ $key ] : 256;
			return function_exists( 'mb_substr' ) ? mb_substr( $s, 0, $max ) : substr( $s, 0, $max );
		}
		if ( is_int( $value ) || is_float( $value ) || is_bool( $value ) || null === $value ) {
			return $value;
		}
		if ( is_array( $value ) && $depth < 2 ) {
			$out = array();
			foreach ( $value as $k => $v ) {
				if ( ! is_string( $k ) && ! is_int( $k ) ) { continue; }
				$out[ $k ] = self::clean_value( (string) $k, $v, $depth + 1 );
			}
			return $out;
		}
		return '';
	}

	private static function sanitize_payload( $payload ) {
		if ( ! is_array( $payload ) ) { return null; }
		$out = $payload;
		$out['page'] = self::clean_value( 'page', $payload['page'] ?? '', 0 );
		$clean_events = array();
		foreach ( (array) ( $payload['events'] ?? array() ) as $ev ) {
			if ( ! is_array( $ev ) ) { return null; }
			$type = (string) ( $ev['type'] ?? '' );
			$keys = array_merge( self::$base_keys, self::$type_keys[ $type ] ?? array() );
			$item = array();
			foreach ( $keys as $k ) {
				if ( array_key_exists( $k, $ev ) ) { $item[ $k ] = self::clean_value( $k, $ev[ $k ], 0 ); }
			}
			foreach ( array( 'type', 'ts', 'sessionId', 'deviceId' ) as $required ) {
				if ( ! isset( $item[ $required ] ) || '' === $item[ $required ] ) { return null; }
			}
			$clean_events[] = $item;
		}
		$out['events'] = $clean_events;
		return $out;
	}

	private static function client_ip() {
		// Normally reg.ru gives the real client in REMOTE_ADDR. Proxy headers are ignored,
		// except when REMOTE_ADDR itself is private (a local reverse proxy in front of PHP).
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? trim( (string) $_SERVER['REMOTE_ADDR'] ) : '';
		$public = filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE );
		if ( ! $public && ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) && (int) ev_options()['trust_proxy'] ) {
			// Берём правый (последний) публичный адрес: он добавлен доверенным
			// прокси, а не подставлен клиентом в левых полях XFF.
			$parts = array_reverse( array_map( 'trim', explode( ',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) );
			foreach ( $parts as $candidate ) {
				if ( filter_var( $candidate, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) {
					return $candidate;
				}
			}
		}
		return $ip;
	}

	private static function rate_ok( $ip, $payload ) {
		$limit = max( 1, (int) ev_options()['rate_per_minute'] );
		$minute = gmdate( 'YmdHi' );
		$device = '';
		foreach ( (array) ( $payload['events'] ?? array() ) as $ev ) {
			if ( ! empty( $ev['deviceId'] ) ) { $device = (string) $ev['deviceId']; break; }
		}
		$subjects = array( $ip );
		if ( '' !== $device ) { $subjects[] = 'dev:' . $device; }
		foreach ( $subjects as $subject ) {
			$key = 'ev_rl_' . md5( $subject . '|' . $minute );
			$allowed = false;
			// Атомарный счётчик, если стоит persistent object cache.
			if ( function_exists( 'wp_using_ext_object_cache' ) && wp_using_ext_object_cache() && function_exists( 'wp_cache_add' ) ) {
				if ( wp_cache_add( $key, 1, 'ev_rl', 120 ) ) { $allowed = true; }
				else {
					$n = wp_cache_incr( $key, 1, 'ev_rl' );
					if ( false !== $n ) { $allowed = ( (int) $n <= $limit ); }
				}
			}
			if ( ! $allowed ) {
				$n = (int) get_transient( $key );
				if ( $n >= $limit ) { return false; }
				set_transient( $key, $n + 1, 2 * MINUTE_IN_SECONDS );
			}
		}
		return true;
	}
}
