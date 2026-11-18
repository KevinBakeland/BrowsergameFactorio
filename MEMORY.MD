# Fabriek.io — werknotities

## Project
Multiplayer Factorio-achtje, Node (express + ws). Server-geautoriseerd, 20 TPS. Map 60x45.

## Draaien
- Server: `node server/index.js` (vanuit de fabriek-map) → http://localhost:3000. Na wijzigingen aan server-code: herstarten verplicht (oude terminal killen, command opnieuw).
- Testserver (ws-tests): `$env:PORT='3001'; node server/_testserver.js` (heeft `testgive`-cheat; port 3001 zodat productie op 3000 ongestoord blijft).

## Stack / bestanden
- `server/index.js` — autoritair. Constants: TICK_MS=50, MINE_SPEED=1.4/s, BELT_SPEED=1.6, INSERTER_CYCLE=250ms, MINER_CAP=64, CHEST_SLOTS=16, STACK_MAX=100. DIRS=[[1,0],[0,1],[-1,0],[0,-1]] (rot 0=rechts,1=omlaag,2=links,3=omhoog).
- `server/world.js` — map generatie.
- `client/game.js` — canvas renderer + UI. TILE=32, rAF, camera lerp.
- Tile codes: 0=gras, 1=water, 2=coal, 3=iron, 4=copper, 5=stone.

## Machines (fase 6)
- Miner: 2x2, auto-mined ore, interne buffer (store, cap 64).
- Kist: 16-slot opslag.
- Inserter: roteerbaar, front=DIRS[rot] (pak), back=DIRS[(rot+2)%4] (duw).
- Loopband: gericht, items varen met u 0->1.

## Autocrafter (fase 7, server+client klaar)
- Machine 2x2, key `6` in hotbar. Geen generieke storage — alleen in-slots die exact matchen met het gekozen recept.
- Data-model: `{ recipe:string|null, inputs:[{id,n}], out:{id,n}|null, progress }`. `inputs` heeft per recept een slot per materiaal (volgorde = `Object.keys(CRAFT[recipe].inputs)`). Slot 0..n-1 = materialen, slot n = output.
- `bupdate` veld is **`prog`** (niet `progress`). Client normaliseert in `applyBuilding`→`b.ac={prog,recipe,inputs,out}`.
- Recept wijzigen: `{t:'acreceipt', id, recipe}` (null=geen). Server: valideert `CRAFT[recipe]`, BUILD_RANGE vanaf 2x2-midden, reset progress, herbouwt `inputs=[{id,n:0}]`.
- `AC_CRAFT_TIME=1000ms` (zelfde tempo als hand-craften CRAFT_TIME). `AC_OUT_CAP=100`. Craft alleen als out null/matchend + ruimte én alle in-slots genoeg hebben.
- Inserter pakt uit autocrafter (eerst out, dan in-slots met n>0) en duwt naar bijpassende in-slot; band eindvoer→bijpassende in-slot. Demolish dropt in-slots + out.
- Client: `CRAFT_UI`-rij hergebruikt als recept-knoppen (`buildAcRecipeRow`), `renderPanel` herbouwt in-slots bij receptwissel (`acSlotCount`).

### Bugs deze sessie (na eerste testronde) gefixt
- **Inserter sukte in-slots leeg** (server tickInserter pak-faze): bij autocrafter pakte hij na `out` ook materialen uit in-slots → staven verdwenen en het craften stopte. Fix: inserter pakt bij autocrafter **alleen** `gb.out`. Handmatig pakken uit in-slots (grabFrom) blijft wel werken.
- **Receptknoppen niet klikbaar** (CSS): `#machinePanel` ervelde `pointer-events: none` van `#hud` → `elementFromPoint` gaf het canvas. Fix: `pointer-events: auto` op `#machinePanel`.
### Eerder deze sessie (recepten niet te kiezen)
1. `buildAcRecipeRow`: `mkBtn` maakte knop maar **`acRecipeRow.appendChild(btn)` ontbrak** → rij leeg, geen knoppen. (PRINCIPALE oorzaak)
2. `buildAcRecipeRow`: rij werd alleen ingevoegd als `!acRecipeRow`; na `.remove()` (closePanel) bleef variabeel naar gedetacht div wijzen → niet opnieuw in DOM. Fix: her-plaatsen als `parentNode` verschilt.
- NB: `server/_actest.js` (oorspronkelijk scratch-testbestand) is tijdens debuggen overschreven met een ws-autocrafter-test; niet git-getracked, originele inhoud onherstelbaar.

