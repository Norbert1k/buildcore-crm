*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --font: 'DM Sans', sans-serif;
  --mono: 'DM Mono', monospace;
  --bg: #F5F4F0;
  --surface: #FFFFFF;
  --surface2: #F5F4F0;
  --border: #E2E0D8;
  --border2: #C8C6BC;
  --text: #1C1B18;
  --text2: #5C5A54;
  --text3: #9C9A94;
  --accent: #1C1B18;
  --red: #A32D2D; --red-bg: #FCEBEB; --red-border: #F7C1C1;
  --amber: #854F0B; --amber-bg: #FAEEDA; --amber-border: #FAC775;
  --green: #3B6D11; --green-bg: #EAF3DE; --green-border: #C0DD97;
  --blue: #185FA5; --blue-bg: #E6F1FB; --blue-border: #B5D4F4;
  --purple: #3C3489; --purple-bg: #EEEDFE; --purple-border: #AFA9EC;
  --radius: 8px; --radius-lg: 12px;
  --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
}

html, body, #root { height: 100%; }
body { font-family: var(--font); background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

/* Forms */
input, select, textarea {
  font-family: var(--font); font-size: 13px; color: var(--text);
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 8px 10px; width: 100%;
  outline: none; transition: border .15s;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
input::placeholder { color: var(--text3); }
label { font-size: 12px; font-weight: 500; color: var(--text2); display: block; margin-bottom: 4px; }
textarea { resize: vertical; min-height: 80px; }

/* Buttons */
button { font-family: var(--font); cursor: pointer; border: none; outline: none; transition: all .15s; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--radius); font-size: 13px; font-weight: 500; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
.btn:hover { background: var(--surface2); border-color: var(--border2); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-primary:hover { background: #3a3830; }
.btn-danger { background: var(--red-bg); color: var(--red); border-color: var(--red-border); }
.btn-danger:hover { background: #F7C1C1; }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.btn-icon { padding: 6px; border-radius: var(--radius); }
button:disabled { opacity: .45; cursor: not-allowed; }

/* Cards */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.card-pad { padding: 20px; }

/* Badges / Pills */
.pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 500; }
.pill-green { background: var(--green-bg); color: var(--green); }
.pill-amber { background: var(--amber-bg); color: var(--amber); }
.pill-red { background: var(--red-bg); color: var(--red); }
.pill-blue { background: var(--blue-bg); color: var(--blue); }
.pill-purple { background: var(--purple-bg); color: var(--purple); }
.pill-gray { background: var(--surface2); color: var(--text2); border: 1px solid var(--border); }

/* Table */
.table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
th { font-size: 11px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: .06em; padding: 10px 16px; background: var(--surface2); border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
td { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: var(--surface2); }
.td-muted { color: var(--text2); font-size: 12px; }

/* Layout */
.app-layout { display: flex; height: 100vh; overflow: hidden; }
.sidebar { width: 232px; min-width: 232px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; }
.main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar { height: 56px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 24px; gap: 12px; flex-shrink: 0; }
.page-content { flex: 1; overflow-y: auto; padding: 24px; }

/* Sidebar nav */
.sidebar-logo { padding: 18px 16px 14px; border-bottom: 1px solid var(--border); }
.nav-section { font-size: 10px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: .1em; padding: 14px 16px 4px; }
.nav-item { display: flex; align-items: center; gap: 9px; padding: 8px 12px; margin: 1px 8px; border-radius: var(--radius); font-size: 13px; color: var(--text2); cursor: pointer; transition: all .15s; text-decoration: none; }
.nav-item:hover { background: var(--surface2); color: var(--text); }
.nav-item.active { background: var(--accent); color: #fff; font-weight: 500; }
.nav-item svg { width: 15px; height: 15px; flex-shrink: 0; }
.nav-badge { margin-left: auto; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600; background: var(--red-bg); color: var(--red); }
.nav-item.active .nav-badge { background: rgba(255,255,255,.2); color: #fff; }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
.modal { background: var(--surface); border-radius: var(--radius-lg); border: 1px solid var(--border); width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.15); }
.modal-sm { max-width: 440px; }
.modal-md { max-width: 580px; }
.modal-lg { max-width: 720px; }
.modal-header { padding: 20px 24px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.modal-title { font-size: 16px; font-weight: 600; }
.modal-body { padding: 20px 24px; }
.modal-footer { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }

/* Side panel */
.side-panel { position: fixed; right: 0; top: 0; width: 480px; height: 100vh; background: var(--surface); border-left: 1px solid var(--border); z-index: 150; display: flex; flex-direction: column; transform: translateX(100%); transition: transform .25s cubic-bezier(.4,0,.2,1); box-shadow: -4px 0 24px rgba(0,0,0,.08); }
.side-panel.open { transform: translateX(0); }
.panel-header { padding: 18px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.panel-body { flex: 1; overflow-y: auto; padding: 20px; }
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.2); z-index: 140; opacity: 0; pointer-events: none; transition: opacity .25s; }
.backdrop.open { opacity: 1; pointer-events: all; }

/* Form grid */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-grid .full { grid-column: 1 / -1; }
.form-section { font-size: 12px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: .07em; padding-top: 6px; border-top: 1px solid var(--border); margin-top: 4px; grid-column: 1 / -1; }

/* Stats row */
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
.stat-card { background: var(--surface2); border-radius: var(--radius); padding: 14px 16px; }
.stat-label { font-size: 11px; color: var(--text3); font-weight: 500; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
.stat-value { font-size: 26px; font-weight: 600; color: var(--text); line-height: 1; }
.stat-sub { font-size: 11px; color: var(--text3); margin-top: 3px; }
.stat-value.red { color: var(--red); }
.stat-value.amber { color: var(--amber); }
.stat-value.green { color: var(--green); }

/* Avatar */
.avatar { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0; }
.avatar-sm { width: 26px; height: 26px; font-size: 10px; }
.avatar-lg { width: 44px; height: 44px; font-size: 15px; }

/* Misc */
.divider { height: 1px; background: var(--border); margin: 16px 0; }
.text-muted { color: var(--text2); }
.text-sm { font-size: 12px; }
.flex { display: flex; }
.flex-center { display: flex; align-items: center; }
.gap-8 { gap: 8px; }
.gap-12 { gap: 12px; }
.flex-1 { flex: 1; }
.fw-500 { font-weight: 500; }
.fw-600 { font-weight: 600; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.section-title { font-size: 14px; font-weight: 600; }
.alert-item { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: var(--radius); margin-bottom: 6px; font-size: 13px; }
.alert-expired { background: var(--red-bg); border: 1px solid var(--red-border); color: var(--red); }
.alert-warning { background: var(--amber-bg); border: 1px solid var(--amber-border); color: var(--amber); }
.empty-state { text-align: center; padding: 48px 20px; color: var(--text3); font-size: 13px; }
.search-wrap { position: relative; }
.search-wrap input { padding-left: 32px; width: 240px; }
.search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text3); pointer-events: none; }
.filter-tabs { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
.filter-tab { padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text2); transition: all .15s; }
.filter-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.doc-status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.dot-green { background: var(--green); }
.dot-amber { background: var(--amber); }
.dot-red { background: var(--red); }
.dot-gray { background: var(--text3); }
