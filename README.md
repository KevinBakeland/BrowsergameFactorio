# Factory Game

Een multiplayer browser-Factory Game, geïnspireerd op Factorio. Spelers verkennen een wereld, verzamelen resources, bouwen machines en stellen productielijnen op.

## Hoe werkt de game?

- **Wereld**: bij het starten van de server wordt een wereld van 100x100 tegels gegenereerd met clusters van bomen en ertsvelden (kool, brons, ijzer) plus water.
- **Verzamelen**: loop naar een resource en druk op `E` om te interagieren. Bomen geven hout, ertsen geven kool/brons/ijzer.
- **Craften**: gebruik je inventaris om items te maken, bijvoorbeeld:
  - 2 hout → 2 planken
  - 5 ijzer → 1 oven
  - 1 brons + 1 kool → 1 bronsstaaf
  - 5 bronsstaven → 1 mijnbouwmachine (miner)
- **Bouwen**: plaats machines (oven 2x2, miner 4x4) in de wereld. Machines produceren automatisch items uit de resources om hen heen.
- **Multiplayer**: meerdere spelers kunnen tegelijk spelen via Socket.IO; posities en wereldwijzigingen worden live gesynchroniseerd.

## Besturing

| Toets | Actie |
|-------|-------|
| `W` / `A` / `S` / `D` | Bewegen |
| `E` | Interagiere (verzamelen van resources) |
| Muisklik | Bouwmodus / plaatsen van machines |

## Vereisten

- Node.js
- npm

## Installatie & starten

```bash
npm install
node server.js
```

De server draait op `http://localhost:3000`. Open deze URL in (meerdere) browser-tabbladen om te spelen.

## Projectstructuur

```
├── server.js          # Express + Socket.IO server, game-state en netwerklogica
├── server/
│   ├── world.js       # Wereldgeneratie (bomen, ertsen, water)
│   └── recipes.js     # Crafthebbare recepten
└── client/
    ├── index.html     # UI (naamscherm, inventaris, canvas)
    ├── style.css
    └── js/
        └── main.js    # Speler, rendering, besturing en netwerkcommunicatie
```

## Stack

- [Express](https://expressjs.com/) voor static hosting
- [Socket.IO](https://socket.io/) voor realtime multiplayer
- Canvas API voor rendering