## Onlangs gefixt (deze sessie)
- Badge `.craft-q` bleef altijd zichtbaar met "1" erop, ook na craft voltooid: **CSS `display: flex` overschreef het `hidden` attribuut**. Fix: `.craft-q[hidden] { display: none; }` in style.css.
- Server tickBelts: item dat einde band bereikt op zelfde-richting band -> spliced uit huidige band en in volgende band geduwd (was: bleef in huidige -> snapte terug).
- Server tickInserter: push naar band alleen als `entryClear = !pb.items.some(it2 => it2.u < 0.5)` (was: length===0).
- Server tickBelts: band->kist en band->miner eindvoer toegevoegd.
- Server tickBelts: **grond-items (droppedItems) worden nu opgepakt door een loopband** als de ingang vrij is (u<0.4); dichtstbijzijnde item op de tegel, broadcast `{t:'pickup',id}`.
- Client renderPanel: miner leest `b.store` (was `b.buf` -> leeg paneel).
- Client drawBuilding inserter: 180° zwaaiende arm met tang, start op pakzijde.
- Client drawBuilding belt: chevrons die in transport-richting scrollen (dirSign).
- Client: **belt `horiz` declaratie vóór gebruik verplaatst** -> ReferenceError (TDZ) per frame verholpen; die brak draw() af (onzichtbare speler + "rare grid").
- Client: **machine-paneel zichtbaarheid** — openBuilding/closePanel togglen nu het `hidden`-attribuut (was `style.display`, dat `hidden` niet overschrijdt). Click op miner/kist opent nu zichtbaar paneel met slots + drag&drop.
- **Inserter-animatie (arm stutering opgelost)**: Server tickInserter opsplitsen in FAZE 1 (pakken → `buf` set) + FAZE 2 (plaatsen → `buf` leeg). Constanten: `INSERTER_CYCLE` verwijderd → `INSERTER_HOLD=500`ms (arm beweegt pak↔duw) + `INSERTER_RETRY=200`ms (band vol → herhaal place, arm blijft op duw-kant met item).
- Client updateBuilding: `if ('buf' in m)` (was `!= null`) zodat `b.buf` WÉL naar null gaat na plaatsen (was: arm bevriezde altijd op duw-kant). `b._lastRes` onthoudt laatste res.
- Client drawBuilding inserter: arm volgt `b.buf` via lerp (0.10/frame ≈ 500ms), swing 0=pak-kant, 1=duw-kant; item zichtbaar alleen als `b.buf` gevuld.

## Geverifieerd (browser)
- **Autocrafter**: receptknoppen (Koperdraad/Basic chip/Tandwiel/geen) zichtbaar in paneel; kiezen van Basic chip → 2 in-slots (IJzeren staaf + Koperdraad) + output-slot, legenda "maakt Basic chip · 0%"; server bevestigt `recipe=basic_chip`, `inputs=[iron_ingot:0,copper_wire:0]`. Sluiten (Esc) + heropenen herplaatst de rij.
- Receptknoppen klikbaar na `pointer-events: auto` op `#machinePanel` (echte muis-klik → server bevestigde `recipe=basic_chip`).

## Nog niet getest (user test zelf)
- Inserter pakt bij autocrafter nu alleen `out` (niet meer in-slots) — pas ingeleverd, nog niet in de browser bekeken.
- Transport miner->inserter->belt->kist werkt; chevrons scrollen correct.
- Kist-paneel: 16 slots, zichtbaar. Miner-paneel: 1 slot (store), zichtbaar. Esc sluit paneel.
- `node --check` client + server OK.
- Crafting: `i` opent invCraft (Inventaris-tab); klik op "Craften" tab wisselt naar craft-tab; craft-klik zonder materialen → toast (server-validering); tab-klik terug werkt. Fix: `pointer-events: auto` op `#invCraft .tab` (geërfd none van `#hud`).
- **Craft-queue (ws-test, testserver port 3001 + `testgive` cheat)**: 5× snels-klikken → 5 items, elk exact 1s (klaar op ~1.6/2.7/3.8/5.0/6.2s), badge telt mee 5→4→…→0, bar vult per item. **Fixes**: (1) `craftProg -= CRAFT_TIME` toegevoegd — zonder shiftten restant >= CRAFT_TIME en gingen resterende items per tick (50ms) weg; (2) `cqueue` nu ook na elk tick-klare item → badge verdween niet. Browser-doorloop (bar onder char, badges zichtbaar) = **niet getest, user test zelf**.
- Testinfrastructure: `server/_testserver.js` (kopie index.js + `testgive` = 5 koperen staven; port via `\$env:PORT='3001'`), `server/_crafttimingtest.js` (ws-client die craft-queue logt). Beide ephemeral.
- Server-meldingen: init = `t:'init'`, inventaris = `{t:'inv', inv:{slots,cursor}}` (NIEUW `m.inv.slots`).

