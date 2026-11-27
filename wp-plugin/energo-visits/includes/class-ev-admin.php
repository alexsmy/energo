<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class EV_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		foreach ( array( 'save_settings', 'cleanup', 'delete_device', 'delete_session', 'sync_refs', 'test_tg', 'export' ) as $action ) {
			add_action( 'admin_post_ev_' . $action, array( __CLASS__, $action ) );
		}
	}

	public static function menu() {
		add_menu_page( 'Энерго · статистика', 'Энерго · статистика', 'manage_options', 'energo-visits',
			array( __CLASS__, 'render' ), 'dashicons-chart-area', 30 );
	}

	private static function ensure_cap() { if ( ! current_user_can( 'manage_options' ) ) { wp_die( 'Доступ запрещён.' ); } }
	private static function param( $k, $d = '' ) { return isset( $_GET[ $k ] ) ? sanitize_text_field( wp_unslash( (string) $_GET[ $k ] ) ) : $d; }
	private static function msk( $utc, $format = 'd.m.Y H:i' ) {
		return $utc ? wp_date( $format, strtotime( (string) $utc . ' UTC' ), wp_timezone() ) : '—';
	}
	private static function online( $ts ) { return ( time() - strtotime( (string) $ts . ' UTC' ) ) <= 180; }
	private static function ip_view( $ip ) { return (int) ev_options()['show_full_ip'] ? $ip : EV_Geo::mask_ip( $ip ); }

	private static function url( $args = array() ) {
		$base = array( 'page' => 'energo-visits' );
		foreach ( array( 'from', 'to', 'preset', 'cmp', 'type', 'q', 'device', 'session', 'p' ) as $k ) {
			$v = self::param( $k ); if ( '' !== $v ) { $base[ $k ] = $v; }
		}
		return add_query_arg( array_merge( $base, $args ), admin_url( 'admin.php' ) );
	}

	public static function render() {
		self::ensure_cap();
		$range = EV_Range::from_request();
		$type = self::param( 'type' );
		$q = self::param( 'q' );
		$device = self::param( 'device' );
		$session = self::param( 'session' );
		$notice = self::param( 'ev_notice' );

		echo '<div class="ev-wrap">';
		echo '<a class="ev-skip" href="#ev-main">К дашборду</a>';
		self::head( $range, $type, $q );
		if ( '' !== $notice ) {
			echo '<div class="ev-toast" role="status">' . esc_html( urldecode( $notice ) ) . '</div>';
		}
		echo '<div id="ev-main">';
		self::live_strip();
		if ( '' !== $session ) { self::session_view( $session ); }
		elseif ( '' !== $device ) { self::device_view( $device, $range ); }
		else { self::kpis( $range ); self::dashboard( $range, $q ); }
		echo '</div>';
		self::settings();
		echo '</div>';
	}

	private static function head( $range, $type, $q ) {
		echo '<div class="ev-head"><div class="ev-head__left">';
		echo '<h1>Энерго · статистика</h1>';
		echo '<div class="ev-head__meta"><span data-ev-updated>обновлено ' . esc_html( current_time( 'H:i:s' ) ) . '</span> · ' . esc_html( $range->label() ) . ' · МСК</div>';
		echo '</div><div class="ev-head__actions">';
		$presets = array( 'today' => 'Сегодня', 'yesterday' => 'Вчера', '7d' => '7 дней', '30d' => '30 дней', 'all' => 'Всё время' );
		echo '<div class="ev-presets">';
		foreach ( $presets as $key => $label ) {
			echo '<a class="' . ( $range->preset === $key ? 'active' : '' ) . '" href="' . esc_url( add_query_arg( array( 'page' => 'energo-visits', 'preset' => $key, 'q' => $q ), admin_url( 'admin.php' ) ) ) . '">' . esc_html( $label ) . '</a>';
		}
		echo '</div></div></div>';
		self::filters( $range, $q );
	}

	private static function filters( $range, $q ) {
		echo '<form method="get" action="' . esc_url( admin_url( 'admin.php' ) ) . '" class="ev-filters">';
		echo '<input type="hidden" name="page" value="energo-visits">';
		echo '<label>С <input type="date" name="from" value="' . esc_attr( $range->from_local ) . '"></label>';
		echo '<label>По <input type="date" name="to" value="' . esc_attr( $range->to_local ) . '"></label>';
		echo '<label>Поиск <input type="text" name="q" maxlength="100" value="' . esc_attr( $q ) . '" placeholder="ID, город, браузер"></label>';
		echo '<button class="ev-btn" type="submit">Применить</button>';
		echo '</form>';
	}

	private static function live_strip() {
		$rows = EV_Dashboard::online_devices();
		if ( ! $rows ) { return; }
		echo '<div class="ev-live" role="status"><span class="ev-live__dot"></span><strong><span data-ev-live="count">' . count( $rows ) . '</span> на сайте</strong>';
		$shown = 0;
		foreach ( $rows as $d ) {
			if ( $shown++ >= 4 ) { break; }
			echo '<span class="ev-chip">' . esc_html( trim( $d->browser . ' · ' . $d->city, ' ·' ) ) . '</span>';
		}
		echo '<span class="ev-live__ago" data-ev-live="ago">обновлено только что</span></div>';
	}

	private static function kpis( $range ) {
		$k = EV_Dashboard::kpi( $range );
		$items = array(
			array( 'Онлайн', $k['online'], 'online' ),
			array( 'Заходы', $k['session_ids'], '' ),
			array( 'Устройства', $k['unique_devices'], '' ),
			array( 'События', $k['events'], '' ),
			array( 'Действия', $k['clicks'], '' ),
			array( 'Поиски', $k['searches'], '' ),
		);
		echo '<div class="ev-kpis">';
		foreach ( $items as $it ) { self::kpi_card( $it[0], $it[1], null, true, $it[2] ); }
		echo '</div>';
	}

	private static function kpi_card( $label, $value, $delta, $good_direction, $class = '' ) {
		echo '<div class="ev-kpi ' . esc_attr( $class ) . '" role="group" aria-label="' . esc_attr( $label ) . '">';
		echo '<span class="ev-kpi__label">' . esc_html( $label ) . '</span>';
		echo '<strong class="ev-kpi__value" ' . ( 'online' === $label ? 'data-ev-kpi="online"' : '' ) . ' title="' . esc_attr( (string) $value ) . '">' . esc_html( number_format( (float) $value, 0, ',', ' ' ) ) . '</strong>';
		if ( null !== $delta ) {
			$good = $good_direction ? $delta >= 0 : $delta <= 0;
			echo '<span class="ev-delta ' . ( $good ? 'is-good' : 'is-bad' ) . '">' . ( $delta >= 0 ? '↑' : '↓' ) . ' ' . abs( $delta ) . '%</span>';
		}
		echo '</div>';
	}

	private static function dashboard( $range, $q ) {
		self::devices_section( $range );
		self::sessions_section( $range );
	}

	private static function section_title( $icon, $title, $badge = '', $hint = '' ) {
		echo '<div class="ev-sec"><h2><span class="ev-sec__ico dashicons ' . esc_attr( $icon ) . '" aria-hidden="true"></span><span>' . esc_html( $title ) . '</span>';
		if ( '' !== $badge ) { echo '<span class="ev-sec__badge">' . esc_html( (string) $badge ) . '</span>'; }
		echo '</h2>';
		if ( '' !== $hint ) { echo '<p class="ev-sec__hint">' . esc_html( $hint ) . '</p>'; }
		echo '</div>';
	}

	private static function devices_section( $range ) {
		$devices = EV_Store::list_devices( $range->from_utc, $range->to_utc, self::param( 'q' ) );
		self::section_title( 'dashicons-devices', 'Устройства', count( $devices ), 'Нажмите карточку для подробностей' );
		if ( ! $devices ) { self::empty_state( 'range' ); return; }
		$stats = EV_Dashboard::device_stats( $range );
		echo '<div class="ev-devices">';
		foreach ( $devices as $d ) {
			$s = $stats[ $d->device_id ] ?? null;
			$url = self::url( array( 'device' => $d->device_id, 'session' => '', 'p' => '' ) );
			echo '<a class="ev-device" href="' . esc_url( $url ) . '">';
			echo '<div class="ev-device__top"><span class="ev-dot ' . ( self::online( $d->last_seen ) ? 'on' : '' ) . '"></span><strong>' . esc_html( $d->browser ) . '</strong></div>';
			echo '<div class="ev-device__sub">' . esc_html( $d->device_type . ' · ' . $d->os . ' · ' . ( self::online( $d->last_seen ) ? 'на сайте' : 'не на сайте' ) ) . '</div>';
			echo '<div class="ev-device__geo">' . esc_html( trim( $d->country . ', ' . $d->city, ', ' ) ) . ( (int) $d->is_vpn ? ' · VPN' : '' ) . '</div>';
			echo '<div class="ev-device__ip">' . esc_html( self::ip_view( $d->ip ) ) . '</div>';
			echo '<div class="ev-device__metrics">';
			echo '<span><b>' . (int) ( $s ? $s->sessions : 0 ) . '</b> заходов</span>';
			echo '<span><b>' . esc_html( self::duration( $s ? $s->seconds : 0 ) ) . '</b> на сайте</span>';
			echo '<span><b>' . (int) ( $s ? $s->clicks : 0 ) . '</b> действий</span>';
			echo '<span><b>' . (int) ( $s ? $s->searches : 0 ) . '</b> поисков</span>';
			echo '</div>';
			echo '<div class="ev-device__foot">Последняя активность: ' . esc_html( self::msk( $d->last_seen ) ) . '</div></a>';
		}
		echo '</div>';
	}

	private static function sessions_section( $range, $device_id = '' ) {
		$total = EV_Dashboard::sessions_count( $range, $device_id );
		$rows = EV_Dashboard::sessions( $range, 100, 0, $device_id );
		self::section_title( 'dashicons-images-alt2', 'Сессии', $total, 'Один заход = одна строка' );
		if ( ! $rows ) { self::empty_state( 'range' ); return; }
		echo '<div class="ev-table-wrap"><table class="ev-table ev-sortable"><thead><tr>';
		foreach ( array( 'Начало (МСК)', 'Устройство', 'Гео', 'Событий', 'Вкладок', 'Кликов', 'Поиск', 'Длительность', '' ) as $i => $label ) {
			echo '<th ' . ( $i < 8 ? 'aria-sort="descending"' : '' ) . '>' . ( $i < 8 ? '<button data-sort="' . $i . '">' . esc_html( $label ) . '</button>' : '' ) . '</th>';
		}
		echo '</tr></thead><tbody>';
		foreach ( $rows as $s ) {
			$dur = strtotime( $s->last_ts ) - strtotime( $s->first_ts );
			$url = self::url( array( 'session' => $s->session_id, 'device' => '' ) );
			echo '<tr tabindex="0"><td data-value="' . esc_attr( $s->first_ts ) . '">' . esc_html( self::msk( $s->first_ts, 'd.m.Y H:i:s' ) ) . '</td>';
			echo '<td>' . esc_html( trim( $s->browser . ' · ' . $s->os, ' ·' ) ) . '<br><small>' . esc_html( substr( $s->device_id, 0, 13 ) . '…' ) . '</small></td>';
			echo '<td>' . esc_html( trim( $s->country . ', ' . $s->city, ', ' ) ) . '</td>';
			echo '<td data-value="' . (int) $s->events . '">' . (int) $s->events . '</td><td data-value="' . (int) $s->tabs . '">' . (int) $s->tabs . '</td>';
			echo '<td data-value="' . (int) $s->clicks . '">' . (int) $s->clicks . '</td><td data-value="' . (int) $s->searches . '">' . (int) $s->searches . '</td>';
			echo '<td data-value="' . $dur . '">' . esc_html( self::duration( $dur ) ) . '</td><td><a href="' . esc_url( $url ) . '">Открыть</a></td></tr>';
		}
		echo '</tbody></table><div class="ev-table__foot"><span>Показано ' . count( $rows ) . ' из ' . (int) $total . '</span></div></div>';
	}

	private static function viewed_section( $range ) {
		$items = EV_Store::viewed_items( $range->from_utc, $range->to_utc );
		self::section_title( 'dashicons-visibility', 'Что смотрели', '', 'Карточки предприятий, закупки, маркеры карты' );
		if ( ! $items ) { self::empty_state( 'range' ); return; }
		echo '<div class="ev-table-wrap"><table class="ev-table ev-sortable"><thead><tr>';
		foreach ( array( 'Объект', 'Тип', 'Просмотров', 'Устройств', 'Сессий', 'Последний' ) as $i => $label ) {
			echo '<th><button data-sort="' . $i . '">' . esc_html( $label ) . '</button></th>';
		}
		echo '</tr></thead><tbody>';
		foreach ( $items as $it ) {
			$kind = 'org_card' === $it->kind ? 'Организация' : ( 'tender_card' === $it->kind ? 'Закупка' : 'Карта' );
			$title = $it->title ? $it->title : $it->ref_id;
			$label = mb_substr( $title, 0, 90 );
			$cell = $it->url ? '<a href="' . esc_url( $it->url ) . '" target="_blank" rel="noopener noreferrer">' . esc_html( $label ) . '</a>' : esc_html( $label );
			echo '<tr><td>' . $cell . '<br><small>' . esc_html( $it->ref_id ) . '</small></td>';
			echo '<td>' . esc_html( $kind ) . '</td><td data-value="' . (int) $it->n . '">' . (int) $it->n . '</td>';
			echo '<td data-value="' . (int) $it->devices . '">' . (int) $it->devices . '</td><td data-value="' . (int) $it->sessions . '">' . (int) $it->sessions . '</td>';
			echo '<td>' . esc_html( self::msk( $it->last ) ) . '</td></tr>';
		}
		echo '</tbody></table><div class="ev-table__foot"><span>Показано ' . count( $items ) . ' · полные данные — в экспорте</span></div></div>';
	}

	private static function top_section( $range ) {
		$a = EV_Store::top_actions( $range->from_utc, $range->to_utc );
		echo '<div class="ev-grid2">';
		self::chips_block( 'dashicons-search', 'Поисковые слова', $a['searches'] );
		$clicks = array(); foreach ( $a['clicks'] as $k => $v ) { $clicks[ $k ] = $v['n']; }
		self::chips_block( 'dashicons-click', 'Нажатые элементы', $clicks );
		echo '</div>';
	}

	private static function tabs_section( $range ) {
		$tabs = EV_Dashboard::tabs( $range );
		self::section_title( 'dashicons-welcome-view-site', 'Вкладки и время' );
		if ( ! $tabs ) { self::empty_state( 'range' ); return; }
		$max = max( 1, (float) $tabs[0]->seconds );
		echo '<div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Вкладка</th><th>Время</th><th>Закрытий</th><th>Скролл</th><th>Просмотр</th><th>Устройств</th><th></th></tr></thead><tbody>';
		foreach ( $tabs as $t ) {
			echo '<tr><td>' . esc_html( self::tab_label( $t->tab ) ) . '</td><td>' . esc_html( self::duration( $t->seconds ) ) . '</td><td>' . (int) $t->closes . '</td>';
			echo '<td>' . (int) $t->scroll . '%</td><td>' . (int) $t->seen . '%</td><td>' . (int) $t->devices . '</td><td>' . self::bar( $t->seconds, $max ) . '</td></tr>';
		}
		echo '</tbody></table></div>';
	}

	private static function geo_section( $range ) {
		$geo = EV_Dashboard::geo( $range );
		$browsers = EV_Dashboard::browsers( $range );
		echo '<div class="ev-grid2"><div>';
		self::section_title( 'dashicons-location', 'География' );
		if ( ! $geo ) { self::empty_state( 'range' ); } else {
			$max = max( 1, (int) $geo[0]->n );
			foreach ( $geo as $g ) {
				echo '<div class="ev-bar-row"><span>' . esc_html( trim( $g->country . ' · ' . $g->city . ' · ' . self::clean_isp( $g->isp ), ' ·' ) ) . '</span>' . self::bar( (int) $g->n, $max ) . '<b>' . (int) $g->n . '</b></div>';
			}
		}
		echo '</div><div>';
		self::section_title( 'dashicons-desktop', 'Устройства и браузеры' );
		if ( ! $browsers ) { self::empty_state( 'range' ); } else {
			$max = max( 1, (int) $browsers[0]->n );
			foreach ( $browsers as $b ) {
				echo '<div class="ev-bar-row"><span>' . esc_html( $b->device_type . ' · ' . $b->os . ' · ' . $b->browser ) . '</span>' . self::bar( (int) $b->n, $max ) . '<b>' . (int) $b->n . '</b></div>';
			}
		}
		echo '</div></div>';
	}

	private static function log_section( $range, $type, $q ) {
		$total = EV_Dashboard::log_count( $range, $type, $q );
		$rows = EV_Dashboard::log( $range, $type, $q, 100, 0 );
		self::section_title( 'dashicons-list-view', 'Последние события', $total );
		if ( ! $rows ) { self::empty_state( $type || $q ? 'filter' : 'range' ); return; }
		self::events_table( $rows );
		echo '<div class="ev-table__foot"><span>Показано ' . count( $rows ) . ' из ' . (int) $total . '</span><a target="_blank" rel="noopener" href="' . esc_url( add_query_arg( array( 'action' => 'ev_export', '_wpnonce' => wp_create_nonce( 'ev_admin_export' ), 'from' => $range->from_local, 'to' => $range->to_local, 'type' => $type, 'q' => $q, 'format' => 'csv' ), admin_url( 'admin-post.php' ) ) ) . '">Экспортировать всё →</a></div>';
	}

	private static function device_view( $device_id, $range ) {
		$d = EV_Store::get_device( $device_id );
		echo '<p><a class="ev-btn" href="' . esc_url( self::url( array( 'device' => '', 'session' => '' ) ) ) . '">← Все устройства</a></p>';
		if ( ! $d ) { self::empty_state( 'filter' ); return; }
		$stats = EV_Dashboard::device_stats( $range );
		$s = $stats[ $device_id ] ?? null;
		self::section_title( 'dashicons-devices', trim( $d->browser . ' · ' . $d->os . ' · ' . $d->device_type, ' ·' ), '',
			( self::online( $d->last_seen ) ? 'на сайте · ' : '' ) . 'первый заход ' . self::msk( $d->first_seen ) . ' · последняя активность ' . self::msk( $d->last_seen ) );

		echo '<div class="ev-kpis ev-kpis--device">';
		self::kpi_card( 'Заходов', (int) ( $s ? $s->sessions : 0 ), null, true, '' );
		self::kpi_card( 'На сайте', self::duration( $s ? $s->seconds : 0 ), null, true, '' );
		self::kpi_card( 'Действий', (int) ( $s ? $s->clicks : 0 ), null, true, '' );
		self::kpi_card( 'Поисков', (int) ( $s ? $s->searches : 0 ), null, true, '' );
		echo '</div>';

		$first = json_decode( (string) $d->first_payload, true ); if ( ! is_array( $first ) ) { $first = array(); }
		echo '<div class="ev-chips">';
		self::chip( 'IP', self::ip_view( $d->ip ) ); self::chip( 'Гео', trim( $d->country . ', ' . $d->city . ' · ' . self::clean_isp( $d->isp ), ', ' ) );
		self::chip( 'Hard ID', $d->hard_id ); self::chip( 'Экран', self::screen_text( $first ) ); self::chip( 'Сеть', self::network_text( $first ) );
		self::chip( 'Язык', self::json_field( $first, 'language' ) ); self::chip( 'Пояс', self::json_field( $first, 'timezoneOffset' ) . ' мин' );
		self::chip( 'Referrer', self::json_field( $first, 'referrer' ) ); self::chip( 'UTM', self::utm_text( $first ) );
		echo '</div>';

		$actions = EV_Store::top_actions( $range->from_utc, $range->to_utc, 15, $device_id );
		$clicks = array(); foreach ( $actions['clicks'] as $k => $n ) { $clicks[ $k ] = (int) $n; }
		echo '<div class="ev-grid2">';
		self::chips_block( 'dashicons-search', 'Искал', $actions['searches'] );
		self::chips_block( 'dashicons-click', 'Нажимал', $clicks );
		echo '</div>';

		$this_tabs = array(); $maxsec = 1;
		foreach ( EV_Store::device_events( $device_id, 500 ) as $ev ) {
			$data = json_decode( (string) $ev->payload, true );
			if ( ! is_array( $data ) || 'tab' !== $ev->type || ( $data['action'] ?? '' ) !== 'close' ) { continue; }
			$tab = (string) ( $data['tab'] ?? '' ); if ( '' === $tab ) { continue; }
			if ( ! isset( $this_tabs[ $tab ] ) ) { $this_tabs[ $tab ] = 0; }
			$this_tabs[ $tab ] += (float) ( $data['seconds'] ?? 0 );
			$maxsec = max( $maxsec, $this_tabs[ $tab ] );
		}
		if ( $this_tabs ) {
			self::section_title( 'dashicons-welcome-view-site', 'Вкладки этого устройства' );
			arsort( $this_tabs );
			foreach ( $this_tabs as $tab => $sec ) {
				echo '<div class="ev-bar-row"><span>' . esc_html( self::tab_label( $tab ) ) . '</span>' . self::bar( $sec, $maxsec ) . '<b>' . esc_html( self::duration( $sec ) ) . '</b></div>';
			}
		}

		$viewed = EV_Store::viewed_items( $range->from_utc, $range->to_utc, 50, $device_id );
		if ( $viewed ) {
			self::section_title( 'dashicons-visibility', 'Открывал карточки и закупки' );
			echo '<div class="ev-chips">';
			foreach ( $viewed as $it ) {
				$label = $it->title ? mb_substr( $it->title, 0, 70 ) : $it->ref_id;
				if ( $it->url ) { echo '<a class="ev-chip" href="' . esc_url( $it->url ) . '" target="_blank" rel="noopener noreferrer">' . esc_html( $label ) . ' <b>' . (int) $it->n . '</b></a> '; }
				else { echo '<span class="ev-chip">' . esc_html( $label ) . ' <b>' . (int) $it->n . '</b></span> '; }
			}
			echo '</div>';
		}

		self::sessions_section( $range, $device_id );

		self::section_title( 'dashicons-list-view', 'История событий устройства' );
		self::events_table( EV_Store::device_events( $device_id, 200 ), true );
		self::delete_form( 'ev_delete_device', 'device_id', $device_id, 'Удалить устройство', 'Удалить устройство и все его события?' );
	}

	private static function session_view( $session_id ) {
		global $wpdb;
		$s = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . EV_Store::prefix() . 'sessions WHERE session_id = %s', $session_id ) );
		echo '<p><a class="ev-btn" href="' . esc_url( self::url( array( 'session' => '' ) ) ) . '">← Все сессии</a></p>';
		if ( ! $s ) { self::empty_state( 'filter' ); return; }
		self::section_title( 'dashicons-images-alt2', 'Сессия', (int) $s->events, self::msk( $s->first_ts, 'd.m.Y H:i:s' ) . ' — ' . self::msk( $s->last_ts, 'H:i:s' ) . ' · ' . self::duration( strtotime( $s->last_ts ) - strtotime( $s->first_ts ) ) );
		echo '<div class="ev-chips">';
		self::chip( 'Устройство', trim( $s->browser . ' · ' . $s->os . ' · ' . $s->device_type, ' ·' ) );
		self::chip( 'Гео', trim( $s->country . ', ' . $s->city, ', ' ) );
		self::chip( 'ID', $s->session_id );
		echo '</div>';
		$events = EV_Dashboard::session_events( $session_id, 200 );
		if ( $events ) {
			echo '<ol class="ev-timeline">';
			foreach ( $events as $ev ) {
				$data = json_decode( (string) $ev->payload, true ); if ( ! is_array( $data ) ) { $data = array(); }
				echo '<li><time>' . esc_html( self::msk( $ev->event_ts, 'H:i:s' ) ) . '</time><b>' . esc_html( self::event_label( $ev->type, $data ) ) . '</b><br><small>' . esc_html( self::event_detail( $ev->type, $data ) ) . '</small></li>';
			}
			echo '</ol>';
		}
		self::delete_form( 'ev_delete_session', 'session_id', $session_id, 'Удалить сессию', 'Удалить все события этой сессии?' );
	}

	private static function events_table( $rows, $device_view = false ) {
		if ( ! $rows ) { self::empty_state( 'filter' ); return; }
		$head = $device_view
			? '<th>Время (МСК)</th><th>Событие</th><th>Подробности</th><th>Сессия</th>'
			: '<th>Время (МСК)</th><th>Событие</th><th>Подробности</th><th>Устройство / IP</th>';
		echo '<div class="ev-table-wrap"><table class="ev-table"><thead><tr>' . $head . '</tr></thead><tbody>';
		foreach ( $rows as $ev ) {
			$data = json_decode( (string) $ev->payload, true ); if ( ! is_array( $data ) ) { $data = array(); }
			echo '<tr><td>' . esc_html( self::msk( $ev->event_ts, 'd.m.Y H:i:s' ) ) . '</td><td>' . esc_html( self::event_label( $ev->type, $data ) ) . '</td>';
			echo '<td><code>' . esc_html( self::event_detail( $ev->type, $data ) ) . '</code></td>';
			if ( $device_view ) {
				$url = self::url( array( 'session' => $ev->session_id, 'device' => '' ) );
				echo '<td><a href="' . esc_url( $url ) . '">' . esc_html( substr( $ev->session_id, 0, 8 ) . '…' ) . '</a></td>';
			} else {
				echo '<td>' . esc_html( substr( $ev->device_id, 0, 13 ) . '…' ) . '<br><small>' . esc_html( self::ip_view( $ev->ip ) . ( $ev->city ? ' · ' . $ev->city : '' ) ) . '</small></td>';
			}
			echo '</tr>';
		}
		echo '</tbody></table></div>';
	}

	private static function empty_state( $kind ) {
		$map = array(
			'range' => array( 'Нет событий за выбранный период', 'Расширьте диапазон или сбросьте фильтры', 'Сбросить период' ),
			'filter' => array( 'Под фильтр ничего не подошло', 'Уберите тип события или поисковый запрос', 'Сбросить фильтры' ),
			'new' => array( 'Заходов пока нет', 'Данные появятся после первого визита', 'Обновить' ),
		);
		$m = $map[ $kind ] ?? $map['range'];
		echo '<div class="ev-empty" role="status"><span class="dashicons dashicons-chart-area" aria-hidden="true" style="font-size:28px;width:auto;height:auto"></span>';
		echo '<h3>' . esc_html( $m[0] ) . '</h3><p>' . esc_html( $m[1] ) . '</p>';
		echo '<a class="ev-btn" href="' . esc_url( self::url( array( 'from' => '', 'to' => '', 'preset' => '7d', 'type' => '', 'q' => '', 'device' => '', 'session' => '' ) ) ) . '">' . esc_html( $m[2] ) . '</a></div>';
	}

	private static function settings() {
		$o = ev_options();
		echo '<details><summary>Настройки и обслуживание данных</summary>';
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( 'ev_admin_save_settings' );
		echo '<input type="hidden" name="action" value="ev_save_settings">';
		echo '<table class="form-table"><tbody>';
		self::field( 'Разрешённый Origin', '<textarea name="allowed_origins" rows="2" class="large-text code">' . esc_textarea( $o['allowed_origins'] ) . '</textarea><span class="ev-help">Точное совпадение: <code>https://alexsmy.github.io</code></span>' );
		self::field( 'Разрешённый URL страницы', '<input type="text" class="regular-text" name="allowed_page" value="' . esc_attr( $o['allowed_page'] ) . '"><span class="ev-help">Префикс <code>/energo/</code> принимает и <code>/energo/index.html</code>, и <code>/energo/</code>.</span>' );
		self::field( 'Telegram: токен', '<input type="password" class="regular-text" name="tg_token" value="" autocomplete="off" placeholder="•••••••• (не задан/оставить текущий)"><span class="ev-help">Оставьте пустым, чтобы не менять сохранённый токен.</span>' );
		self::field( 'Telegram: chat_id', '<input type="text" class="regular-text" name="tg_chat" value="' . esc_attr( $o['tg_chat'] ) . '">' );
		self::field( 'Проверять TLS Telegram', '<label><input type="checkbox" name="tg_sslverify" value="1" ' . checked( (int) $o['tg_sslverify'], 1, false ) . '> да (рекомендуется)</label>' );
		self::field( 'Уведомлять о новых устройствах', '<label><input type="checkbox" name="tg_notify_new" value="1" ' . checked( (int) $o['tg_notify_new'], 1, false ) . '> да</label>' );
		self::field( 'Ежедневная сводка', '<label><input type="checkbox" name="tg_digest" value="1" ' . checked( (int) $o['tg_digest'], 1, false ) . '> да</label>' );
		self::field( 'Показывать полный IP', '<label><input type="checkbox" name="show_full_ip" value="1" ' . checked( (int) $o['show_full_ip'], 1, false ) . '> да (по умолчанию маска)</label>' );
		self::field( 'Доверять X-Forwarded-For', '<label><input type="checkbox" name="trust_proxy" value="1" ' . checked( (int) $o['trust_proxy'], 1, false ) . '> только если перед PHP reverse proxy</label>' );
		self::field( 'Запросов в минуту с IP', '<input type="number" min="1" max="1000" name="rate_per_minute" value="' . (int) $o['rate_per_minute'] . '">' );
		self::field( 'Новых устройств в минуту (Telegram)', '<input type="number" min="0" max="100" name="new_devices_per_minute" value="' . (int) $o['new_devices_per_minute'] . '"><span class="ev-help">Ограничение уведомлений при массовых поддельных событиях.</span>' );
		self::field( 'Хранить событий, дней', '<input type="number" min="1" max="3650" name="retention_days" value="' . (int) $o['retention_days'] . '">' );
		$err = EV_Telegram::last_error(); if ( '' !== $err ) { self::field( 'Ошибка Telegram', '<span style="color:var(--ev-danger)">' . esc_html( mb_substr( $err, 0, 200 ) ) . '</span>' ); }
		echo '</tbody></table><button class="ev-btn" type="submit">Сохранить</button></form>';

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-top:10px">';
		wp_nonce_field( 'ev_admin_test_tg' );
		echo '<input type="hidden" name="action" value="ev_test_tg"><button class="ev-btn" type="submit">Проверить Telegram</button></form>';

		echo '<h3>Обслуживание</h3>';
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( 'ev_admin_cleanup' );
		echo '<input type="hidden" name="action" value="ev_cleanup">';
		echo '<label class="ev-head__meta">Удалить до даты <input type="date" name="before" value="' . esc_attr( gmdate( 'Y-m-d', time() - 90 * DAY_IN_SECONDS ) ) . '"></label> ';
		echo '<button class="ev-btn" type="submit">Удалить старые</button> ';
		echo '<button class="ev-btn" type="submit" name="scope" value="all" onclick="return confirm(\'Удалить ВСЮ статистику?\')">Удалить всё</button></form>';

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-top:8px">';
		wp_nonce_field( 'ev_admin_sync_refs' );
		echo '<input type="hidden" name="action" value="ev_sync_refs"><button class="ev-btn" type="submit">Обновить справочник названий</button></form>';
		echo '<p class="ev-head__meta">Событий: ' . EV_Store::count_events() . ' · Устройств: ' . EV_Store::unique_devices_count() . '</p>';
		echo '</details>';
	}

	private static function delete_form( $action, $field, $value, $label, $confirm ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-top:12px">';
		wp_nonce_field( 'ev_admin_' . $action );
		echo '<input type="hidden" name="action" value="' . esc_attr( $action ) . '"><input type="hidden" name="' . esc_attr( $field ) . '" value="' . esc_attr( $value ) . '">';
		echo '<button class="ev-btn" type="submit" onclick="return confirm(\'' . esc_js( $confirm ) . '\')">' . esc_html( $label ) . '</button></form>';
	}

	private static function field( $label, $control ) { echo '<tr><th>' . esc_html( $label ) . '</th><td>' . $control . '</td></tr>'; // phpcs:ignore WordPress.Security.EscapeOutput
	}
	private static function chip( $label, $value ) { if ( '' === (string) $value ) { return; } echo '<span class="ev-chip"><b>' . esc_html( $label ) . ':</b> ' . esc_html( (string) $value ) . '</span> '; }
	private static function chips_block( $icon, $title, $items ) {
		echo '<div><h2><span class="dashicons ' . esc_attr( $icon ) . '" aria-hidden="true"></span> ' . esc_html( $title ) . '</h2><div class="ev-chips">';
		foreach ( $items as $k => $n ) { echo '<span class="ev-chip">' . esc_html( mb_substr( (string) $k, 0, 70 ) ) . ' <b>' . (int) $n . '</b></span> '; }
		if ( ! $items ) { echo '<p class="ev-head__meta">Нет данных.</p>'; }
		echo '</div></div>';
	}
	private static function bar( $value, $max ) { return '<span class="ev-bar"><i style="width:' . (int) max( 2, round( (float) $value / max( 1, $max ) * 100 ) ) . '%"></i></span>'; }
	private static function tab_label( $tab ) {
		$map = array( 'registry'=>'Реестр','tenders'=>'Закупки','map'=>'Карты','all'=>'Все' );
		$parts = explode( ':', (string) $tab ); $label = $map[ $parts[0] ] ?? $parts[0];
		$suffix = array( 'table'=>'таблица','cards'=>'карточки','etps'=>'аудит ЭТП' );
		if ( isset( $parts[1], $suffix[ $parts[1] ] ) ) { $label .= ' · ' . $suffix[ $parts[1] ]; }
		return $label;
	}
	private static function event_label( $type, $data ) {
		if ( 'session' === $type ) { return 'Новое устройство / заход'; }
		if ( 'fingerprint' === $type ) { return 'Отпечаток устройства'; }
		if ( 'heartbeat' === $type ) { return 'Активность'; }
		if ( 'tab' === $type ) { return ( $data['action'] ?? '' ) === 'close' ? 'Время во вкладке' : 'Открытие вкладки'; }
		if ( 'click' === $type ) {
			$map = array( 'tab'=>'Клик по вкладке','button'=>'Нажата кнопка','org_card'=>'Карточка организации','tender_card'=>'Карточка закупки','map_marker'=>'Маркер карты' );
			return $map[ (string) ( $data['kind'] ?? '' ) ] ?? 'Клик';
		}
		if ( 'search' === $type ) { return 'chip' === ( $data['source'] ?? '' ) ? 'Поиск: чип' : 'Поиск: ввод'; }
		if ( 'link' === $type ) {
			$map = array( 'tel'=>'Звонок','mailto'=>'Письмо','download'=>'Скачивание','external'=>'Внешняя ссылка' );
			return $map[ (string) ( $data['kind'] ?? '' ) ] ?? 'Ссылка';
		}
		return $type;
	}
	private static function event_detail( $type, $data ) {
		unset( $data['type'],$data['ts'],$data['sessionId'],$data['deviceId'],$data['eid'],$data['userAgent'],$data['screen'],$data['network'],$data['utm'] );
		if ( 'search' === $type ) { return (string) ( $data['query'] ?? '' ); }
		if ( 'tab' === $type ) { return self::tab_label( (string) ( $data['tab'] ?? '' ) ) . ' · ' . self::duration( (float) ( $data['seconds'] ?? 0 ) ) . ' · скролл ' . (int) ( $data['maxScroll'] ?? 0 ) . '%'; }
		if ( 'click' === $type ) { return (string) ( $data['label'] ?? $data['id'] ?? $data['kind'] ?? '' ); }
		if ( 'link' === $type ) { return (string) ( $data['href'] ?? $data['kind'] ?? '' ); }
		return wp_json_encode( $data, JSON_UNESCAPED_UNICODE );
	}
	private static function duration( $seconds ) {
		$s = (int) round( (float) $seconds );
		if ( $s < 60 ) { return $s . ' с'; }
		$m = intdiv( $s, 60 ); if ( $m < 60 ) { return $m . ' мин ' . ( $s % 60 ) . ' с'; }
		return intdiv( $m, 60 ) . ' ч ' . ( $m % 60 ) . ' мин';
	}
	private static function screen_text( $first ) {
		$s = $first['screen'] ?? array(); if ( ! is_array( $s ) || ! isset( $s['width'] ) ) { return ''; }
		return (int) $s['width'] . '×' . (int) $s['height'] . ' (видимая ' . (int) ( $s['availWidth'] ?? 0 ) . '×' . (int) ( $s['availHeight'] ?? 0 ) . ', DPR ' . (string) ( $s['dpr'] ?? 1 ) . ')';
	}
	private static function clean_isp( $isp ) {
		$isp = trim( (string) $isp );
		$isp = preg_replace( '/\s+AS\d+.*$/i', '', $isp );
		$parts = preg_split( '/[\s,]+/u', $isp );
		$seen = array(); $out = array();
		foreach ( $parts as $p ) {
			$key = mb_strtolower( trim( $p, '\"' ) );
			if ( '' === $key || isset( $seen[ $key ] ) ) { continue; }
			$seen[ $key ] = 1; $out[] = $p;
		}
		return implode( ' ', $out );
	}
	private static function utm_text( $first ) {
		$u = $first['utm'] ?? array();
		if ( ! is_array( $u ) ) { return ''; }
		$parts = array();
		foreach ( array( 'source', 'medium', 'campaign' ) as $k ) {
			if ( ! empty( $u[ $k ] ) ) { $parts[] = $k . ': ' . (string) $u[ $k ]; }
		}
		return implode( ' · ', $parts );
	}
	private static function network_text( $first ) {
		$n = $first['network'] ?? array(); if ( ! is_array( $n ) ) { return ''; }
		$p = array();
		if ( ! empty( $n['effectiveType'] ) ) { $p[] = (string) $n['effectiveType']; }
		if ( isset( $n['downlink'] ) ) { $p[] = 'downlink ' . (string) $n['downlink']; }
		if ( isset( $n['rtt'] ) ) { $p[] = 'rtt ' . (string) $n['rtt']; }
		return implode( ' · ', $p );
	}
	private static function json_field( $data, $key ) { return isset( $data[ $key ] ) ? ( is_scalar( $data[ $key ] ) ? (string) $data[ $key ] : wp_json_encode( $data[ $key ] ) ) : ''; }

	private static function redirect( $notice = '' ) {
		$args = array( 'page' => 'energo-visits' );
		if ( '' !== $notice ) { $args['ev_notice'] = urlencode( $notice ); }
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}

	public static function save_settings() {
		self::ensure_cap(); check_admin_referer( 'ev_admin_save_settings' );
		$o = ev_options();
		$o['allowed_origins'] = isset( $_POST['allowed_origins'] ) ? sanitize_textarea_field( wp_unslash( $_POST['allowed_origins'] ) ) : $o['allowed_origins'];
		$o['allowed_page'] = isset( $_POST['allowed_page'] ) ? esc_url_raw( wp_unslash( $_POST['allowed_page'] ) ) : $o['allowed_page'];
		$o['rate_per_minute'] = isset( $_POST['rate_per_minute'] ) ? max( 1, min( 1000, (int) $_POST['rate_per_minute'] ) ) : $o['rate_per_minute'];
		$o['new_devices_per_minute'] = isset( $_POST['new_devices_per_minute'] ) ? max( 0, min( 100, (int) $_POST['new_devices_per_minute'] ) ) : $o['new_devices_per_minute'];
		$o['retention_days'] = isset( $_POST['retention_days'] ) ? max( 1, min( 3650, (int) $_POST['retention_days'] ) ) : $o['retention_days'];
		foreach ( array( 'geo_enabled','tg_notify_new','tg_digest','tg_sslverify','show_full_ip','trust_proxy' ) as $k ) { $o[ $k ] = isset( $_POST[ $k ] ) ? 1 : 0; }
		$o['tg_chat'] = isset( $_POST['tg_chat'] ) ? sanitize_text_field( wp_unslash( $_POST['tg_chat'] ) ) : $o['tg_chat'];
		if ( ! empty( $_POST['tg_token'] ) ) { $o['tg_token'] = sanitize_text_field( wp_unslash( $_POST['tg_token'] ) ); }
		update_option( 'ev_settings', $o );
		self::redirect( 'Настройки сохранены' );
	}

	public static function cleanup() {
		self::ensure_cap(); check_admin_referer( 'ev_admin_cleanup' );
		$scope = isset( $_POST['scope'] ) && 'all' === $_POST['scope'] ? 'all' : 'before';
		EV_Store::cleanup( $scope, isset( $_POST['before'] ) ? sanitize_text_field( wp_unslash( $_POST['before'] ) ) : '' );
		self::redirect( 'Данные очищены' );
	}

	public static function delete_device() {
		self::ensure_cap(); check_admin_referer( 'ev_admin_delete_device' );
		$id = isset( $_POST['device_id'] ) ? sanitize_text_field( wp_unslash( $_POST['device_id'] ) ) : '';
		if ( '' !== $id ) { EV_Store::delete_device( $id ); }
		self::redirect( 'Устройство удалено' );
	}

	public static function delete_session() {
		self::ensure_cap(); check_admin_referer( 'ev_admin_delete_session' );
		$id = isset( $_POST['session_id'] ) ? sanitize_text_field( wp_unslash( $_POST['session_id'] ) ) : '';
		if ( '' !== $id ) {
			global $wpdb;
			$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . EV_Store::prefix() . 'events WHERE session_id = %s', $id ) );
			EV_Store::rebuild_sessions();
		}
		self::redirect( 'Сессия удалена' );
	}

	public static function sync_refs() {
		self::ensure_cap(); check_admin_referer( 'ev_admin_sync_refs' );
		$n = EV_Store::sync_refs();
		self::redirect( $n ? 'Справочник обновлён: ' . (int) $n . ' записей' : 'Справочник не обновлён: источники недоступны' );
	}

	public static function test_tg() {
		self::ensure_cap(); check_admin_referer( 'ev_admin_test_tg' );
		$ok = EV_Telegram::send( '<b>Energo Visits</b>: тест соединения с ботом.', true );
		self::redirect( $ok ? 'Тестовое сообщение отправлено' : 'Ошибка Telegram: ' . EV_Telegram::last_error() );
	}

	/* Excel и Google Sheets читают ячейки, начинающиеся с = + - @, как формулы. */
	private static function csv_cell( $value ) {
		$s = (string) $value;
		return preg_match( '/^[=+\-@\t\r]/', $s ) ? "'" . $s : $s;
	}

	public static function export() {
		self::ensure_cap(); check_admin_referer( 'ev_admin_export' );
		$range = EV_Range::from_request();
		$type = self::param( 'type' ); $q = self::param( 'q' );
		$rows = EV_Dashboard::export_rows( $range, $type, $q );
		$format = isset( $_GET['format'] ) && 'json' === $_GET['format'] ? 'json' : 'csv';
		nocache_headers();
		if ( 'json' === $format ) {
			header( 'Content-Type: application/json; charset=utf-8' );
			header( 'Content-Disposition: attachment; filename="energo-visits_' . $range->from_local . '_' . $range->to_local . '.json"' );
			echo wp_json_encode( $rows );
		} else {
			header( 'Content-Type: text/csv; charset=utf-8' );
			header( 'Content-Disposition: attachment; filename="energo-visits_' . $range->from_local . '_' . $range->to_local . '.csv"' );
			$out = fopen( 'php://output', 'w' );
			fwrite( $out, "\xEF\xBB\xBF" );
			fputcsv( $out, array( 'event_ts_utc', 'event_ts_msk', 'type', 'event', 'session_id', 'device_id', 'ip', 'country', 'city' ), ';' );
			foreach ( $rows as $row ) {
				$data = json_decode( (string) $row->payload, true ); if ( ! is_array( $data ) ) { $data = array(); }
				$cells = array( $row->event_ts, self::msk( $row->event_ts, 'Y-m-d H:i:s' ), $row->type, self::event_detail( $row->type, $data ), $row->session_id, $row->device_id, self::ip_view( $row->ip ), $row->country, $row->city );
			fputcsv( $out, array_map( array( __CLASS__, 'csv_cell' ), $cells ), ';' );
			}
			fclose( $out );
		}
		exit;
	}
}
