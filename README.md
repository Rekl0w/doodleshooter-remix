# DoodleShooter Remix

**11 maps, 11 guns, a katana, and grappling through the sky.** Survive waves on your own or challenge friends in online free for all.

## Original game and credits

This is a community remix of **[DoodleShooter by iifor](https://github.com/iifor/doodleshooter)**. Thanks to the original creator and contributors for the game this project builds on. Credits and links also appear in the main menu.

- **Play the original:** [doodleshooter.vercel.app](https://doodleshooter.vercel.app/)
- **Original source:** [iifor/doodleshooter](https://github.com/iifor/doodleshooter)
- **Remix source:** [Rekl0w/doodleshooter-remix](https://github.com/Rekl0w/doodleshooter-remix)
- The [original README](docs/UPSTREAM_README.md) and upstream Git history are preserved.

## Features

- **11 maps:** compact VS arenas, large dense forests, a Dust 2 adaptation, and a city with 24 towers.
- **Weapons:** rifle, shotgun, sniper, revolver, SMG, AK-47, M4A1, dual pistols, FAMAS, M249, DMR, and katana.
- **Adjustable scopes:** sniper 2× / 4× / 8×; DMR 2× / 3× / 4× / 6×.
- **Grappling:** hold Q to attach and reel in; release to carry your momentum. Flying ducks and swallows can carry you too.
- **Grenades and mines:** expanded blast areas, cover-aware damage, and online synchronization.
- **Solo resupply:** improved ammo drops, katana kill rewards, and unlimited revolver reserve ammo.
- **English by default, optional Turkish:** use **Language / Dil** in the main menu. Your choice is saved locally; changing language reloads the menu. Players using different languages can share the same lobby.
- **Two visual styles on every map:** after selecting a map, choose **Lined notebook** or **Solid colors**. Solid mode removes paper lines, crosshatching, and outline wobble. Your preference is saved per map and only affects your own view, including online games.
- Mouse sensitivity, inverted look, music settings, map previews, and gamepad support.
- Fixes for repeated wall jumping, weapon poses, reload states, and leaving map boundaries.

## Controls

| Action | Input |
| --- | --- |
| Move / look | WASD / mouse |
| Sprint / slide | Shift / C or Ctrl |
| Fire / slash | Left mouse button |
| Aim / block with katana | Right mouse button |
| Jump / leap off the rope | Space |
| Grapple and reel in | Hold Q; release to detach |
| Quick katana | F or V |
| Reload | R |
| Grenade | G; hold to throw farther |
| Place mine | B |
| Select weapon | 1–9, 0, or mouse wheel |
| Scope zoom | Mouse wheel or + / − while aiming |
| Scoreboard | Tab |
| Menu / music | Esc / M |

Use the wheel to reach M249 and DMR. E does not reel in the rope. Gamepad bindings are listed in the in-game **Controls** section.

## Maps

| Map | Setting |
| --- | --- |
| Doodle District | Streets, rooftops, and fire escapes |
| Container Harbor | Containers, cranes, and narrow lanes |
| Paper Canyon | Open sightlines and terraces |
| Rooftop Gardens | Elevated parks linked by bridges |
| Pine Valley | A wide clearing surrounded by woodland |
| Forest Duel | A small, symmetric VS arena |
| Lakeside | Piers and open meadows |
| Deep Forest | 288 × 288; dense pines, rocks, and cabins |
| Lost Woods | 352 × 352; ruins and plenty of hiding places |
| Dust 2 · Remix | Radar-based long, short, mid, A/B sites, and tunnels |
| Skyline City | 24 buildings, elevated bridges, and grappling routes |

![Dust 2 Remix — current map overview](docs/images/dust2.png)
![Skyline City](docs/images/skyline.png)

The Dust 2 screenshot shows this remix's current geometry. The added staircase/ramp between CT and A has been removed; the existing short bridge and long approach remain. Invisible outer boundaries prevent falling out of the map.

Dust II is based on **Counter-Strike / Valve** references: [Valve's Dust II presentation](https://www.counter-strike.net/dust2/) and the [CS2 radar layout](https://cs2caller.com/dust2/callouts). Geometry in this project is generated in code; it does not include CS2's original models, textures, exact dimensions, or bomb-defusal mode.

## Play with friends

1. Everyone opens the same up-to-date game URL.
2. Choose **ONLINE → Private · Friends → Create room**.
3. Share the room code; friends enter it and press **Join**.
4. The **host** chooses the map and presses **Start match**. Guests wait for the host; they cannot start the match or change the map.

After the map is selected, each player can choose their own visual style below the map cards.

Up to **10 players**, with a target of **20 kills**. Joining a match already in progress is supported. Use **Quick play** to find public rooms.

PeerJS handles discovery and WebRTC carries player traffic. The host's browser runs the match. This release uses the `v9` room namespace so older gameplay versions cannot join it. Internet access is required; some NAT/firewall configurations may block direct connections. There is no TURN relay or server-side anti-cheat.

## Run locally

With Python 3:

```bash
python serve.py 8911
```

Open [localhost:8911](http://127.0.0.1:8911/). On Windows, you can also double-click `OYNA.cmd` with Python installed. ES modules require an HTTP server, so do not open the game through `file://`.

## Netlify / static hosting

The game runs entirely in the browser. To prepare a deployment directory with Node.js 22+:

```bash
node scripts/build.mjs
```

This copies only runtime files into `dist/`. Documentation, tests, and local development tools are excluded.

The included `netlify.toml` configures:

- **Branch:** `main`
- **Build command:** `node scripts/build.mjs`
- **Publish directory:** `dist`
- **Environment variables:** none required

Import the GitHub repository into Netlify or upload the generated `dist/` directory manually. Other static hosts can serve the same directory. Cache headers require revalidation so updates are picked up on the next refresh.

## Tests

Start the local server, then use a Playwright installation:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/run.mjs
node tests/maps.mjs
node tests/expansion.mjs
node tests/dust2.mjs
node tests/ui.mjs
node tests/appearance.mjs
node tests/online.mjs
```

On Windows, tests use installed Microsoft Edge. Set `GAME_URL` to use another server, or `PLAYWRIGHT_MODULE` to point to an existing Playwright installation. UI and online tests create private rooms and require internet access. Run browser suites sequentially.

Coverage includes movement, ammo, damage, map loading, safe spawns, bot paths, scopes, dual pistols, Dust traversal and boundaries, English/Turkish persistence, lobby card styles, host-only match starts, and real two-client WebRTC synchronization.

## Technology and contributions

JavaScript ES modules, [Three.js](https://threejs.org/), [PeerJS](https://peerjs.com/), and Web Audio. Most geometry and sound are generated in code. Browser dependencies are vendored under `vendor/`.

UI text uses `ui('Text')` or tagged templates such as `` ui`Score: ${score}` ``. English is the source language; Turkish translations live in `src/locales/tr.js`. Keep numbered placeholders intact and never translate player names or protocol identifiers.

When reporting a bug, include the map, weapon, solo/online mode, and reproduction steps. Preserve the original creator credits in contributions.
