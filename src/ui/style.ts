// All UI styling, injected once as a <style> element. Class prefix: cf-
const CSS = String.raw`
.cf-root {
  --cf-accent: #ff8a2a;
  --cf-accent-rgb: 255,138,42;
  --cf-line: rgba(255,255,255,.09);
  --cf-line-2: rgba(255,255,255,.16);
  --cf-text: #ece9e2;
  --cf-dim: #8f98a1;
  --cf-good: #62d894;
  --cf-warn: #ffb62e;
  --cf-bad: #ff5148;
  --cf-credit: #ffc95c;
  --cf-panel-w: 258px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang TC", "Helvetica Neue", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
  font-size: 13px;
  line-height: 1.35;
  color: var(--cf-text);
  -webkit-user-select: none;
  user-select: none;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  font-variant-numeric: tabular-nums;
}
.cf-root *, .cf-root *::before, .cf-root *::after { box-sizing: border-box; }
.cf-root button { font: inherit; color: inherit; cursor: pointer; -webkit-appearance: none; appearance: none; }
.cf-root button:focus { outline: none; }
.cf-root button:focus-visible { outline: 1px solid rgba(var(--cf-accent-rgb), .9); outline-offset: 1px; }
.cf-root button:disabled { cursor: default; opacity: .4; }
.cf-root small { font-size: 10.5px; color: var(--cf-dim); letter-spacing: .04em; font-weight: 500; }
.cf-root kbd {
  font: 600 10px/1 ui-monospace, "SF Mono", Menlo, monospace; color: #d7dbe0;
  padding: 3px 5px; border-radius: 4px; border: 1px solid var(--cf-line-2); border-bottom-width: 2px;
  background: rgba(255,255,255,.06); white-space: nowrap;
}
.cf-root p { margin: 0; }
.cf-dim { color: var(--cf-dim); }
.cf-glyph { display: block; flex: none; }

.cf-glass {
  position: relative;
  background: linear-gradient(180deg, rgba(24,30,37,.84), rgba(11,14,18,.90));
  -webkit-backdrop-filter: blur(16px) saturate(1.35);
  backdrop-filter: blur(16px) saturate(1.35);
  border: 1px solid var(--cf-line);
  border-radius: 10px;
  box-shadow: 0 14px 44px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);
}
.cf-glass::before {
  content: ""; position: absolute; left: 14px; right: 14px; top: -1px; height: 1px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(var(--cf-accent-rgb), .9) 18%, rgba(var(--cf-accent-rgb), .25) 60%, transparent);
}

/* ───────────── HUD shell ───────────── */
.cf-hud { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 10; }
.cf-hud > * { pointer-events: auto; }
.cf-hud.is-compact { --cf-panel-w: 228px; font-size: 12px; }
.cf-hud.is-large { --cf-panel-w: 296px; font-size: 14px; }
.cf-hud.is-large .cf-cell-name { font-size: 12px; }
.cf-hud.is-large .cf-tab { height: 30px; font-size: 13px; }

.cf-top { position: absolute; top: 10px; left: 10px; height: 36px; padding: 0 6px; display: flex; align-items: center; gap: 6px; border-radius: 9px; }
.cf-icon-btn { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: transparent; border-radius: 6px; color: #cfd4d9; transition: background .12s, color .12s; }
.cf-icon-btn:hover { background: rgba(255,255,255,.09); color: #fff; }
.cf-icon-btn:active { background: rgba(var(--cf-accent-rgb), .25); }
.cf-clock { font-weight: 600; font-size: 14px; letter-spacing: .06em; padding: 0 6px; min-width: 52px; text-align: center; }
.cf-fps { font: 500 10.5px ui-monospace, "SF Mono", Menlo, monospace; color: var(--cf-dim); }
.cf-fps:empty { display: none; }
.cf-fps:not(:empty) { padding-right: 6px; }

.cf-banner {
  position: absolute; top: 10px; left: calc((100% - var(--cf-panel-w) - 20px) / 2); transform: translateX(-50%);
  padding: 8px 16px; display: flex; align-items: baseline; gap: 12px; border-radius: 9px; white-space: nowrap;
  border-color: rgba(var(--cf-accent-rgb), .45); animation: cf-drop .18s ease-out;
}
.cf-banner b { font-weight: 600; letter-spacing: .04em; }
.cf-hud.is-left .cf-banner { left: calc(var(--cf-panel-w) + 20px + (100% - var(--cf-panel-w) - 20px) / 2); }
@keyframes cf-drop { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }

/* ───────────── alert feed ───────────── */
.cf-feed { position: absolute; top: 56px; left: 10px; width: 290px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.cf-toast {
  pointer-events: auto; display: flex; align-items: center; gap: 9px; padding: 7px 10px 7px 9px; min-height: 34px;
  background: linear-gradient(90deg, rgba(14,18,23,.92), rgba(14,18,23,.72));
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border: 1px solid var(--cf-line); border-left: 2px solid var(--cf-tone, var(--cf-dim)); border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0,0,0,.35); animation: cf-toast-in .22s cubic-bezier(.2,.8,.2,1);
  transition: opacity .24s, transform .24s;
}
.cf-toast.is-info { --cf-tone: #7fb6ff; }
.cf-toast.is-good { --cf-tone: var(--cf-good); }
.cf-toast.is-warn { --cf-tone: var(--cf-warn); }
.cf-toast.is-bad { --cf-tone: var(--cf-bad); background: linear-gradient(90deg, rgba(60,14,12,.92), rgba(22,14,16,.78)); }
.cf-toast.is-out { opacity: 0; transform: translateX(-14px); }
.cf-toast.is-bump { animation: cf-bump .25s ease-out; }
.cf-toast.is-link { cursor: pointer; }
.cf-toast.is-link:hover { border-color: var(--cf-line-2); border-left-color: var(--cf-tone); }
.cf-toast-ic { color: var(--cf-tone); flex: none; }
.cf-toast-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.cf-toast-body b { font-weight: 600; font-size: 12.5px; }
.cf-toast-n { font-weight: 700; font-size: 11px; color: var(--cf-tone); }
.cf-toast-n:empty { display: none; }
@keyframes cf-toast-in { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
@keyframes cf-bump { 0% { transform: scale(1.035); } 100% { transform: none; } }

/* ───────────── command panel ───────────── */
.cf-panel {
  position: absolute; top: 10px; right: 10px; bottom: 10px; width: var(--cf-panel-w);
  display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 12px;
}
.cf-hud.is-left .cf-panel { right: auto; left: 10px; }
.cf-hud.is-left .cf-top, .cf-hud.is-left .cf-feed, .cf-hud.is-left .cf-sel { left: calc(var(--cf-panel-w) + 20px); }

.cf-res { display: flex; flex-direction: column; gap: 6px; flex: none; }
.cf-credits { display: flex; align-items: center; gap: 8px; color: var(--cf-credit); height: 30px; }
.cf-credits-num { font-size: 24px; font-weight: 700; letter-spacing: .03em; color: #fff3d6; text-shadow: 0 0 14px rgba(255,190,80,.35); transition: color .2s; }
.cf-credits.is-up .cf-credits-num { color: #b9f5cf; }
.cf-credits.is-down .cf-credits-num { color: #ffd9a8; }
.cf-power { display: flex; align-items: center; gap: 7px; height: 16px; color: #9fd2ff; }
.cf-power-icon { flex: none; }
.cf-power-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,.09); overflow: hidden; position: relative; }
.cf-power-bar i { position: absolute; inset: 0; transform-origin: 0 50%; transform: scaleX(0); background: linear-gradient(90deg, #4aa8ff, #8fd0ff); transition: transform .35s cubic-bezier(.2,.8,.2,1), background .2s; }
.cf-power-txt { font-size: 11px; font-weight: 600; color: #cfe6ff; min-width: 64px; text-align: right; }
.cf-power.is-tight { color: var(--cf-warn); }
.cf-power.is-tight .cf-power-bar i { background: linear-gradient(90deg, #f0a020, #ffd060); }
.cf-power.is-tight .cf-power-txt { color: #ffe2a6; }
.cf-power.is-low { color: var(--cf-bad); animation: cf-pulse .9s ease-in-out infinite; }
.cf-power.is-low .cf-power-bar i { background: linear-gradient(90deg, #d8261e, #ff6a5e); transform: scaleX(1) !important; }
.cf-power.is-low .cf-power-txt { color: #ffb4ae; }
@keyframes cf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }

.cf-radar {
  position: relative; flex: none; height: calc(var(--cf-panel-w) - 22px); border-radius: 7px; overflow: hidden;
  background: #05070a; border: 1px solid var(--cf-line-2); box-shadow: inset 0 0 22px rgba(0,0,0,.8);
}
.cf-hud.is-compact .cf-radar { height: 168px; }
.cf-hud.is-tiny .cf-radar { height: 132px; }
.cf-radar::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: 6px; box-shadow: inset 0 0 0 1px rgba(var(--cf-accent-rgb), .22), inset 0 0 26px rgba(0,0,0,.55); }
.cf-radar-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: crosshair; }
.cf-radar.is-off .cf-radar-canvas { cursor: default; }
.cf-radar-off { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 3px; pointer-events: none; text-shadow: 0 1px 6px #000; }
.cf-radar-off b { font-size: 13px; letter-spacing: .3em; margin-right: -.3em; color: #c5ccd3; }
.cf-radar-off small { letter-spacing: .28em; margin-right: -.28em; }
.cf-radar.is-off .cf-radar-off { display: flex; }
.cf-radar-pings { position: absolute; inset: 0; pointer-events: none; }
.cf-ping { position: absolute; width: 0; height: 0; }
.cf-ping::before, .cf-ping::after {
  content: ""; position: absolute; left: -17px; top: -17px; width: 34px; height: 34px; border-radius: 50%;
  border: 2px solid var(--cf-pc, var(--cf-bad)); animation: cf-ping 1s ease-out 3; opacity: 0;
}
.cf-ping::after { animation-delay: .33s; }
.cf-ping.is-warn { --cf-pc: var(--cf-warn); }
.cf-ping.is-good { --cf-pc: var(--cf-good); }
@keyframes cf-ping { 0% { transform: scale(.15); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }

.cf-tools { display: flex; gap: 6px; flex: none; align-items: stretch; }
.cf-tool, .cf-pow {
  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; height: 46px; padding: 0 2px;
  flex: 1 1 0; min-width: 0; border: 1px solid var(--cf-line); border-radius: 6px; background: rgba(255,255,255,.04);
  font-weight: 600; font-size: 11px; white-space: nowrap; transition: background .12s, border-color .12s, color .12s;
}
.cf-tool:hover, .cf-pow:hover { background: rgba(255,255,255,.09); border-color: var(--cf-line-2); }
.cf-tool.is-on, .cf-pow.is-on { background: rgba(var(--cf-accent-rgb), .22); border-color: rgba(var(--cf-accent-rgb), .8); color: #fff; box-shadow: 0 0 14px rgba(var(--cf-accent-rgb), .3); }
.cf-powers { display: contents; }
.cf-pow-ring {
  width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: #aeb6be; flex: none;
  background: radial-gradient(closest-side, #12171d 78%, transparent 80%), conic-gradient(rgba(var(--cf-accent-rgb), .95) calc(var(--p, 0) * 1%), rgba(255,255,255,.12) 0);
}
.cf-pow-ring .cf-glyph { width: 13px; height: 13px; }
.cf-pow-t { font-size: 10px; font-weight: 600; color: var(--cf-dim); line-height: 1; }
.cf-pow.is-ready { border-color: rgba(var(--cf-accent-rgb), .8); animation: cf-ready 1.1s ease-in-out infinite; }
.cf-pow.is-ready .cf-pow-ring, .cf-pow.is-ready .cf-pow-t { color: #fff; }

.cf-tabs { display: flex; gap: 2px; flex: none; padding: 2px; border-radius: 7px; background: rgba(0,0,0,.3); border: 1px solid var(--cf-line); }
.cf-tab { position: relative; flex: 1 1 0; height: 26px; border: 0; border-radius: 5px; background: transparent; color: var(--cf-dim); font-weight: 600; font-size: 12px; letter-spacing: .06em; transition: background .12s, color .12s; }
.cf-tab:hover { color: var(--cf-text); background: rgba(255,255,255,.06); }
.cf-tab.is-on { color: #fff; background: rgba(var(--cf-accent-rgb), .24); box-shadow: inset 0 -2px 0 rgba(var(--cf-accent-rgb), .95); }
.cf-tab i { position: absolute; top: 3px; right: 4px; width: 5px; height: 5px; border-radius: 50%; display: none; }
.cf-tab.is-busy i { display: block; background: rgb(var(--cf-accent-rgb)); animation: cf-pulse 1s ease-in-out infinite; }
.cf-tab.is-paused i { display: block; background: var(--cf-warn); }
.cf-tab.is-ready i { display: block; background: var(--cf-good); box-shadow: 0 0 8px var(--cf-good); animation: cf-pulse .6s ease-in-out infinite; }

.cf-grid {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
  grid-auto-rows: max-content; align-content: start; padding: 1px 1px 4px; scrollbar-width: none; overscroll-behavior: contain;
}
.cf-grid::-webkit-scrollbar { display: none; }
.cf-grid-empty { grid-column: 1 / -1; padding: 22px 12px; text-align: center; color: var(--cf-dim); display: flex; flex-direction: column; gap: 6px; border: 1px dashed var(--cf-line-2); border-radius: 8px; }
.cf-grid-empty b { color: var(--cf-text); font-weight: 600; }
.cf-cell {
  position: relative; display: block; padding: 0; overflow: hidden; text-align: center;
  border: 1px solid var(--cf-line); border-radius: 7px; background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.02));
  transition: border-color .12s, transform .08s, box-shadow .15s;
}
.cf-cell:hover { border-color: rgba(var(--cf-accent-rgb), .75); box-shadow: 0 0 0 1px rgba(var(--cf-accent-rgb), .25), 0 4px 14px rgba(0,0,0,.4); }
.cf-cell:active, .cf-cell.is-poke { transform: scale(.955); }
.cf-cell-icon { display: block; width: 100%; aspect-ratio: 1; height: auto; }
.cf-cell-sweep {
  position: absolute; left: 0; right: 0; top: 0; aspect-ratio: 1; pointer-events: none; opacity: 0;
  background: conic-gradient(rgba(var(--cf-accent-rgb), .10) calc(var(--p, 0) * 1%), rgba(5,8,12,.78) 0);
}
.cf-cell.is-building .cf-cell-sweep, .cf-cell.is-paused .cf-cell-sweep { opacity: 1; }
.cf-cell-foot { display: flex; flex-direction: column; align-items: center; padding: 2px 2px 4px; background: rgba(0,0,0,.34); border-top: 1px solid var(--cf-line); }
.cf-cell-name { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.cf-cell-cost { font-size: 10.5px; font-weight: 600; color: var(--cf-credit); }
.cf-cell.is-poor .cf-cell-cost { color: #ff8078; }
.cf-cell.is-poor .cf-cell-icon { filter: saturate(.55) brightness(.8); }
.cf-cell-key { position: absolute; top: 3px; left: 4px; font: 600 9px ui-monospace, "SF Mono", Menlo, monospace; color: rgba(255,255,255,.5); text-shadow: 0 1px 2px #000; }
.cf-cell-count { position: absolute; top: 3px; right: 3px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; font-size: 10.5px; font-weight: 700; line-height: 17px; color: #0b0d10; background: rgb(var(--cf-accent-rgb)); box-shadow: 0 1px 6px rgba(0,0,0,.5); }
.cf-cell-count:empty { display: none; }
.cf-cell-state { position: absolute; left: 0; right: 0; top: 0; aspect-ratio: 1; display: grid; place-items: center; font-size: 12px; font-weight: 700; letter-spacing: .2em; text-indent: .2em; pointer-events: none; text-shadow: 0 1px 6px #000, 0 0 12px #000; }
.cf-cell-state:empty { display: none; }
.cf-cell.is-building { border-color: rgba(var(--cf-accent-rgb), .55); }
.cf-cell.is-paused { border-color: var(--cf-warn); }
.cf-cell.is-paused .cf-cell-state { color: var(--cf-warn); }
.cf-cell.is-ready { border-color: var(--cf-good); animation: cf-ready-g 1s ease-in-out infinite; }
.cf-cell.is-ready .cf-cell-state { color: #d8ffe6; animation: cf-pulse 1s ease-in-out infinite; }
@keyframes cf-ready { 0%, 100% { box-shadow: 0 0 0 0 rgba(var(--cf-accent-rgb), 0); } 50% { box-shadow: 0 0 14px 1px rgba(var(--cf-accent-rgb), .6); } }
@keyframes cf-ready-g { 0%, 100% { box-shadow: 0 0 0 0 rgba(98,216,148,0); } 50% { box-shadow: 0 0 14px 1px rgba(98,216,148,.65); } }

/* ───────────── tooltip ───────────── */
.cf-tip { position: absolute; left: 0; top: 0; width: 244px; padding: 11px 12px; border-radius: 9px; pointer-events: none !important; z-index: 5; }
.cf-tip-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.cf-tip-title { display: flex; flex-direction: column; }
.cf-tip-title b { font-size: 14px; font-weight: 700; }
.cf-tip-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 12px; padding: 7px 0; border-top: 1px solid var(--cf-line); border-bottom: 1px solid var(--cf-line); }
.cf-tip-stat { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.cf-tip-stat b { font-weight: 600; font-size: 12px; }
.cf-tip-stat.is-cost b { color: var(--cf-credit); }
.cf-tip-stat.is-good b { color: var(--cf-good); }
.cf-tip-stat.is-warn b { color: var(--cf-warn); }
.cf-tip-desc { margin-top: 8px !important; color: #d4d8dc; font-size: 12px; line-height: 1.5; }
.cf-tip-req { margin-top: 6px !important; font-size: 11.5px; color: #c2c8ce; }
.cf-tip-hint { margin-top: 7px !important; font-size: 10.5px; color: var(--cf-dim); }

/* ───────────── selection card ───────────── */
.cf-sel { position: absolute; left: 10px; bottom: 10px; min-width: 250px; max-width: min(430px, calc(100% - var(--cf-panel-w) - 40px)); padding: 10px; display: flex; flex-direction: column; gap: 8px; border-radius: 10px; }
.cf-sel-main { display: flex; gap: 10px; align-items: center; }
.cf-sel-portrait { flex: none; border-radius: 7px; border: 1px solid var(--cf-line-2); background: rgba(0,0,0,.35); }
.cf-sel-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.cf-sel-name { display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
.cf-sel-name b { font-size: 15px; font-weight: 700; }
.cf-sel-rank { margin-left: auto; font-size: 11px; font-weight: 700; color: var(--cf-credit); }
.cf-hp { height: 5px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; position: relative; }
.cf-hp i { position: absolute; inset: 0; transform-origin: 0 50%; background: var(--cf-good); transition: transform .2s; }
.cf-hp i.is-warn { background: var(--cf-warn); }
.cf-hp i.is-bad { background: var(--cf-bad); }
.cf-sel-meta { display: flex; justify-content: space-between; gap: 12px; font-size: 11.5px; white-space: nowrap; }
.cf-sel-hp { font-weight: 600; }
.cf-sel-status { color: #b9c0c7; overflow: hidden; text-overflow: ellipsis; }
.cf-sel-groups { display: flex; flex-wrap: wrap; gap: 5px; }
.cf-sel-g { position: relative; padding: 0; width: 36px; height: 36px; border-radius: 6px; border: 1px solid var(--cf-line-2); background: rgba(0,0,0,.35); overflow: hidden; }
.cf-sel-g:hover { border-color: rgba(var(--cf-accent-rgb), .8); }
.cf-sel-g canvas { display: block; }
.cf-sel-g span { position: absolute; right: 1px; bottom: 0; font-size: 10.5px; font-weight: 700; text-shadow: 0 1px 3px #000, 0 0 4px #000; padding: 0 2px; }
.cf-sel-cmds { display: flex; flex-wrap: wrap; gap: 5px; padding-top: 8px; border-top: 1px solid var(--cf-line); }
.cf-cmd { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border: 1px solid var(--cf-line); border-radius: 6px; background: rgba(255,255,255,.04); font-size: 12px; font-weight: 600; white-space: nowrap; transition: background .12s, border-color .12s; }
.cf-cmd:hover { background: rgba(255,255,255,.1); border-color: var(--cf-line-2); }
.cf-cmd:active { transform: scale(.97); }
.cf-cmd.is-on { background: rgba(var(--cf-accent-rgb), .24); border-color: rgba(var(--cf-accent-rgb), .8); }
.cf-cmd kbd { padding: 2px 4px; font-size: 9px; border-bottom-width: 1px; }
.cf-cmd .cf-glyph { width: 14px; height: 14px; }

/* ───────────── overlay cards (pause, dialogs) ───────────── */
.cf-overlay { position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; padding: 18px; background: rgba(4,6,9,.58); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); animation: cf-fade .16s ease-out; }
@keyframes cf-fade { from { opacity: 0; } to { opacity: 1; } }
.cf-card { width: min(340px, 100%); max-height: 100%; display: flex; flex-direction: column; padding: 18px; border-radius: 14px; animation: cf-rise .2s cubic-bezier(.2,.8,.2,1); }
.cf-card.is-mid { width: min(520px, 100%); }
.cf-card.is-wide { width: min(920px, 100%); }
@keyframes cf-rise { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
.cf-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex: none; }
.cf-card-title { display: flex; align-items: baseline; gap: 10px; }
.cf-card-title b { font-size: 18px; font-weight: 700; letter-spacing: .08em; }
.cf-card-title small { text-transform: uppercase; letter-spacing: .18em; }
.cf-card-text { color: #cdd2d7; line-height: 1.6; margin-bottom: 16px !important; }
.cf-card-actions { display: flex; gap: 8px; justify-content: flex-end; }
.cf-card-scroll { overflow-y: auto; min-height: 0; margin: 0 -6px; padding: 0 6px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent; }
.cf-menu-list { display: flex; flex-direction: column; gap: 8px; }

.cf-btn {
  display: flex; align-items: baseline; justify-content: space-between; gap: 14px; min-height: 40px; padding: 9px 14px;
  border: 1px solid var(--cf-line-2); border-radius: 8px; background: rgba(255,255,255,.045); font-weight: 600; font-size: 14px; letter-spacing: .06em; text-align: left;
  transition: background .12s, border-color .12s, transform .08s, box-shadow .15s;
}
.cf-btn small { text-transform: uppercase; letter-spacing: .14em; }
.cf-btn:hover:not(:disabled) { background: rgba(255,255,255,.1); border-color: rgba(var(--cf-accent-rgb), .7); }
.cf-btn:active:not(:disabled) { transform: scale(.985); }
.cf-btn.is-primary { background: linear-gradient(180deg, rgba(var(--cf-accent-rgb), .42), rgba(var(--cf-accent-rgb), .22)); border-color: rgba(var(--cf-accent-rgb), .85); color: #fff; box-shadow: 0 0 22px rgba(var(--cf-accent-rgb), .22); }
.cf-btn.is-primary:hover:not(:disabled) { background: linear-gradient(180deg, rgba(var(--cf-accent-rgb), .58), rgba(var(--cf-accent-rgb), .32)); }
.cf-btn.is-danger { background: rgba(255,81,72,.2); border-color: rgba(255,81,72,.75); }
.cf-btn.is-danger:hover:not(:disabled) { background: rgba(255,81,72,.34); border-color: #ff6a62; }
.cf-btn.is-ghost { background: transparent; }

/* ───────────── form widgets ───────────── */
.cf-form { display: flex; flex-direction: column; gap: 9px; }
.cf-section { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; padding-bottom: 5px; border-bottom: 1px solid var(--cf-line); font-weight: 700; letter-spacing: .12em; font-size: 12px; color: rgb(var(--cf-accent-rgb)); }
.cf-section:first-child { margin-top: 0; }
.cf-section small { text-transform: uppercase; letter-spacing: .18em; }
.cf-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 32px; }
.cf-row-label { display: flex; flex-direction: column; min-width: 96px; }
.cf-row-label span { font-weight: 600; }
.cf-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 8px; background: rgba(0,0,0,.35); border: 1px solid var(--cf-line); }
.cf-seg-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 28px; padding: 3px 11px; border: 0; border-radius: 6px; background: transparent; color: var(--cf-dim); font-weight: 600; font-size: 12.5px; white-space: nowrap; transition: background .12s, color .12s; }
.cf-seg-btn:hover:not(:disabled) { color: var(--cf-text); background: rgba(255,255,255,.07); }
.cf-seg-btn.is-on { color: #fff; background: rgba(var(--cf-accent-rgb), .3); box-shadow: inset 0 0 0 1px rgba(var(--cf-accent-rgb), .7); }
.cf-seg-sub { font-size: 9.5px; font-weight: 500; opacity: .75; letter-spacing: .02em; }
.cf-slider { display: flex; align-items: center; gap: 10px; }
.cf-slider-val { min-width: 38px; text-align: right; font-weight: 600; font-size: 12px; }
.cf-slider input[type=range] { -webkit-appearance: none; appearance: none; width: 170px; height: 18px; margin: 0; background: transparent; cursor: pointer; }
.cf-slider input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, rgb(var(--cf-accent-rgb)) var(--pct, 50%), rgba(255,255,255,.14) var(--pct, 50%)); }
.cf-slider input[type=range]::-moz-range-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, rgb(var(--cf-accent-rgb)) var(--pct, 50%), rgba(255,255,255,.14) var(--pct, 50%)); }
.cf-slider input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: #f3f1ec; border: 0; box-shadow: 0 1px 5px rgba(0,0,0,.6), 0 0 0 3px rgba(var(--cf-accent-rgb), .3); }
.cf-slider input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #f3f1ec; border: 0; box-shadow: 0 1px 5px rgba(0,0,0,.6); }
.cf-slider input[type=range]:focus { outline: none; }
.cf-toggle { position: relative; width: 40px; height: 22px; border-radius: 11px; border: 1px solid var(--cf-line-2); background: rgba(255,255,255,.07); padding: 0; transition: background .15s, border-color .15s; flex: none; }
.cf-toggle i { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #aab1b8; transition: transform .16s cubic-bezier(.2,.8,.2,1), background .15s; }
.cf-toggle.is-on { background: rgba(var(--cf-accent-rgb), .45); border-color: rgba(var(--cf-accent-rgb), .9); }
.cf-toggle.is-on i { transform: translateX(18px); background: #fff; }
.cf-select { -webkit-appearance: none; appearance: none; font: inherit; font-weight: 600; font-size: 12px; color: var(--cf-text); height: 28px; padding: 0 22px 0 9px; border-radius: 6px; border: 1px solid var(--cf-line-2); cursor: pointer;
  background: rgba(0,0,0,.35) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23aab1b8' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 7px center; }
.cf-select:hover { border-color: rgba(var(--cf-accent-rgb), .7); }
.cf-select:focus { outline: none; border-color: rgb(var(--cf-accent-rgb)); }
.cf-select option { background: #151a20; color: #ece9e2; }

/* ───────────── how-to ───────────── */
.cf-howto { display: flex; flex-direction: column; gap: 14px; }
.cf-howto-intro { display: flex; flex-direction: column; gap: 6px; line-height: 1.6; max-width: 760px; }
.cf-howto-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 12px; }
.cf-keys { border: 1px solid var(--cf-line); border-radius: 9px; background: rgba(0,0,0,.25); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.cf-keys-head { display: flex; align-items: baseline; gap: 8px; font-weight: 700; letter-spacing: .1em; color: rgb(var(--cf-accent-rgb)); padding-bottom: 5px; border-bottom: 1px solid var(--cf-line); }
.cf-keys-head small { text-transform: uppercase; letter-spacing: .16em; }
.cf-keys-row { display: grid; grid-template-columns: minmax(96px, auto) 1fr; gap: 10px; align-items: baseline; font-size: 12px; }
.cf-keys-k { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
.cf-keys-k i { font-style: normal; color: var(--cf-dim); font-size: 10px; }
.cf-keys-k i:empty { width: 0; }
.cf-keys-w { color: #cfd4d9; line-height: 1.45; }

/* ───────────── main menu ───────────── */
.cf-menu { position: absolute; inset: 0; z-index: 40; overflow: hidden; background: #06080b; }
.cf-menu-bg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.cf-menu-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 90% at 30% 45%, transparent 35%, rgba(3,4,6,.72) 100%); }
.cf-screen { position: absolute; inset: 0; display: flex; animation: cf-fade .28s ease-out; }

.cf-title { flex-direction: column; justify-content: center; padding: 0 clamp(28px, 8vw, 130px); gap: clamp(18px, 4vh, 40px); }
.cf-title-block { display: flex; flex-direction: column; gap: 8px; }
.cf-title-kicker { font-size: 11px; letter-spacing: .5em; color: rgba(255,200,150,.7); text-transform: uppercase; }
.cf-title-name {
  margin: 0; font-size: clamp(54px, 10.5vw, 132px); line-height: 1.02; font-weight: 800; letter-spacing: .1em;
  background: linear-gradient(180deg, #fff4e2 8%, #ffc078 52%, #ff7a1e 96%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 28px rgba(255,120,30,.35)) drop-shadow(0 4px 0 rgba(0,0,0,.35));
}
.cf-title-en { display: flex; align-items: center; gap: 14px; font-size: clamp(13px, 1.7vw, 19px); font-weight: 600; letter-spacing: .62em; text-transform: uppercase; color: #e8d9c8; }
.cf-title-en::after { content: ""; flex: 0 0 clamp(60px, 14vw, 220px); height: 1px; background: linear-gradient(90deg, rgba(255,160,80,.9), transparent); }
.cf-title-tag { color: #aab0b6; letter-spacing: .12em; font-size: 13px; margin-top: 4px !important; }
.cf-title-nav { display: flex; flex-direction: column; gap: 10px; width: min(330px, 100%); }
.cf-title-nav .cf-btn { min-height: 48px; font-size: 16px; padding: 11px 18px; letter-spacing: .16em; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); background: rgba(10,13,17,.55); }
.cf-title-nav .cf-btn:hover { transform: translateX(5px); background: rgba(var(--cf-accent-rgb), .2); }
.cf-title-nav .cf-btn.is-primary { background: linear-gradient(90deg, rgba(var(--cf-accent-rgb), .5), rgba(var(--cf-accent-rgb), .14)); }
.cf-title-foot { position: absolute; left: clamp(28px, 8vw, 130px); right: 28px; bottom: 18px; display: flex; justify-content: space-between; color: rgba(255,255,255,.34); font-size: 11px; letter-spacing: .1em; }

.cf-page { flex-direction: column; padding: clamp(12px, 2.4vh, 26px) clamp(14px, 2.6vw, 40px); gap: 12px; }
.cf-page-head { display: flex; align-items: center; gap: 12px; flex: none; }
.cf-page-head h2 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: .14em; }
.cf-page-head small { text-transform: uppercase; letter-spacing: .24em; font-size: 11px; }
.cf-page-head .cf-icon-btn { width: 34px; height: 34px; border: 1px solid var(--cf-line-2); background: rgba(10,13,17,.6); }
.cf-page-body { flex: 1; min-height: 0; display: flex; }
.cf-page-foot { display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex: none; }
.cf-page-foot .cf-btn { min-width: 140px; justify-content: center; }
.cf-page-foot .cf-btn.is-primary { min-width: 200px; font-size: 15px; letter-spacing: .2em; }
.cf-page-note { margin-right: auto !important; color: var(--cf-warn); font-size: 12px; }
.cf-page-narrow { width: min(620px, 100%); margin: 0 auto; padding: 18px; display: flex; flex-direction: column; min-height: 0; }
.cf-page-wide { width: min(1040px, 100%); margin: 0 auto; padding: 18px; display: flex; flex-direction: column; min-height: 0; }

/* skirmish lobby */
.cf-lobby { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(190px, 250px) minmax(0, 1fr) minmax(318px, 380px); gap: 12px; }
.cf-col { display: flex; flex-direction: column; min-height: 0; padding: 12px; gap: 10px; }
.cf-col-title { display: flex; align-items: baseline; gap: 8px; font-weight: 700; letter-spacing: .14em; font-size: 12px; color: rgb(var(--cf-accent-rgb)); flex: none; }
.cf-col-title small { text-transform: uppercase; letter-spacing: .18em; }
.cf-col-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin: 0 -4px; padding: 0 4px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent; }
.cf-map-item { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--cf-line); background: rgba(255,255,255,.03); transition: background .12s, border-color .12s; }
.cf-map-item:hover { background: rgba(255,255,255,.08); }
.cf-map-item.is-on { border-color: rgba(var(--cf-accent-rgb), .85); background: rgba(var(--cf-accent-rgb), .16); box-shadow: inset 3px 0 0 rgb(var(--cf-accent-rgb)); }
.cf-map-item b { font-weight: 700; font-size: 14px; letter-spacing: .06em; }
.cf-map-item span { font-size: 11px; color: var(--cf-dim); }
.cf-preview { position: relative; flex: 1; min-height: 120px; border-radius: 8px; overflow: hidden; background: radial-gradient(80% 80% at 50% 50%, rgba(255,255,255,.05), rgba(0,0,0,.4)); border: 1px solid var(--cf-line); }
.cf-preview canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: pointer; }
.cf-preview-info { display: flex; flex-direction: column; gap: 5px; flex: none; }
.cf-preview-name { display: flex; align-items: baseline; gap: 10px; }
.cf-preview-name b { font-size: 17px; font-weight: 700; letter-spacing: .08em; }
.cf-preview-name .cf-icon-btn { margin-left: auto; border: 1px solid var(--cf-line); }
.cf-preview-desc { color: #c5cbd1; font-size: 12.5px; line-height: 1.55; }
.cf-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cf-chip { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 20px; border: 1px solid var(--cf-line-2); background: rgba(0,0,0,.3); color: #cfd4d9; white-space: nowrap; }
.cf-faction { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cf-faction-btn { display: flex; flex-direction: column; gap: 1px; text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--cf-line); background: rgba(255,255,255,.03); transition: background .12s, border-color .12s; }
.cf-faction-btn:hover { background: rgba(255,255,255,.08); }
.cf-faction-btn.is-on { border-color: rgba(var(--cf-accent-rgb), .9); background: rgba(var(--cf-accent-rgb), .18); }
.cf-faction-btn b { font-weight: 700; font-size: 13.5px; letter-spacing: .04em; }
.cf-faction-desc { font-size: 11.5px; color: #c5cbd1; line-height: 1.5; min-height: 2.9em; }
.cf-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.cf-swatch { width: 24px; height: 24px; border-radius: 6px; border: 2px solid transparent; padding: 0; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.35); transition: transform .1s; }
.cf-swatch:hover { transform: scale(1.12); }
.cf-swatch.is-on { border-color: #fff; box-shadow: 0 0 12px var(--c); }
.cf-ai { display: flex; flex-direction: column; gap: 6px; }
.cf-ai-row { display: grid; grid-template-columns: 14px minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, .9fr) 24px; gap: 5px; align-items: center; }
.cf-ai-row .cf-select { width: 100%; padding-left: 7px; }
.cf-ai-dot { width: 12px; height: 12px; border-radius: 3px; background: var(--c, #888); box-shadow: 0 0 8px var(--c, transparent); }
.cf-ai-x { width: 24px; height: 24px; }
.cf-add { justify-content: center; min-height: 30px; font-size: 12px; padding: 4px 10px; border-style: dashed; gap: 6px; align-items: center; }
.cf-lobby .cf-row { min-height: 30px; }
.cf-lobby .cf-seg-btn { padding: 3px 9px; }

/* result */
.cf-result { flex-direction: column; align-items: center; justify-content: center; padding: 20px; gap: 18px; }
.cf-result-banner { text-align: center; display: flex; flex-direction: column; gap: 4px; align-items: center; }
.cf-result-banner h1 { margin: 0; font-size: clamp(46px, 9vw, 96px); font-weight: 800; letter-spacing: .3em; text-indent: .3em; line-height: 1.1; }
.cf-result.is-win h1 { background: linear-gradient(180deg, #fff, #ffd98a 55%, #ff9a2e); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 30px rgba(255,170,60,.45)); }
.cf-result.is-loss h1 { background: linear-gradient(180deg, #e9edf1, #8d99a6 60%, #4c5661); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 24px rgba(120,150,190,.25)); }
.cf-result-banner small { font-size: 13px; letter-spacing: .5em; text-indent: .5em; text-transform: uppercase; }
.cf-result-card { width: min(900px, 100%); padding: 14px 16px; overflow-x: auto; }
.cf-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.cf-table th { font-weight: 600; font-size: 11px; color: var(--cf-dim); letter-spacing: .08em; text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--cf-line-2); white-space: nowrap; }
.cf-table td { text-align: right; padding: 9px 10px; border-bottom: 1px solid var(--cf-line); font-weight: 600; white-space: nowrap; }
.cf-table th:first-child, .cf-table td:first-child { text-align: left; }
.cf-table tr:last-child td { border-bottom: 0; }
.cf-table tr.is-me td { background: rgba(var(--cf-accent-rgb), .1); }
.cf-table-name { display: flex; align-items: center; gap: 8px; }
.cf-table-name i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); box-shadow: 0 0 8px var(--c); flex: none; }
.cf-table-name small { font-weight: 500; }
.cf-tag { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; letter-spacing: .08em; }
.cf-tag.is-win { color: #0b0d10; background: var(--cf-credit); }
.cf-tag.is-loss { color: #c9cfd5; background: rgba(255,255,255,.12); }

@media (max-width: 1100px) {
  .cf-lobby { grid-template-columns: minmax(150px, 190px) minmax(0, 1fr) minmax(300px, 340px); gap: 8px; }
  .cf-col { padding: 10px; gap: 8px; }
}
@media (max-height: 700px) {
  .cf-lobby .cf-row { min-height: 26px; }
  .cf-faction-desc { min-height: 0; }
  .cf-page-head h2 { font-size: 17px; }
}
@media (prefers-reduced-motion: reduce) {
  .cf-root *, .cf-root *::before, .cf-root *::after { animation-duration: .001s !important; transition-duration: .001s !important; }
}
`;

let injected = false;

export function injectStyle(): void {
  if (injected || document.getElementById('cf-ui-style')) {
    injected = true;
    return;
  }
  injected = true;
  const style = document.createElement('style');
  style.id = 'cf-ui-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}