## AKKOORD PLAN: Inserter 1-item + Oven (geakkoord 2026-07-22)
Keuzes (gebruiker):
- Inserter: **1 eenheid per draai** (max 1 per 0.25s). Belt/miner/chest pakken allemaal 1 eenheid. Push duwt de (max-1) buffer.
- Oven-snelheid: **1 ingot per ~2s** (1 erts + 1 kool -> 1 ingot).
- Oven-output: **1 slot, 1 type, max 100**.
- Verticale-band bug `off is not defined`: **fix mee**.

Oven (server):
- Nieuw type `oven` (1x1). State: `{ fuel:0, ore:null, out:null, progress:0 }` (slots zijn `{id,n}` of null).
- Recipies: copper ore + coal -> copper ingot; iron ore + coal -> iron ingot.
- `OVEN_CYCLE = 2000ms`. Smelt alleen als ore is copper/iron, fuel>0, out heeft ruimte, en out is leeg of == expected ingot.
- Nieuwe RES: `copper_ingot` + `iron_ingot` (geen tegel, alleen items).
- Inserter: oven = geldig pak-doel (uit out-slot) én duw-doel (naar fuel/ore-slot).
- Band-eindvoer: coal -> oven fuel; copper/iron -> oven ore-slot.
- makeBuilding/bupdate/briefBuilding/demolish/place += oven.

Oven (client):
- RES += ingots (kleuren), BUILD_DEFS.oven {size:1, icon 🔥}, hotbar slot 5 + toets 5.
- drawBuilding oven (gloedt als smelt), paneel 3 slots (ore/fuel/out), openBuilding/renderPanel oven-case, click-conditie += oven, grabFrom/dropTo += oven, updateBuilding spijgelt fuel/ore/out.

Volgorde: server (world.js -> index.js) -> client -> node --check -> herstart -> browser check.

## AKKOORD PLAN: UI — inventaris verborgen + chat doorzichtig (geakkoord 2026-11-10)
Keuzes (gebruiker):
- Inventaris: **verborgen bij spawn**, openen/sluiten met `i` (bestaande toggle blijft werken).
- Chat: **doorzichtig/ingeremd bij rust** (opacity laag; berichten nog zichtbaar, input inactief). Op **y** → helder + input gefocust. **Enter** post het bericht (focust níét meer). Op y-weder / Esc / blur → terug doorzichtig.
- `Enter` opent de chat níét meer; alleen **y**.

Wijzigingen:
- index.html: `#inventory` += `style="display:none"`; `#controls` hint += `i` inventaris + `y` chat (en 1-4→1-5).
- style.css: `#chat` default `opacity:.42` + transition; `#chat.active` → `opacity:1`.
- game.js: verwijder `if (e.code==='Enter') chatInput.focus()`; voeg `KeyY` → `chatInput.focus()` toe; `chatInput` focus/blur → toggle `#chat.active`.

Volgorde: index.html → style.css → game.js → node --check client → browser reload + test.

