<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class EV_Telegram {

	public static function enabled() {
		$o = ev_options();
		return '' !== trim( (string) $o['tg_token'] ) && '' !== trim( (string) $o['tg_chat'] );
	}

	public static function send( $text, $blocking = false ) {
		if ( ! self::enabled() ) {
			update_option( 'ev_tg_last_error', 'Не заданы токен или chat_id' );
			return false;
		}
		$o = ev_options();
		$url = 'https://api.telegram.org/bot' . rawurlencode( trim( (string) $o['tg_token'] ) ) . '/sendMessage';
		// As in TG Visitor Stats: JSON body, sslverify=false, non-blocking fire-and-forget.
		// On some Russian hosts the TLS chain check breaks Telegram requests.
		$args = array(
			'timeout'   => $blocking ? 8 : 2,
			'blocking'  => $blocking,
			'headers'   => array( 'Content-Type' => 'application/json; charset=utf-8' ),
			'sslverify' => ! empty( $o['tg_sslverify'] ),
			'body'      => wp_json_encode( array(
				'chat_id'                  => trim( (string) $o['tg_chat'] ),
				'text'                     => $text,
				'parse_mode'               => 'HTML',
				'disable_web_page_preview' => true,
			) ),
		);
		$response = wp_remote_post( $url, $args );
		if ( ! $blocking ) {
			// wp_remote_post with blocking=false only queues the request: no result to inspect.
			update_option( 'ev_tg_last_error', '' );
			return true;
		}
		if ( is_wp_error( $response ) ) {
			update_option( 'ev_tg_last_error', $response->get_error_message() );
			return false;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		if ( $code < 200 || $code >= 300 ) {
			$safe = preg_replace( '/\d{8,}:[A-Za-z0-9_-]+/', '[token]', (string) $body );
			update_option( 'ev_tg_last_error', 'HTTP ' . $code . ': ' . mb_substr( $safe, 0, 200 ) );
			return false;
		}
		update_option( 'ev_tg_last_error', '' );
		return true;
	}

	public static function last_error() {
		return (string) get_option( 'ev_tg_last_error', '' );
	}

	public static function new_device( $device_id, $ev, $geo ) {
		if ( ! (int) ev_options()['tg_notify_new'] ) { return false; }

		$geo_parts = array_filter( array(
			trim( (string) ( $geo['country'] ?? '' ) ),
			trim( (string) ( $geo['city'] ?? '' ) ),
			trim( (string) ( $geo['isp'] ?? '' ) ),
		) );
		$geo_text = implode( ' · ', array_map( 'esc_html', $geo_parts ) );
		if ( (int) ( $geo['is_vpn'] ?? 0 ) ) {
			$geo_text .= ' · VPN/Proxy';
		}

		$screen = ( isset( $ev['screen'] ) && is_array( $ev['screen'] ) ) ? $ev['screen'] : array();
		$screen_text = '—';
		if ( isset( $screen['width'], $screen['height'] ) ) {
			$screen_text = (int) $screen['width'] . '×' . (int) $screen['height'];
			if ( isset( $screen['availWidth'], $screen['availHeight'] ) ) {
				$dpr = isset( $screen['dpr'] ) ? (string) $screen['dpr'] : '1';
				$screen_text .= ' (видимая область ' . (int) $screen['availWidth'] . '×' . (int) $screen['availHeight'] . ', DPR ' . esc_html( $dpr ) . ')';
			}
		}

		$net = ( isset( $ev['network'] ) && is_array( $ev['network'] ) ) ? $ev['network'] : array();
		$net_parts = array();
		$net_parts[] = '' !== trim( (string) ( $net['effectiveType'] ?? '' ) ) ? esc_html( (string) $net['effectiveType'] ) : '—';
		if ( isset( $net['downlink'] ) && null !== $net['downlink'] ) {
			$net_parts[] = 'downlink ' . esc_html( (string) $net['downlink'] );
		}
		if ( isset( $net['rtt'] ) && null !== $net['rtt'] ) {
			$net_parts[] = 'rtt ' . esc_html( (string) $net['rtt'] );
		}
		$network_text = implode( ' · ', $net_parts );

		$lines = array(
			'🆕 НОВОЕ УСТРОЙСТВО · ENERGO',
			'━━━━━━━━━━━━━━━━━━━━',
			'🕒 ' . esc_html( (string) ( $ev['ts'] ?? '' ) ),
			'📍 Гео: ' . $geo_text,
			'🌐 IP: ' . esc_html( (string) ( $geo['ip'] ?? '' ) ),
			'🖥 Устройство: ' . esc_html( (string) ( $ev['device'] ?? '' ) ) . ' / ' . esc_html( (string) ( $ev['os'] ?? '' ) ) . ' / ' . esc_html( (string) ( $ev['browser'] ?? '' ) ),
			'📐 Экран: ' . $screen_text,
			'🌐 Сеть: ' . $network_text,
			'🔢 Уникальных устройств: ' . EV_Store::unique_devices_count(),
			'',
			'Событие зафиксировано автоматически при заходе на сайт',
			'===',
		);

		return self::send( implode( "\n", $lines ) );
	}

	public static function digest( $counts, $day ) {
		if ( ! (int) ev_options()['tg_digest'] ) { return false; }
		$text = "<b>Статистика energo за $day</b>\n"
			. 'Сессии: ' . (int) $counts['sessions'] . ' · Устройства: ' . (int) $counts['new_devices'] . "\n"
			. 'События: ' . (int) $counts['events'] . ' · Клики: ' . (int) $counts['clicks'] . ' · Поиск: ' . (int) $counts['searches'];
		return self::send( $text, true );
	}
}
