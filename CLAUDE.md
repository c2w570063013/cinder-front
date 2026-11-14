# 燼原戰線 Cinder Front

An **original** isometric real-time strategy game for macOS (base building, ore harvesting, power,
tech tree, two asymmetric factions, fog of war, skirmish vs AI). Classic-RTS *mechanics*, but every
name, faction, unit, piece of art, sound and line of text is our own.

**Hard rule — originality.** Never copy or imitate a specific existing game: no names, factions,
unit designs, UI art, icons, sounds, music, voice lines or maps taken from or modelled on Red Alert,
Command & Conquer, StarCraft or any other title. All art is drawn procedurally in code (Canvas 2D),
all audio is synthesised (WebAudio). No downloaded or third-party assets.

## Stack

- TypeScript (strict) + Vite. Canvas 2D rendering, WebAudio. **Zero runtime dependencies** — do not add any.
- Dev deps are only `typescript`, `vite`, `vitest`. Do not edit `package.json`, `tsconfig.json`,
  `vite.config.ts`, `index.html`, `.claude/launch.json` (commander-owned).
- macOS wrapper: Swift + WKWebView loading the Vite build (`mac/`), built with `swiftc` from a script.
- UI language: Traditional Chinese (zh-Hant), English names as secondary labels.

## Architecture

```
src/core/     FROZEN CONTRACT (commander)  types.ts  api.ts  constants.ts  iso.ts  rng.ts
src/data/     shared defs (commander; sim session may tune numbers, never ids/schema)
src/sim/      deterministic simulation            → exports SimApi members        (session: sim)
src/render/   isometric Canvas renderer + all art → exports createRenderer        (session: render)
src/ui/       HUD, input, menus                   → exports createGameUi, createMenu (session: ui)
src/ai/       skirmish AI                         → exports createAi              (session: ai-maps)
src/maps/     map generators                      → exports MAPS: MapInfo[]       (session: ai-maps)
src/audio/    synthesised sfx / music / announcer → exports createAudio           (session: audio-mac)
mac/          Swift WKWebView app + build script                                  (session: audio-mac)
src/main.ts   game loop + wiring (commander)
dev/          per-session dev pages: dev/<session>.html (+ src/<module>/dev.ts)
```

Data flow, one direction only:

```
input → ui → Command[] ─┐
           ai → Command[] ┴→ sim.step(world, cmds) → world (plain data) + world.events
                                                      ├→ render.render(world, ui.view, alpha)
                                                      ├→ ui.update / ui.handleEvents
                                                      └→ audio.handleEvents
```

- `src/core/types.ts` is the single source of truth for World / Entity / Command / SimEvent.
  `src/core/api.ts` defines the exact interface each module's `index.ts` must export. Read both first.
- Only the sim mutates `World`. Render, ui, ai and audio treat it as **read-only**.
- Modules import from `src/core` and `src/data` freely, and from each other **only via the types in
  `core/api.ts`** (dependencies are passed in, see `UiDeps`, `CreateAi`). Exception: dev pages and
  tests may import other modules' `index.ts` directly if that module already exists.
- Sim is deterministic: fixed 20 Hz tick, no `Math.random`, `Date`, or iteration-order hazards;
  randomness only through `world.rngState` (`core/rng.ts`).
- Coordinates: world = tile units (floats), tile centre = (tx+0.5, ty+0.5). Iso projection lives in
  `core/iso.ts`. Facing = radians in world space. Data defs use seconds and tiles; sim converts with `secToTicks`.

## Working rules for parallel sessions

Several Claude sessions may work in this same folder at the same time (one shared checkout, no worktrees).

- **Stay in your lane.** Create/edit files only inside the directories your brief assigns to you
  (plus your own `dev/<name>.html`). Never edit another module's files, `src/core/*`, or `src/main.ts`.
- **Need a contract change?** Don't edit `src/core`. Work around it locally if you can, and list the
  requested change (exact type diff + why) at the top of your final report; the commander applies it.
  Exception: the `sim` session may *append optional fields* to `core/types.ts` when the sim genuinely
  needs to expose more state, and must mention it in its report.
- Typecheck with `npx tsc --noEmit` — other sessions' half-written files may show errors; you only
  need **your own directories** to be clean. Tests: `npx vitest run src/<yourdir>`.
- Use your own dev-server entry in `.claude/launch.json` (`dev-<name>`, own port) and your own dev page,
  so you can verify visually in the Browser pane without waiting for other modules. If another module
  you'd like to demo against doesn't exist yet, build a small fake (e.g. a hand-made static `World`)
  inside your dev page.
- Verify your work for real (run tests / look at it in the browser) before reporting done. Report
  what works, what is stubbed, and what you could not verify.
- The repo is under git (`main`). Sub-sessions don't commit, switch branches or install packages — the
  commander commits integrated work.
