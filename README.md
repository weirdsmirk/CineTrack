# CineTrack

CineTrack is my personal movie and TV tracking app. I made it to keep track of what I want to watch, what I'm watching, what I've finished, and my ratings.

It runs locally and keeps the library on your machine. Movie and TV information comes from TMDb.

## What it does

* Track movies and TV shows
* Mark titles as planned, watching, watched, or dropped
* Track TV episodes and seasons
* Rate and favourite titles
* Keep a rewatch history
* Search and discover movies and shows
* View basic stats about your library
* Import and export your data

## Tech Stack

* React
* TypeScript
* Vite
* Tailwind CSS
* Recharts
* SQLite with sql.js
* TMDb API
* Vitest

## Run Locally

You'll need Node.js 22.12 or newer and a TMDb API key.

Clone the repo and install the dependencies:

```bash
git clone https://github.com/weirdsmirk/CineTrack.git
cd CineTrack
npm ci
```

Add your TMDb key to a `.env` file in the project root:

```env
TMDB_KEY=your-key-here
```

Then start the app:

```bash
npm run dev
```

The app will run locally at the address shown in the terminal.

## Other Commands

```bash
npm test
npm run typecheck
npm run build
npm run start
```

Your local library is stored with the project, so the database can be moved along with it.

---

Metadata is provided by TMDb. CineTrack uses the TMDb API but is not endorsed or certified by TMDb.
