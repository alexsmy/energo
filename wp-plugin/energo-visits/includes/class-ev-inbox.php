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

		$ip = self::client_ip();
		if ( ! self::rate_ok( $ip ) ) {
			ev_json_response( array( 'ok' => false, 'error' => 'rate limited' ), 429 );
		}

		$geo = EV_Geo::lookup( $ip );
		$result = EV_Store::store( $payload, $geo, $ip );

		foreach ( $result['new_devices'] as $device_id ) {
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

	private static function client_ip() {
		// Normally reg.ru gives the real client in REMOTE_ADDR. Proxy headers are ignored,
		// except when REMOTE_ADDR itself is private (a local reverse proxy in front of PHP).
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? trim( (string) $_SERVER['REMOTE_ADDR'] ) : '';
		$public = filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE );
		if ( ! $public && ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) && (int) ev_options()['trust_proxy'] ) {
			$parts = explode( ',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'] );
			$candidate = trim( $parts[0] );
			if ( filter_var( $candidate, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) {
				return $candidate;
			}
		}
		return $ip;
	}

	private static function rate_ok( $ip ) {
		$limit = max( 1, (int) ev_options()['rate_per_minute'] );
		$key = 'ev_rl_' . md5( $ip . '|' . gmdate( 'YmdHi' ) );
		$n = (int) get_transient( $key );
		if ( $n >= $limit ) { return false; }
		set_transient( $key, $n + 1, 2 * MINUTE_IN_SECONDS );
		return true;
	}
}
