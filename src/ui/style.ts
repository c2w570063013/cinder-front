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
  --cf-panel-w: 300px;
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
.cf-hud.is-compact { --cf-panel-w: 262px; font-size: 12px; }
.cf-hud.is-large { --cf-panel-w: 352px; font-size: 14px; }

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

/* ───────────── command console (side panel) ───────────── */
.cf-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: var(--cf-panel-w);
  display: flex; flex-direction: column; gap: 9px; padding: 12px 12px 12px 15px;
  --con-text: #c9ced2; --con-text-sh: 0 1px 0 rgba(0,0,0,.8);
  --con-well: #07090b; --con-well-edge: rgba(255,255,255,.10);
  --con-light: rgb(var(--cf-accent-rgb));
  --con-btn-a: #575b5f; --con-btn-b: #35383b; --con-btn-text: #e3e6e8;
}
.cf-hud.is-left .cf-panel { right: auto; left: 0; padding: 12px 15px 12px 12px; }
.cf-hud.is-left .cf-top, .cf-hud.is-left .cf-feed, .cf-hud.is-left .cf-sel { left: calc(var(--cf-panel-w) + 20px); }

/* Ferrum: heavy riveted steel, scratched and rust-stained */
.cf-console.is-ferrum, .cf-console:not(.is-helion) {
  background:
    radial-gradient(ellipse 70px 46px at 16% 31%, rgba(140,62,18,.55), rgba(120,52,16,.18) 55%, transparent 72%),
    radial-gradient(ellipse 110px 60px at 88% 66%, rgba(128,56,16,.5), rgba(110,48,14,.15) 55%, transparent 74%),
    radial-gradient(ellipse 40px 110px at 4% 92%, rgba(150,70,24,.55), transparent 72%),
    radial-gradient(ellipse 60px 34px at 72% 10%, rgba(130,62,24,.38), transparent 70%),
    radial-gradient(ellipse 22px 60px at 97% 40%, rgba(150,72,26,.45), transparent 70%),
    linear-gradient(104deg, transparent 37.6%, rgba(255,255,255,.12) 37.8%, transparent 38.2%),
    linear-gradient(76deg, transparent 61%, rgba(255,255,255,.09) 61.12%, transparent 61.4%),
    linear-gradient(118deg, transparent 72%, rgba(255,255,255,.08) 72.1%, transparent 72.35%),
    linear-gradient(171deg, transparent 22%, rgba(0,0,0,.38) 22.2%, transparent 22.6%),
    linear-gradient(13deg, transparent 80%, rgba(255,255,255,.08) 80.1%, transparent 80.4%),
    linear-gradient(97deg, transparent 15%, rgba(255,255,255,.07) 15.1%, transparent 15.35%),
    repeating-linear-gradient(90deg, rgba(255,255,255,.014) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, #4d5054, #383b3e 38%, #2d2f32 100%);
  box-shadow: inset 4px 0 0 #63686c, inset 5px 0 0 #1d1f21, inset 0 3px 0 #5e6266, inset 0 -3px 0 #17181a, -10px 0 30px rgba(0,0,0,.55);
  border-left: 3px solid #141516;
}
.cf-hud.is-left .cf-console.is-ferrum, .cf-hud.is-left .cf-console:not(.is-helion) {
  border-left: 0; border-right: 3px solid #141516;
  box-shadow: inset -4px 0 0 #63686c, inset -5px 0 0 #1d1f21, inset 0 3px 0 #5e6266, inset 0 -3px 0 #17181a, 10px 0 30px rgba(0,0,0,.55);
}

/* Helion: sleek light plating with cyan light strips */
.cf-console.is-helion {
  --con-text: #33414d; --con-text-sh: 0 1px 0 rgba(255,255,255,.75);
  --con-well: #08131c; --con-well-edge: rgba(70,220,255,.35);
  --con-light: #3fe0ff;
  --con-btn-a: #f7f9fb; --con-btn-b: #d2dae1; --con-btn-text: #22303b;
  background:
    linear-gradient(180deg, rgba(255,255,255,.65), transparent 16%),
    linear-gradient(0deg, rgba(20,40,60,.10), transparent 30%),
    repeating-linear-gradient(180deg, transparent 0 139px, rgba(40,62,84,.20) 139px 140px, rgba(255,255,255,.7) 140px 141px),
    linear-gradient(90deg, #d5dde4, #eef2f5 38%, #e4e9ee 70%, #c8d1d9);
  box-shadow: inset 2px 0 0 #fff, inset 0 2px 0 #fff, inset 0 -2px 0 #9aa6b1, -10px 0 30px rgba(0,0,0,.45);
  border-left: 3px solid #22303a;
}
.cf-hud.is-left .cf-console.is-helion { border-left: 0; border-right: 3px solid #22303a; box-shadow: inset -2px 0 0 #fff, inset 0 2px 0 #fff, inset 0 -2px 0 #9aa6b1, 10px 0 30px rgba(0,0,0,.45); }
.cf-con-strip { display: none; position: absolute; top: 14px; bottom: 14px; width: 2px; border-radius: 1px; pointer-events: none; background: #3fe0ff; box-shadow: 0 0 6px #3fe0ff, 0 0 14px rgba(63,224,255,.6); animation: cf-strip 3.2s ease-in-out infinite; }
.cf-con-strip.is-a { left: 6px; }
.cf-con-strip.is-b { right: 4px; animation-delay: -1.6s; opacity: .6; }
.cf-console.is-helion .cf-con-strip { display: block; }
@keyframes cf-strip { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }

/* screw heads (Ferrum) / light studs (Helion) */
.cf-bolt { position: absolute; width: 11px; height: 11px; border-radius: 50%; pointer-events: none; z-index: 3;
  background: radial-gradient(circle at 35% 32%, #c3c8cc, #767b80 45%, #2e3134 78%); box-shadow: 0 1px 1px rgba(0,0,0,.75), inset 0 0 0 1px rgba(0,0,0,.35); }
.cf-bolt::after { content: ""; position: absolute; left: 1.5px; right: 1.5px; top: 4.6px; height: 1.6px; background: rgba(20,22,24,.85); transform: rotate(var(--r, 30deg)); }
.cf-bolt.is-tl { top: 5px; left: 8px; --r: 25deg; }
.cf-bolt.is-tr { top: 5px; right: 5px; --r: -50deg; }
.cf-bolt.is-bl { bottom: 5px; left: 8px; --r: 80deg; }
.cf-bolt.is-br { bottom: 5px; right: 5px; --r: 5deg; }
.cf-radar .cf-bolt { width: 9px; height: 9px; }
.cf-radar .cf-bolt::after { top: 3.7px; }
.cf-radar .cf-bolt.is-tl { top: -3px; left: -3px; } .cf-radar .cf-bolt.is-tr { top: -3px; right: -3px; }
.cf-radar .cf-bolt.is-bl { bottom: -3px; left: -3px; } .cf-radar .cf-bolt.is-br { bottom: -3px; right: -3px; }
.cf-console.is-helion .cf-bolt { width: 9px; height: 4px; border-radius: 2px; background: #1d2a33; box-shadow: 0 0 0 1px rgba(255,255,255,.7); }
.cf-console.is-helion .cf-bolt::after { left: 2px; right: 2px; top: 1px; height: 2px; border-radius: 1px; transform: none; background: #3fe0ff; box-shadow: 0 0 5px #3fe0ff; }

/* recessed wells */
.cf-well, .cf-odo, .cf-radar, .cf-grid-well, .cf-gauge-track {
  background: var(--con-well);
  box-shadow: inset 0 2px 7px rgba(0,0,0,.9), inset 0 0 0 1px rgba(0,0,0,.7), 0 1px 0 var(--con-well-edge);
}

/* head: faction mark + odometer */
.cf-con-head { display: flex; align-items: center; gap: 8px; flex: none; position: relative; z-index: 1; }
.cf-con-emblem { width: 38px; height: 38px; flex: none; display: grid; place-items: center; border-radius: 7px; color: var(--con-light);
  background: linear-gradient(180deg, var(--con-btn-a), var(--con-btn-b)); box-shadow: inset 0 1px 0 rgba(255,255,255,.25), inset 0 -2px 0 rgba(0,0,0,.35), 0 1px 3px rgba(0,0,0,.5); }
.cf-console:not(.is-helion) .cf-con-emblem { color: #ffb36a; filter: drop-shadow(0 0 4px rgba(255,140,60,.4)); }
.cf-console.is-helion .cf-con-emblem { color: #0fb7dc; }
.cf-odo { flex: 1; min-width: 0; height: 38px; border-radius: 7px; display: flex; align-items: center; justify-content: flex-end; padding: 0 10px 0 8px; gap: 1px;
  font: 700 23px/1 ui-monospace, "SF Mono", Menlo, monospace; color: #ffe2a0; text-shadow: 0 0 10px rgba(255,190,80,.45); }
.cf-odo-ic { margin-right: auto; color: var(--cf-credit); display: grid; }
.cf-odo-d { display: inline-block; height: 1.12em; overflow: hidden; width: .62em; text-align: center; }
.cf-odo-strip { display: flex; flex-direction: column; transition: transform .16s cubic-bezier(.3,.7,.3,1); will-change: transform; }
.cf-odo-strip b { display: block; height: 1.12em; line-height: 1.12em; font-weight: 700; }
.cf-odo-d.is-lead, .cf-odo-sep.is-lead { opacity: .16; }
.cf-odo-sep { width: .3em; text-align: center; opacity: .55; }
.cf-odo.is-up { color: #c8ffd9; text-shadow: 0 0 12px rgba(98,216,148,.55); }
.cf-odo.is-down { color: #ffd0a0; text-shadow: 0 0 12px rgba(255,140,60,.5); }

/* radar screen */
.cf-radar { position: relative; flex: none; height: calc(var(--cf-panel-w) - 62px); border-radius: 6px; border: 4px solid #1b1d1f; overflow: visible; }
.cf-console.is-helion .cf-radar { border-color: #2a3944; box-shadow: inset 0 2px 7px rgba(0,0,0,.9), 0 0 0 1px #8b98a3, 0 0 0 2px #fff, 0 0 12px rgba(63,224,255,.25); }
.cf-hud.is-compact .cf-radar { height: calc(var(--cf-panel-w) - 86px); }
.cf-hud.is-tiny .cf-radar { height: 128px; }
.cf-radar-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: crosshair; border-radius: 2px; }
.cf-radar.is-off .cf-radar-canvas, .cf-radar.is-anim .cf-radar-canvas { cursor: default; }
.cf-radar-scan { position: absolute; inset: 0; pointer-events: none; border-radius: 2px;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.20) 0 1px, transparent 1px 3px), radial-gradient(120% 100% at 50% 50%, transparent 60%, rgba(0,0,0,.55) 100%); }
.cf-radar-off { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 3px; pointer-events: none; text-shadow: 0 1px 6px #000; }
.cf-radar-off b { font-size: 13px; letter-spacing: .3em; margin-right: -.3em; color: #c5ccd3; }
.cf-radar-off small { letter-spacing: .28em; margin-right: -.28em; }
.cf-radar.is-off .cf-radar-off { display: flex; }
.cf-radar-pings { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.cf-ping { position: absolute; width: 0; height: 0; }
.cf-ping::before, .cf-ping::after {
  content: ""; position: absolute; left: -17px; top: -17px; width: 34px; height: 34px; border-radius: 50%;
  border: 2px solid var(--cf-pc, var(--cf-bad)); animation: cf-ping 1s ease-out 3; opacity: 0;
}
.cf-ping::after { animation-delay: .33s; }
.cf-ping.is-warn { --cf-pc: var(--cf-warn); }
.cf-ping.is-good { --cf-pc: var(--cf-good); }
@keyframes cf-ping { 0% { transform: scale(.15); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }

/* metal buttons shared by tools and tabs */
.cf-tool, .cf-pow, .cf-tab {
  position: relative; border: 0; border-radius: 6px;
  background: linear-gradient(180deg, var(--con-btn-a), var(--con-btn-b));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.28), inset 0 -2px 0 rgba(0,0,0,.38), 0 1px 0 rgba(0,0,0,.6), 0 2px 4px rgba(0,0,0,.35);
  transition: box-shadow .12s, filter .12s, transform .06s;
}
.cf-tool:hover, .cf-pow:hover, .cf-tab:hover:not(:disabled) { filter: brightness(1.12); box-shadow: inset 0 1px 0 rgba(255,255,255,.3), inset 0 -2px 0 rgba(0,0,0,.38), 0 0 0 1px rgba(var(--cf-accent-rgb), .55), 0 0 12px rgba(var(--cf-accent-rgb), .35); }
.cf-tool:active, .cf-pow:active, .cf-tab:active:not(:disabled) { transform: translateY(1px); box-shadow: inset 0 2px 5px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.4); filter: brightness(.95); }
.cf-tool.is-on, .cf-pow.is-on, .cf-tab.is-on {
  color: #fff; background: linear-gradient(180deg, rgba(var(--cf-accent-rgb), .55), rgba(var(--cf-accent-rgb), .3)), linear-gradient(180deg, #2a2d30, #1b1d1f);
  box-shadow: inset 0 2px 6px rgba(0,0,0,.55), inset 0 0 0 1px rgba(var(--cf-accent-rgb), .9), 0 0 14px rgba(var(--cf-accent-rgb), .45);
}
.cf-console.is-helion .cf-tool.is-on, .cf-console.is-helion .cf-pow.is-on, .cf-console.is-helion .cf-tab.is-on {
  background: linear-gradient(180deg, #123241, #0b1d27); box-shadow: inset 0 2px 6px rgba(0,0,0,.6), inset 0 0 0 1px #3fe0ff, 0 0 14px rgba(63,224,255,.5); color: #d9fbff;
}
.cf-console .cf-tool kbd, .cf-console .cf-tab-key { position: absolute; top: 3px; right: 4px; padding: 0; border: 0; background: none; font: 700 9px ui-monospace, "SF Mono", Menlo, monospace; color: currentColor; opacity: .5; }

.cf-console .cf-tool, .cf-console .cf-pow, .cf-console .cf-tab { color: var(--con-btn-text); }
.cf-console .cf-tool.is-on, .cf-console .cf-pow.is-on, .cf-console .cf-tab.is-on, .cf-console .cf-pow.is-ready { color: #fff; }
.cf-console.is-helion .cf-tool.is-on, .cf-console.is-helion .cf-pow.is-on, .cf-console.is-helion .cf-tab.is-on { color: #d9fbff; }
.cf-console.is-helion .cf-pow.is-ready:not(.is-on) { color: #0b6b3c; }

/* tool row */
.cf-tools { display: flex; gap: 6px; flex: none; }
.cf-tool { flex: 1 1 0; min-width: 0; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-weight: 700; font-size: 11px; letter-spacing: .08em; }
.cf-powers { display: contents; }
.cf-pow { flex: 1 1 0; min-width: 0; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 0 4px; }
.cf-pow-ic { display: grid; color: currentColor; opacity: .85; }
.cf-pow-t { font: 700 10px ui-monospace, "SF Mono", Menlo, monospace; line-height: 1; opacity: .8; }
.cf-pow-bar { position: absolute; left: 5px; right: 5px; bottom: 4px; height: 3px; border-radius: 2px; background: rgba(0,0,0,.45); overflow: hidden; }
.cf-pow-bar i { position: absolute; inset: 0; transform-origin: 0 50%; transform: scaleX(0); background: linear-gradient(90deg, #4aa8ff, #8fe3ff); transition: transform .3s linear; }
.cf-pow.is-ready { animation: cf-ready 1.1s ease-in-out infinite; color: #fff; }
.cf-pow.is-ready .cf-pow-bar i { background: linear-gradient(90deg, #62d894, #c6ffd9); }
.cf-pow.is-ready .cf-pow-t { opacity: 1; color: #c6ffd9; }
.cf-console.is-helion .cf-pow.is-ready .cf-pow-t { color: #0b8f4e; }

/* category tabs */
.cf-tabs { display: flex; gap: 4px; flex: none; }
.cf-tab { flex: 1 1 0; min-width: 0; height: 46px; padding: 4px 2px 3px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-weight: 700; font-size: 10.5px; letter-spacing: .08em; }
.cf-tab .cf-glyph { opacity: .9; }
.cf-tab:disabled { cursor: default; opacity: .38; filter: grayscale(1); }
.cf-tab > i { position: absolute; top: 4px; left: 5px; width: 6px; height: 6px; border-radius: 50%; display: none; }
.cf-tab.is-busy > i { display: block; background: rgb(var(--cf-accent-rgb)); animation: cf-pulse 1s ease-in-out infinite; }
.cf-tab.is-paused > i { display: block; background: var(--cf-warn); }
.cf-tab.is-ready > i { display: block; background: var(--cf-good); box-shadow: 0 0 8px var(--cf-good); animation: cf-pulse .6s ease-in-out infinite; }

/* body: power gauge + build grid */
.cf-con-body { flex: 1 1 auto; min-height: 0; display: flex; gap: 7px; }
.cf-gauge { flex: none; width: 18px; display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: help; }
.cf-gauge-ic { color: #9fd2ff; display: grid; }
.cf-console.is-helion .cf-gauge-ic { color: #0e8fb3; }
.cf-gauge-track { position: relative; flex: 1; width: 14px; border-radius: 4px; overflow: hidden; }
.cf-gauge-track::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(0,0,0,.55) 0 1px, transparent 1px 7px); }
.cf-gauge-fill { position: absolute; left: 2px; right: 2px; bottom: 2px; top: 2px; border-radius: 2px; transform-origin: 50% 100%; transform: scaleY(0);
  background: linear-gradient(0deg, #1f9e57, #62d894 70%, #b7ffd2); box-shadow: 0 0 10px rgba(98,216,148,.5); transition: transform .5s cubic-bezier(.2,.8,.2,1); }
.cf-gauge-use { position: absolute; left: 0; right: 0; height: 2px; margin-bottom: -1px; bottom: 0; background: #fff; box-shadow: 0 0 6px #fff, 0 0 2px #000; transition: bottom .5s cubic-bezier(.2,.8,.2,1); z-index: 1; }
.cf-gauge.is-tight .cf-gauge-fill { background: linear-gradient(0deg, #b77d0e, #ffc23e 70%, #ffe6a0); box-shadow: 0 0 10px rgba(255,182,46,.55); }
.cf-gauge.is-tight .cf-gauge-ic { color: var(--cf-warn); }
.cf-gauge.is-low .cf-gauge-fill { background: linear-gradient(0deg, #8e130d, #ff5148 70%, #ffb0aa); box-shadow: 0 0 12px rgba(255,81,72,.7); animation: cf-pulse .7s ease-in-out infinite; }
.cf-gauge.is-low .cf-gauge-ic { color: var(--cf-bad); animation: cf-pulse .7s ease-in-out infinite; }

.cf-grid-well { flex: 1 1 auto; min-width: 0; min-height: 0; border-radius: 6px; padding: 5px; display: flex;
  background-image: linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px); background-size: 14px 14px; background-position: 4px 4px; }
.cf-grid {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;
  grid-auto-rows: max-content; align-content: start; scrollbar-width: none; overscroll-behavior: contain;
}
.cf-grid::-webkit-scrollbar { display: none; }
.cf-grid-empty { grid-column: 1 / -1; padding: 26px 12px; text-align: center; color: var(--cf-dim); display: flex; flex-direction: column; gap: 6px; border: 1px dashed rgba(255,255,255,.14); border-radius: 6px; }
.cf-grid-empty b { color: var(--cf-text); font-weight: 600; }

.cf-cell {
  position: relative; display: flex; flex-direction: column; padding: 0; overflow: hidden; text-align: center; border: 0; border-radius: 5px;
  background: linear-gradient(180deg, #2b2f33, #1a1d20);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08), 0 0 0 1px rgba(0,0,0,.85), 0 2px 4px rgba(0,0,0,.5);
  transition: box-shadow .12s, transform .06s, filter .15s;
}
.cf-console.is-helion .cf-cell { background: linear-gradient(180deg, #1b3140, #0f1d27); box-shadow: inset 0 0 0 1px rgba(63,224,255,.22), 0 0 0 1px rgba(0,0,0,.8), 0 2px 4px rgba(0,0,0,.5); }
.cf-cell:hover { box-shadow: inset 0 0 0 1px rgba(var(--cf-accent-rgb), .9), 0 0 0 1px rgba(0,0,0,.85), 0 0 14px rgba(var(--cf-accent-rgb), .4); }
.cf-cell:active { transform: translateY(1px) scale(.975); filter: brightness(.92); }
.cf-cell-pic { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; background: radial-gradient(90% 90% at 50% 40%, rgba(255,255,255,.07), rgba(0,0,0,.35)); }
.cf-cell-icon { display: block; width: 100%; height: 100%; }
.cf-cell-sweep { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: conic-gradient(transparent calc(var(--p, 0) * 1%), rgba(4,6,9,.72) 0); }
.cf-cell.is-building .cf-cell-sweep, .cf-cell.is-paused .cf-cell-sweep { opacity: 1; }
.cf-cell.is-building .cf-cell-pic::after { content: ""; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(var(--cf-accent-rgb), .75); }
.cf-cell.is-paused .cf-cell-pic::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(135deg, rgba(0,0,0,.35) 0 6px, transparent 6px 12px); box-shadow: inset 0 0 0 2px var(--cf-warn); }
.cf-cell-stamp { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(-11deg); pointer-events: none; padding: 3px 9px 3px 12px; border-radius: 4px;
  font-size: 15px; font-weight: 800; letter-spacing: .3em; white-space: nowrap; border: 2px solid currentColor; background: rgba(0,0,0,.45); text-shadow: 0 0 10px currentColor; }
.cf-cell-stamp:empty { display: none; }
.cf-cell.is-ready .cf-cell-stamp { color: #7dffb0; box-shadow: 0 0 14px rgba(98,216,148,.5); animation: cf-pulse 1s ease-in-out infinite; }
.cf-cell.is-paused .cf-cell-stamp { color: var(--cf-warn); }
.cf-cell.is-ready { box-shadow: inset 0 0 0 2px var(--cf-good), 0 0 0 1px rgba(0,0,0,.85), 0 0 14px rgba(98,216,148,.45); }
.cf-cell-count { position: absolute; top: 4px; right: 4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 4px; font-size: 12px; font-weight: 800; line-height: 20px;
  color: #0b0d10; background: linear-gradient(180deg, #fff3c8, var(--cf-credit)); box-shadow: 0 1px 4px rgba(0,0,0,.7), inset 0 -1px 0 rgba(0,0,0,.25); }
.cf-cell-count:empty { display: none; }
.cf-cell-foot { display: flex; flex-direction: column; align-items: stretch; padding: 3px 5px 4px; background: rgba(0,0,0,.45); border-top: 1px solid rgba(255,255,255,.08); }
.cf-cell-name { font-size: 11.5px; font-weight: 700; color: #e8ebee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cf-cell-cost { font: 700 10.5px ui-monospace, "SF Mono", Menlo, monospace; color: var(--cf-credit); }
.cf-cell.is-poor .cf-cell-cost { color: #ff8078; }
.cf-cell.is-poor .cf-cell-icon { filter: grayscale(.85) brightness(.6); }
.cf-grid-well.is-lowpow .cf-cell.is-idle .cf-cell-icon, .cf-grid-well.is-lowpow .cf-cell.is-queued .cf-cell-icon { filter: saturate(.45) brightness(.75); }
.cf-grid-well.is-lowpow .cf-cell.is-building .cf-cell-sweep { background: conic-gradient(rgba(255,60,40,.12) calc(var(--p, 0) * 1%), rgba(40,4,4,.72) 0); }
@keyframes cf-ready { 0%, 100% { box-shadow: 0 0 0 0 rgba(var(--cf-accent-rgb), 0); } 50% { box-shadow: 0 0 14px 1px rgba(var(--cf-accent-rgb), .6); } }

.cf-hud.is-compact .cf-panel { gap: 7px; padding: 9px 9px 9px 12px; }
.cf-hud.is-compact .cf-odo { font-size: 19px; height: 34px; }
.cf-hud.is-compact .cf-con-emblem { width: 34px; height: 34px; }
.cf-hud.is-compact .cf-tool, .cf-hud.is-compact .cf-pow { height: 38px; }
.cf-hud.is-compact .cf-tab { height: 40px; }
.cf-hud.is-compact .cf-tab span { display: none; }
.cf-hud.is-large .cf-odo { font-size: 26px; height: 42px; }
.cf-hud.is-large .cf-cell-name { font-size: 12.5px; }
.cf-hud.is-large .cf-tab { height: 52px; font-size: 11.5px; }

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

/* ───────────── LAN: shared bits ───────────── */
.cf-input {
  font: inherit; font-weight: 600; font-size: 13px; color: var(--cf-text); height: 34px; padding: 0 11px; width: 100%;
  border-radius: 7px; border: 1px solid var(--cf-line-2); background: rgba(0,0,0,.38); outline: none;
  -webkit-user-select: text; user-select: text; transition: border-color .12s, box-shadow .12s;
}
.cf-input::placeholder { color: rgba(143,152,161,.75); font-weight: 500; }
.cf-input:hover { border-color: rgba(var(--cf-accent-rgb), .55); }
.cf-input:focus { border-color: rgb(var(--cf-accent-rgb)); box-shadow: 0 0 0 3px rgba(var(--cf-accent-rgb), .18); }
.cf-badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; letter-spacing: .06em; color: #d9dee3; background: rgba(255,255,255,.1); border: 1px solid var(--cf-line-2); white-space: nowrap; }
.cf-badge.is-me { color: #0b0d10; background: rgb(var(--cf-accent-rgb)); border-color: transparent; }
.cf-badge.is-bad { color: #ffd0cc; background: rgba(255,81,72,.22); border-color: rgba(255,81,72,.6); }
.cf-badge.is-warn { color: #ffe6b0; background: rgba(255,182,46,.18); border-color: rgba(255,182,46,.55); }
.cf-chip.is-bad { color: #ffb4ae; border-color: rgba(255,81,72,.6); }
.cf-tag.is-host { color: #0b0d10; background: var(--cf-credit); }
.cf-tag.is-ready { color: #062012; background: var(--cf-good); }
.cf-tag.is-wait { color: #c9cfd5; background: rgba(255,255,255,.12); }
.cf-tag.is-ai { color: #cfe3ff; background: rgba(127,182,255,.2); }
.cf-ms { font: 600 10px ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0; }
.cf-ms.is-good { color: var(--cf-good); }
.cf-ms.is-warn { color: var(--cf-warn); }
.cf-ms.is-bad { color: var(--cf-bad); }
.cf-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,.15); border-top-color: rgb(var(--cf-accent-rgb)); animation: cf-spin .8s linear infinite; flex: none; }
@keyframes cf-spin { to { transform: rotate(360deg); } }
.cf-alert {
  display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; flex: none; border-radius: 8px;
  border: 1px solid rgba(255,81,72,.6); background: linear-gradient(90deg, rgba(70,16,14,.92), rgba(30,14,16,.85)); color: #ffd7d3; font-weight: 600;
  animation: cf-drop-in .2s ease-out;
}
/* Every cf-* element with its own display rule must still honour the hidden attribute. */
[class^="cf-"][hidden], [class*=" cf-"][hidden] { display: none !important; }
.cf-alert > span:nth-child(2) { flex: 1; }
.cf-alert-ic { color: var(--cf-bad); display: grid; }
@keyframes cf-drop-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.cf-title-opt { display: flex; flex-direction: column; gap: 4px; }
.cf-title-opt .cf-btn { width: 100%; }
.cf-title-why { padding-left: 4px; color: rgba(255,200,150,.75) !important; letter-spacing: .08em !important; }
.cf-page-note.is-ok { color: var(--cf-good); }
.cf-lan-note { font-size: 11.5px; color: var(--cf-dim); line-height: 1.55; }
.cf-lan-spacer { flex: 1; }

/* room browser */
.cf-lan { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(260px, 330px) minmax(0, 1fr); gap: 12px; }
.cf-lan .cf-col .cf-chip { align-self: flex-start; }
.cf-lan-host { justify-content: center; align-items: center; gap: 10px; min-height: 42px; }
.cf-lan-host small { margin-left: 2px; }
.cf-scan { margin-left: auto; font-size: 11px; font-weight: 600; letter-spacing: .1em; color: var(--cf-dim); display: flex; align-items: center; gap: 6px; }
.cf-scan::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: rgb(var(--cf-accent-rgb)); box-shadow: 0 0 8px rgb(var(--cf-accent-rgb)); animation: cf-pulse 1.1s ease-in-out infinite; }
.cf-room-list { gap: 6px; }
.cf-room-item {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 9px 10px 9px 12px; flex: none;
  border-radius: 8px; border: 1px solid var(--cf-line); background: rgba(255,255,255,.03); transition: background .12s, border-color .12s;
}
.cf-room-item:hover { background: rgba(255,255,255,.07); border-color: var(--cf-line-2); }
.cf-room-item.is-blocked { opacity: .62; }
.cf-room-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cf-room-name { display: flex; align-items: center; gap: 7px; min-width: 0; }
.cf-room-name b { font-size: 14px; font-weight: 700; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cf-room-sub { font-size: 11px; color: var(--cf-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cf-room-count { font-weight: 700; font-size: 13px; color: #d9dee3; min-width: 44px; text-align: right; }
.cf-room-count.is-full { color: var(--cf-warn); }
.cf-room-join { min-height: 32px; padding: 5px 16px; font-size: 13px; justify-content: center; }
.cf-lan-conn { position: absolute; z-index: 5; }
.cf-lan-conn .cf-card-head { gap: 12px; }

/* room lobby */
.cf-room { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(300px, 1fr); grid-template-rows: minmax(0, 1.15fr) minmax(0, 1fr); gap: 12px; }
.cf-room-seats { grid-column: 1; grid-row: 1; }
.cf-room-chat { grid-column: 1; grid-row: 2; }
.cf-room-map { grid-column: 2; grid-row: 1; }
.cf-room-rules { grid-column: 2; grid-row: 2; overflow-y: auto; }
.cf-room-map .cf-preview { min-height: 90px; }
.cf-room-map .cf-preview-desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cf-map-select { flex: 1; min-width: 0; height: 30px; font-size: 13px; }
.cf-room .cf-row { min-height: 30px; }
.cf-room .cf-seg-btn { padding: 3px 9px; }
.cf-seat-list { gap: 5px; }
.cf-seat {
  display: grid; grid-template-columns: 20px minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, .8fr) 28px 96px 24px; gap: 7px; align-items: center;
  min-height: 40px; padding: 5px 6px 5px 8px; flex: none; border-radius: 8px; border: 1px solid var(--cf-line); background: rgba(255,255,255,.03);
}
.cf-seat.is-local { border-color: rgba(var(--cf-accent-rgb), .7); background: rgba(var(--cf-accent-rgb), .1); box-shadow: inset 3px 0 0 rgb(var(--cf-accent-rgb)); }
.cf-seat.is-open, .cf-seat.is-closed { background: transparent; border-style: dashed; }
.cf-seat.is-closed { opacity: .6; }
.cf-seat .cf-select { width: 100%; padding-left: 8px; }
.cf-seat-n { font: 700 11px ui-monospace, "SF Mono", Menlo, monospace; color: var(--cf-dim); text-align: center; }
.cf-seat-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cf-seat-name b { font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cf-seat-name .cf-select { flex: 1; }
.cf-seat-txt { font-size: 12px; font-weight: 600; color: #c9cfd5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 2px; }
.cf-seat-st { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.cf-seat-x { width: 24px; height: 24px; color: #ff9b94; }
.cf-colorbtn { width: 26px; height: 26px; padding: 0; border-radius: 6px; border: 2px solid rgba(255,255,255,.75); background: var(--c); box-shadow: 0 0 10px var(--c), inset 0 0 0 1px rgba(0,0,0,.35); }
.cf-colorbtn:disabled { opacity: 1 !important; border-color: rgba(255,255,255,.18); box-shadow: inset 0 0 0 1px rgba(0,0,0,.35); cursor: default; }
.cf-colorpop { position: absolute; z-index: 6; display: grid; grid-template-columns: repeat(4, 24px); gap: 6px; padding: 9px; border-radius: 9px; animation: cf-fade .12s ease-out; }
.cf-colorpop .cf-swatch:disabled { opacity: .18; transform: none; }
.cf-chat-log { gap: 3px; font-size: 12.5px; -webkit-user-select: text; user-select: text; }
.cf-chat-line { line-height: 1.45; overflow-wrap: anywhere; flex: none; }
.cf-chat-line b { font-weight: 700; margin-right: 6px; }
.cf-chat-line b::after { content: ":"; color: var(--cf-dim); font-weight: 500; }
.cf-chat-line.is-notice { color: var(--cf-dim); font-size: 11.5px; }
.cf-chat-line.is-notice::before { content: "— "; }
.cf-chat-line.is-error { color: #ff9b94; font-size: 11.5px; font-weight: 600; }
.cf-chat-row { display: flex; gap: 6px; flex: none; }
.cf-chat-send { min-height: 34px; padding: 5px 14px; font-size: 13px; justify-content: center; align-items: center; white-space: nowrap; flex: none; }
.cf-btn.is-primary.is-ready { background: linear-gradient(180deg, rgba(98,216,148,.42), rgba(98,216,148,.2)); border-color: rgba(98,216,148,.85); box-shadow: 0 0 22px rgba(98,216,148,.22); }

/* ───────────── LAN: in-match ───────────── */
.cf-net-chips { display: flex; align-items: center; gap: 4px; padding: 0 4px; border-left: 1px solid var(--cf-line); }
.cf-net-chips:empty { display: none; }
.cf-net-chip { display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; border-radius: 5px; background: rgba(255,255,255,.05); font-size: 10.5px; white-space: nowrap; }
.cf-net-chip i { width: 8px; height: 8px; border-radius: 2px; background: var(--c); box-shadow: 0 0 6px var(--c); flex: none; }
.cf-net-chip span { max-width: 64px; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: #d4d9de; }
.cf-net-chip.is-off { background: rgba(255,81,72,.16); }
.cf-net-chip.is-off span { color: #ff9b94; text-decoration: line-through; }
.cf-hud.is-compact .cf-net-chip span { display: none; }
.cf-netwait { position: absolute; top: 42%; left: calc((100% - var(--cf-panel-w) - 20px) / 2); transform: translate(-50%, -50%); z-index: 22; width: min(360px, calc(100% - var(--cf-panel-w) - 40px)); padding: 14px 16px; border-radius: 12px; display: flex; flex-direction: column; gap: 10px; animation: cf-fade .2s ease-out; }
.cf-hud.is-left .cf-netwait { left: calc(var(--cf-panel-w) + 20px + (100% - var(--cf-panel-w) - 20px) / 2); }
.cf-netwait-head { display: flex; align-items: center; gap: 10px; }
.cf-netwait-head b { font-size: 15px; letter-spacing: .1em; }
.cf-netwait-names { display: flex; flex-wrap: wrap; gap: 6px; }
.cf-netwait .cf-card-actions .cf-btn, .cf-netblock .cf-card-actions .cf-btn, .cf-spectate .cf-btn { min-height: 32px; padding: 5px 14px; font-size: 13px; justify-content: center; align-items: center; }
.cf-netblock { z-index: 28; }
.cf-netblock .cf-card { border-color: rgba(255,81,72,.55); }
.cf-netblock .cf-card-title b { color: #ffd0cc; }
.cf-spectate { position: absolute; bottom: 14px; left: calc((100% - var(--cf-panel-w) - 20px) / 2); transform: translateX(-50%); z-index: 12; display: flex; align-items: center; gap: 14px; padding: 7px 8px 7px 16px; border-radius: 10px; white-space: nowrap; border-color: rgba(255,81,72,.5); animation: cf-fade .2s ease-out; }
.cf-hud.is-left .cf-spectate { left: calc(var(--cf-panel-w) + 20px + (100% - var(--cf-panel-w) - 20px) / 2); }
.cf-spectate b { letter-spacing: .1em; }
.cf-chatbar { position: absolute; top: 56px; left: 10px; width: 330px; z-index: 13; display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border-radius: 9px; animation: cf-fade .12s ease-out; }
.cf-hud.is-left .cf-chatbar { left: calc(var(--cf-panel-w) + 20px); }
.cf-chatbar .cf-input { height: 30px; }
.cf-chatbar small { white-space: nowrap; }
.cf-hud.is-chatting .cf-feed { top: 102px; }
.cf-toast.is-chat { --cf-tone: var(--cf-chat, #9fc6ff); }
.cf-toast-body b .cf-toast-from { color: var(--cf-chat, #9fc6ff); margin-right: 6px; }

@media (max-width: 1100px) {
  .cf-room { grid-template-columns: minmax(0, 1.4fr) minmax(270px, 1fr); gap: 8px; }
  .cf-seat { grid-template-columns: 16px minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, .8fr) 26px 88px 22px; gap: 5px; }
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
