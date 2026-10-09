# CineTrack

CineTrack helps you keep track of films and TV shows you want to watch or have seen. Find titles through TMDb, then save them to your local library with ratings, favourites, rewatches, and episode progress.

## Run locally

You’ll need [Node.js 22.12 or later](https://nodejs.org/) and a [TMDb API key](https://www.themoviedb.org/).

1. Install the dependencies:

   ```bash
   npm ci
   ```

2. Create a `.env` file in the project folder and add your key:

   ```env
   TMDB_KEY=your-key-here
   ```

3. Start CineTrack:

   ```bash
   npm run dev
   ```

Open the address printed in the terminal. Your library is stored on your device.

To run the production build locally, use `npm run build` followed by `npm run start`.
