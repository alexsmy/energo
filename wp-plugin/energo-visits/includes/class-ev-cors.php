<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class EV_CORS {

	public static function init() {
		// Priority 1: must fire for admin-ajax.php before the action is dispatched.
		add_action( 'init', array( __CLASS__, 'handle' ), 1 );
	}

	public static function handle() {
		if ( ! self::is_ajax_request() || ! self::is_our_action() || ! self::is_allowed_origin() ) {
			return;
		}
		self::send_headers();
		if ( isset( $_SERVER['REQUEST_METHOD'] ) && 'OPTIONS' === $_SERVER['REQUEST_METHOD'] ) {
			status_header( 204 );
			exit;
		}
	}

	public static function is_ajax_request() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
		return false !== strpos( $uri, 'admin-ajax.php' );
	}

	private static function is_our_action() {
		$action = isset( $_REQUEST['action'] ) ? (string) $_REQUEST['action'] : '';
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
		return 'energo_visit' === $action || false !== strpos( $uri, 'action=energo_visit' );
	}

	public static function allowed_origins() {
		$raw = (string) ev_options()['allowed_origins'];
		$out = array();
		foreach ( explode( "\n", $raw ) as $line ) {
			$line = rtrim( trim( $line ), '/' );
			if ( '' !== $line ) {
				$out[] = $line;
			}
		}
		return $out;
	}

	public static function is_allowed_origin() {
		$origin = isset( $_SERVER['HTTP_ORIGIN'] ) ? trim( (string) $_SERVER['HTTP_ORIGIN'] ) : '';
		if ( '' === $origin ) {
			return false;
		}
		// Exact match only (unlike the loose strpos() check in TG Visitor Stats).
		return in_array( rtrim( $origin, '/' ), self::allowed_origins(), true );
	}

	public static function send_headers() {
		$origin = isset( $_SERVER['HTTP_ORIGIN'] ) ? trim( (string) $_SERVER['HTTP_ORIGIN'] ) : '';
		if ( '' === $origin ) { return; }
		header( 'Access-Control-Allow-Origin: ' . $origin );
		header( 'Access-Control-Allow-Methods: POST, OPTIONS' );
		header( 'Access-Control-Allow-Headers: Content-Type' );
		header( 'Access-Control-Max-Age: 600' );
		header( 'Vary: Origin' );
		header( 'Cache-Control: no-store' );
	}
}