## AKKOORD PLAN: Crafting-systeem + inventory-redesign (geakkoord 2026-11-10)
Keuzes (gebruiker):
- Nu alleen het **systeem** + de **tussenvormen** (koper→draad, ijzer→staven), steen + machines craften komt LATER.
- **Koperdraad** = hand-craft: **1 koperen staaf (uit oven) → 1 koperdraad** (nieuw item `copper_wire`).
- **IJzeren staven** blijven **alleen oven** (geen hand-craft).
- **Machines**: plaatsen blijft **gratis/vrij** (geen consumptie); craften van machines = later.
- **Craft-UI**: eigen paneel met grid + tooltips (naam + recept), openen/sluiten met **C**, 1 click = 1× craften.
- **Wijziging (2026-11-18)**: inventory + crafting samengevoegd in ÉÉN paneel `#invCraft` met twee tabs (Inventaris / Craften). `i` → Inventaris-tab, `c` → Craften-tab, tab knoppen klikbaar, Esc sluit. Oorspronkelijke 2 aparte panelen (`#inventory` + `#craftPanel`) zijn vervangen.
- **Inventory**: emoji-iconen per item (Factorio-achtig), data-gedreven `ITEMS`-catalogus.
- **Wijziging (2026-11-18, user)**: craften duurt **1s per item** met **craft-queue**. Links klik = +1 in queue (badge getal op het item), rechtermuisklik = −1 uit queue. Laadbar **onder het personage** tijdens craften (server-authoritatief, via `craft`-veld in pos-broadcast: `{id, n, prog}`).

Queue-implementatie (server/index.js):
- `CRAFT_TIME=1000`ms, `CRAFT_QUEUE_MAX=50`; speler staat `craftQueue[]` + `craftProg`.
- `case 'craft'`: valideert HELE queue (helper `queueCost`) → push + `{t:'cqueue',n}`. `case 'cunqueue'`: pop + cqueue.
- tick-loop: `craftProg += TICK_MS`; bij `>= CRAFT_TIME` → `craftProg -= CRAFT_TIME` (belangrijk: anders lopen resterende items per tick weg!), shift item, materialen verbruiken (bij te weinig: `perr` + skip), `sendInv`, en `cqueue` sturen (badge updaten naar 0).
- pos-broadcast: `craft: {id, n, prog} | 0` per speler.
- Badge (client): `setCraftBadge()` — wordt bij ELKE pos (20 TPS) van eigen speler bijgewerkt én op `cqueue`; badge is dus server-stuurbaar en verdwijnt gegarandeerd bij lege queue (fix: badge bleef op oude pagina's staan).

Wijzigingen:
- server/index.js: `CRAFT = { copper_wire: { inputs:{copper_ingot:1}, output:{id:'copper_wire',n:1} } }`; helpers `countItem(p,id)` + `removeItem(p,id,n)`; `case 'craft'` (valideert inputs → verbruikt → `addItem(p.inv,...)` → `sendInv(p)`).
- client/game.js: `ITEMS` (icon+name) + `itemIcon/itemName` + `CRAFT_UI`; `renderInventory`/`renderPanel`/cursor tonen emoji (conditie `ITEMS[s.id]` i.p.v. `RES`); `buildCraftPanel`/`toggleCraft`; `KeyC` → toggleCraft.
- index.html: `#craftPanel` (head + `#craftSlots` + legend); `#controls` += `C` craften.
- style.css: `.slot-item` → gecentreerd emoji (flex); `#craftPanel`/`.craft-slot`/`.craft-icon`/`.craft-name` styling.

Volgorde: server → client → html → css → node --check (server+client) → herstart server → browser: craft paneel, koperstaaf→koperdraad, inventaris emoji.

## Nog te doen / ongetest
- Crafting-recepten nu (2026-11-18): koperen staaf→koperdraad; ijzeren staaf + koperdraad→basic chip; ijzeren staaf→**2× tandwiel** (`gear`, output n:2). Badges zijn nu per-recept (server stuurt `cqueue.counts`, client `.craft-q[data-id]`).
- Nog te doen crafting: steen-recipes en **machine-recipes** (dan place consumeert het item).
- server/smoketest.js is nog niet bijgewerkt voor machine-transport.
- Volledige end-to-end: items vloeien van miner tot gevulde kist in realtime (nog niet gecontroleerd met items erin).
- Langetermijn: stoomgenerators, elektrische oven, elektrische miner.

## Afspraken (uit AGENTS.MD + user)
- Geen wachtwoorden/keys in deze file.
- Vraag vóór commit/push.
- **User test zelf altijd de browser** na afloop van code. Ik doe alleen snelle checks (syntax, ws/automated tests) en meld dan klaar → user geeft terug wat goed/slecht werkt. Geen uitgebreide browser-verificatie meer door mij tenzij gevraagd.
