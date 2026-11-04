/*
===========================================================================
lean-log-ui.js - filters, reading controls and explicit local export

Both views share filters while retaining independent scroll/pause state.
Export requires a reviewed preview and never uses the report upload endpoint.
===========================================================================
*/

/*
================
UI.activityPanel
================
*/
UI.activityPanel = function( log, label ) {
	const panel = el( "div", null, "activity-panel" ), controls = el( "div", null, "row" );
	const select = ( name, entries, key ) => {
		const input = el( "select" );
		input.setAttribute( "aria-label", label + " log " + name );
		for ( const [ value, text ] of entries ) {
			const option = el( "option", text ); option.value = value; input.append( option );
		}
		input.value = Activity.filters[key];
		input.addEventListener( "change", () => { Activity.filters[key] = input.value; this.updateSession(); } );
		controls.append( input );
		return input;
	};
	const category = select( "category", [ [ "all", "All categories" ], ...ACTIVITY_CATEGORIES.map( key => [ key, key ] ) ], "category" );
	const level = select( "severity", [ [ "all", "All severities" ], [ "info", "Info" ], [ "warn", "Warnings" ], [ "error", "Errors" ], [ "cmd", "Commands" ] ], "level" );
	const search = el( "input" ); search.type = "search"; search.placeholder = "Search activity";
	search.setAttribute( "aria-label", label + " log search" );
	search.addEventListener( "input", () => { Activity.filters.search = search.value.slice( 0, 200 ); this.updateSession(); } );
	const detailed = el( "input" ); detailed.type = "checkbox";
	detailed.addEventListener( "change", () => { Activity.capture( detailed.checked ); this.updateSession(); } );
	const capture = this.field( label + " detailed capture (10 minutes)", detailed );
	const pause = this.button( "Pause log", () => {
		log.paused = !log.paused;
		pause.textContent = log.paused ? "Resume log" : "Pause log";
		this.renderActivity( log );
	} );
	pause.setAttribute( "aria-label", label + " pause or resume log" );
	const follow = this.button( "Follow latest", () => {
		log.paused = false; pause.textContent = "Pause log"; this.renderActivity( log ); log.scrollTop = log.scrollHeight;
	} );
	const clear = this.button( "Clear history", () => {
		if ( clear.armedUntil > now() ) {
			Activity.clear(); clear.armedUntil = 0; clear.textContent = "Clear history"; this.updateSession();
		} else { clear.armedUntil = now() + 5000; clear.textContent = "Confirm clear (5 s)"; }
	} );
	log.activityStatus = el( "span", "", "muted" );
	log.refreshControls = () => {
		category.value = Activity.filters.category; level.value = Activity.filters.level;
		if ( this.root.activeElement !== search ) search.value = Activity.filters.search;
		detailed.checked = Activity.filters.detailed;
		if ( clear.armedUntil && now() >= clear.armedUntil ) { clear.armedUntil = 0; clear.textContent = "Clear history"; }
	};
	panel.append( controls, search, capture, this.row( pause, follow, clear, this.button( "Export preview", () => this.showActivityExport() ) ), log.activityStatus, log );
	return panel;
};

/*
================
UI.showActivityExport
================
*/
UI.showActivityExport = function() {
	if ( !this.activityExportBox ) {
		const preview = this.activityExportText = el( "textarea" );
		preview.readOnly = true; preview.rows = 10; preview.setAttribute( "aria-label", "Activity export preview" );
		const raw = this.activityExportRaw = el( "input" ); raw.type = "checkbox";
		const format = el( "select" );
		for ( const type of [ "json", "text" ] ) { const option = el( "option", type ); option.value = type; format.append( option ); }
		const refresh = () => { preview.value = Activity.export( raw.checked, format.value ); };
		raw.addEventListener( "change", refresh ); format.addEventListener( "change", refresh );
		const download = this.button( "Download preview", () => {
			const url = URL.createObjectURL( new Blob( [ preview.value ], { type: format.value === "json" ? "application/json" : "text/plain" } ) );
			const link = el( "a" ); link.href = url; link.download = "bot-activity." + (format.value === "json" ? "json" : "txt");
			this.root.append( link ); link.click(); link.remove(); setTimeout( () => URL.revokeObjectURL( url ), 1000 );
		} );
		this.activityExportRefresh = refresh;
		this.activityExportBox = this.windowFrame( "Activity export", () => { this.activityExportBox.hidden = true; },
			el( "p", "Standard export omits message text, names and locations. It includes retained refusal diagnostics even when filters hide them. Raw local export may contain private details. Review before sharing. Nothing is uploaded.", "muted" ),
			this.field( "Include raw local messages", raw ), this.field( "Export format", format ), preview,
			this.row( this.button( "Refresh preview", refresh ), this.button( "Select preview to copy", () => { preview.focus(); preview.select(); } ), download ) );
		this.activityExportBox.classList.add( "activity-export" );
		this.root.append( this.activityExportBox );
		this.activityExportBox.style.left = "10px"; this.activityExportBox.style.top = "40px";
	}
	this.activityExportRaw.checked = false;
	this.activityExportBox.hidden = false; this.activityExportRefresh(); this.fitWindow( this.activityExportBox ); this.front( this.activityExportBox );
};
