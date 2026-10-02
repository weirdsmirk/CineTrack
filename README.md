# CineTrack

A personal movie and TV tracking app. Track what you want to watch, what you're
watching, and what you've finished, with ratings, rewatches, and episode progress.

It runs locally and keeps your library on your machine. Movie and TV information
comes from [TMDb](https://www.themoviedb.org/).

Built with React, TypeScript, Vite, Tailwind CSS, Recharts, and SQLite via `sql.js`.

## Requirements

* Node.js 22.12 or newer
* A TMDb API key

## Setup

```bash
npm ci
```

Create a `.env` file in the project root:

```env
TMDB_KEY=your-key-here
```

## Usage

```bash
npm run dev       # start the dev server
npm run build     # create a production build
npm run start     # serve the production build on 127.0.0.1
npm run typecheck # check TypeScript
npm run verify    # typecheck and build
```

Both servers run at the address shown in the terminal.

## Layout

* `src/` — the React app
* `src/components/` — UI components
* `src/lib/` — library, TMDb, and settings logic
* `vite.config.ts` — dev and preview server, SQLite persistence, TMDb proxy
* `data/` — your local database, never committed

## Privacy

No analytics, no tracking, no accounts. Nothing leaves your machine except direct
requests to TMDb for movie and TV metadata.

## License

[MIT](LICENSE). Movie and TV metadata, posters, and stills are provided by
[TMDb](https://www.themoviedb.org/); TMDb's own terms apply to its data and imagery.
