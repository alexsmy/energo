<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Single source of truth for the reporting period.
 * Dates come from the WordPress site timezone (Moscow), SQL always uses UTC.
 */
final class EV_Range {

	public $from_local = '';
	public $to_local = '';
	public $from_utc = '';
	public $to_utc = '';
	public $prev_from_utc = '';
	public $prev_to_utc = '';
	public $days = 1;
	public $preset = 'custom';
	public $compare = false;

	public static function from_request( $get = null ) {
		$get = null === $get ? $_GET : $get;
		$tz = wp_timezone();
		$utc = new DateTimeZone( 'UTC' );
		$today = wp_date( 'Y-m-d', null, $tz );

		$from = self::valid_date( isset( $get['from'] ) ? (string) $get['from'] : '' );
		$to = self::valid_date( isset( $get['to'] ) ? (string) $get['to'] : '' );
		$preset = isset( $get['preset'] ) ? sanitize_key( (string) $get['preset'] ) : '';

		if ( '' !== $preset && in_array( $preset, array( 'today', 'yesterday', '7d', '30d', 'all' ), true ) ) {
			switch ( $preset ) {
				case 'today': $from = $to = $today; break;
				case 'yesterday': $from = $to = wp_date( 'Y-m-d', time() - DAY_IN_SECONDS, $tz ); break;
				case '7d': $from = wp_date( 'Y-m-d', time() - 6 * DAY_IN_SECONDS, $tz ); $to = $today; break;
				case '30d': $from = wp_date( 'Y-m-d', time() - 29 * DAY_IN_SECONDS, $tz ); $to = $today; break;
				case 'all': $from = '2000-01-01'; $to = $today; break;
			}
		}
		if ( '' === $from ) { $from = wp_date( 'Y-m-d', time() - 6 * DAY_IN_SECONDS, $tz ); }
		if ( '' === $to ) { $to = $today; }
		if ( strcmp( $from, $to ) > 0 ) { $tmp = $from; $from = $to; $to = $tmp; }

		$start = ( new DateTimeImmutable( $from, $tz ) )->setTime( 0, 0, 0 );
		$end = ( new DateTimeImmutable( $to, $tz ) )->setTime( 23, 59, 59 );

		$r = new self();
		$r->from_local = $from;
		$r->to_local = $to;
		$r->from_utc = $start->setTimezone( $utc )->format( 'Y-m-d H:i:s' );
		$r->to_utc = $end->setTimezone( $utc )->format( 'Y-m-d H:i:s' );
		$r->days = (int) $start->diff( $end )->format( '%a' ) + 1;
		$r->prev_from_utc = $start->modify( '-' . $r->days . ' days' )->setTimezone( $utc )->format( 'Y-m-d H:i:s' );
		$r->prev_to_utc = $start->modify( '-1 day' )->setTimezone( $utc )->format( 'Y-m-d H:i:s' );
		$r->preset = '' !== $preset && in_array( $preset, array( 'today', 'yesterday', '7d', '30d', 'all' ), true ) ? $preset : 'custom';
		$r->compare = ! empty( $get['cmp'] );
		return $r;
	}

	private static function valid_date( $value ) {
		$value = trim( (string) $value );
		if ( '' === $value || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) { return ''; }
		$parts = explode( '-', $value );
		return checkdate( (int) $parts[1], (int) $parts[2], (int) $parts[0] ) ? $value : '';
	}

	public function label() {
		if ( $this->from_local === $this->to_local ) { return $this->from_local; }
		return $this->from_local . ' — ' . $this->to_local;
	}
}
