# CineTrack

CineTrack is my personal movie and TV tracking app. It helps me keep track of what I want to watch, what I'm watching, what I've finished, ratings, rewatches, and episode progress.

The app runs locally and keeps my library on my machine. Movie and TV information comes from TMDb.

## Tech stack

* React and TypeScript
* Vite
* Tailwind CSS
* Recharts
* SQLite with `sql.js`
* TMDb API
* Vitest

## Requirements

* Node.js 22.12 or newer
* npm
* A TMDb API key

## Setup

Install the dependencies:

```bash
npm ci
```

Create a `.env` file in the project root and add your TMDb key:

```env
TMDB_KEY=your-key-here
```

## Run locally

Start the development server:

```bash
npm run dev
```

The app will run at the address shown in the terminal.

## Production

Build the app:

```bash
npm run build
```

Start the local production server:

```bash
npm run start
```

## Useful commands

```bash
npm test          # run tests
npm run typecheck # check TypeScript
npm run build     # create production build
npm run start     # run production server
```

## Project layout

* `src/` contains the React app and UI.
* `src/components/` contains the main app components.
* `src/lib/` contains the library, TMDb, and settings logic.
* `data/` contains the local database.
* `.github/` contains the CI workflow.

CineTrack is made for personal, local use. Your library stays on your machine apart from requests to TMDb for movie and TV metadata.

## Privacy

CineTrack collects nothing: no analytics, no tracking, no accounts, and no data leaves your machine except direct requests to the TMDb API for movie and TV metadata. Your entire library lives in the local SQLite database in `data/` and your browser storage.