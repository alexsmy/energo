<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class EV_Geo {

	private static $vpn_words = array(
		'vpn', 'proxy', 'hosting', 'datacenter', 'data center', 'cloud', 'digitalocean',
		'linode', 'vultr', 'hetzner', 'ovh', 'amazon', 'google cloud', 'microsoft azure',
		'reg.ru', 'timeweb', 'beget', 'fastly', 'cloudflare', 'tor', 'anonymous',
	);

	public static function lookup( $ip ) {
		$empty = array( 'country' => '', 'city' => '', 'isp' => '', 'ip' => $ip, 'is_vpn' => 0 );
		if ( '' === $ip || ! filter_var( $ip, FILTER_VALIDATE_IP ) ) {
			return $empty;
		}
		if ( ! (int) ev_options()['geo_enabled'] ) {
			return $empty;
		}

		$key = 'ev_geo_' . md5( $ip );
		$cached = get_transient( $key );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$result = $empty;
		$data = self::fetch( 'https://ip-api.com/json/' . rawurlencode( $ip ) . '?fields=status,country,city,isp,org,as&lang=ru' );
		if ( ! is_array( $data ) ) {
			// Второй провайдер только по HTTPS: ip-адрес не должен уходить
			// в открытом виде, даже если основной сервис недоступен.
			$alt = self::fetch( 'https://ipwho.is/' . rawurlencode( $ip ) . '?lang=ru' );
			if ( is_array( $alt ) && ! empty( $alt['success'] ) ) {
				$data = array(
					'status'  => 'success',
					'country' => self::text( $alt['country'] ?? '' ),
					'city'    => self::text( $alt['city'] ?? '' ),
					'isp'     => self::text( $alt['connection']['isp'] ?? ( $alt['connection']['org'] ?? '' ) ),
				);
			}
		}
		if ( is_array( $data ) && isset( $data['status'] ) && 'success' === $data['status'] ) {
			$isp = self::text( $data['isp'] ?? '' );
			if ( '' === $isp ) { $isp = self::text( (string) ( $data['org'] ?? '' ) . ' ' . (string) ( $data['as'] ?? '' ) ); }
			$result = array(
				'country' => self::text( $data['country'] ?? '' ),
				'city'    => self::text( $data['city'] ?? '' ),
				'isp'     => $isp,
				'ip'      => $ip,
				'is_vpn'  => self::is_vpn( $isp ),
			);
		} else {
			$flag = self::fetch( 'https://blackbox.ipinfo.app/lookup/' . rawurlencode( $ip ) );
			if ( is_string( $flag ) && 'Y' === trim( $flag ) ) {
				$result['is_vpn'] = 1;
			}
		}

		set_transient( $key, $result, WEEK_IN_SECONDS );
		return $result;
	}

	/* Ответ внешнего geo-сервиса недоверен: ограничиваем длины строк. */
	private static function text( $value, $max = 128 ) {
		$s = trim( (string) $value );
		return function_exists( 'mb_substr' ) ? mb_substr( $s, 0, $max ) : substr( $s, 0, $max );
	}

	private static function fetch( $url ) {
		$response = wp_remote_get( $url, array( 'timeout' => 3, 'redirection' => 2 ) );
		if ( is_wp_error( $response ) ) {
			return null;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			return null;
		}
		$body = wp_remote_retrieve_body( $response );
		$decoded = json_decode( $body, true );
		return is_array( $decoded ) ? $decoded : trim( (string) $body );
	}

	private static function is_vpn( $isp ) {
		$isp = (string) $isp;
		$lower = function_exists( 'mb_strtolower' ) ? mb_strtolower( $isp, 'UTF-8' ) : strtolower( $isp );
		foreach ( self::$vpn_words as $word ) {
			if ( false !== strpos( $lower, $word ) ) { return 1; }
		}
		return 0;
	}

	public static function mask_ip( $ip ) {
		if ( false === strpos( (string) $ip, '.' ) ) {
			$parts = explode( ':', (string) $ip );
			return implode( ':', array_slice( $parts, 0, count( $parts ) - 2 ) ) . '::XX:XX';
		}
		$parts = explode( '.', (string) $ip );
		if ( 4 === count( $parts ) ) {
			$parts[3] = 'XX';
			return implode( '.', $parts );
		}
		return (string) $ip;
	}
}
