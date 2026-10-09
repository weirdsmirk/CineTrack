import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForServer(child, url) {
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Vite exited before starting:\n${output}`)
    try {
      const response = await fetch(url)
      if (response.ok) return output
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not become ready:\n${output}`)
}

test('local server applies per-record patches and protects private routes', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cinetrack-server-test-'))
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  let child

  try {
    cpSync(path.join(projectRoot, 'src'), path.join(root, 'src'), { recursive: true })
    cpSync(path.join(projectRoot, 'public'), path.join(root, 'public'), { recursive: true })
    cpSync(path.join(projectRoot, 'vite.config.ts'), path.join(root, 'vite.config.ts'))
    cpSync(path.join(projectRoot, 'index.html'), path.join(root, 'index.html'))
    cpSync(path.join(projectRoot, 'package.json'), path.join(root, 'package.json'))
    symlinkSync(path.join(projectRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir')

    const env = {}
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR']) {
      if (process.env[key]) env[key] = process.env[key]
    }
    env.NODE_ENV = 'test'
    env.PORT = String(port)
    const startServer = () => spawn(process.execPath, [path.join(projectRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = startServer()
    await waitForServer(child, base)

    const post = (route, body, origin = base) => fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    })
    const entry = (id, title) => ({
      id,
      mediaType: 'movie',
      title,
      year: '2000',
      poster: null,
      backdrop: null,
      rating: null,
      status: 'planned',
      favorite: false,
      addedAt: 1,
      watchedAt: null,
      runtime: null,
      totalEpisodes: null,
      episodes: {},
      rewatches: [],
      rewatching: false,
      rewatchEpisodes: {},
    })

    const libraryWrites = await Promise.all([
      post('/__data/library', { clear: false, changes: { 'movie:1': entry(1, 'First title') } }),
      post('/__data/library', { clear: false, changes: { 'movie:2': entry(2, 'Second title') } }),
    ])
    assert.deepEqual(libraryWrites.map((response) => response.status), [204, 204])
    let response = await fetch(`${base}/__data/library`)
    assert.equal(response.status, 200)
    let library = await response.json()
    assert.deepEqual(Object.keys(library).sort(), ['movie:1', 'movie:2'])

    assert.equal((await post('/__data/library', { clear: false, changes: { 'movie:1': null } })).status, 204)
    library = await (await fetch(`${base}/__data/library`)).json()
    assert.deepEqual(Object.keys(library), ['movie:2'])

    assert.equal((await post('/__data/library', { clear: true, changes: {} })).status, 204)
    library = await (await fetch(`${base}/__data/library`)).json()
    assert.deepEqual(Object.keys(library), [])

    const dropped = { ...entry(4, 'Dropped series'), mediaType: 'tv', status: 'dropped', watchedAt: 1234, episodes: { '1-1': 1200 }, rewatching: true, rewatchEpisodes: { '1-2': 1201 } }
    assert.equal((await post('/__data/library', { clear: false, changes: { 'tv:4': dropped } })).status, 204)
    library = await (await fetch(`${base}/__data/library`)).json()
    assert.equal(library['tv:4'].status, 'dropped')
    assert.equal(library['tv:4'].watchedAt, 1234)
    assert.deepEqual(library['tv:4'].episodes, { '1-1': 1200 })
    assert.equal(library['tv:4'].rewatching, false)
    assert.deepEqual(library['tv:4'].rewatchEpisodes, { '1-2': 1201 })

    const droppedMovie = { ...entry(6, 'Legacy dropped movie'), status: 'dropped', watchedAt: 1300, rating: 8, note: 'Keep movie data' }
    assert.equal((await post('/__data/library', { clear: false, changes: { 'movie:6': droppedMovie } })).status, 204)
    library = await (await fetch(`${base}/__data/library`)).json()
    assert.equal(library['movie:6'].status, 'planned')
    assert.equal(library['movie:6'].watchedAt, 1300)
    assert.equal(library['movie:6'].rating, 8)
    assert.equal(library['movie:6'].note, 'Keep movie data')

    const rewatching = {
      ...entry(5, 'Rewatching series'),
      mediaType: 'tv',
      status: 'watched',
      watchedAt: 900,
      episodes: { '1-1': 800 },
      rewatching: true,
      rewatchEpisodes: { '1-1': 1000 },
      rewatches: [700],
    }
    assert.equal((await post('/__data/library', { clear: false, changes: { 'tv:5': rewatching } })).status, 204)
    const invalidMovieRewatch = {
      ...entry(6, 'Movie'),
      rewatching: true,
      rewatchEpisodes: { '1-1': 1000 },
    }
    assert.equal((await post('/__data/library', { clear: false, changes: { 'movie:6': invalidMovieRewatch } })).status, 204)
    library = await (await fetch(`${base}/__data/library`)).json()
    assert.equal(library['tv:5'].rewatching, true)
    assert.deepEqual(library['tv:5'].rewatchEpisodes, { '1-1': 1000 })
    assert.equal(library['tv:5'].status, 'watched')
    assert.equal(library['tv:5'].watchedAt, 900)
    assert.deepEqual(library['tv:5'].episodes, { '1-1': 800 })
    assert.deepEqual(library['tv:5'].rewatches, [700])
    assert.equal(library['movie:6'].rewatching, false)
    assert.deepEqual(library['movie:6'].rewatchEpisodes, {})

    const completedRewatch = {
      ...entry(7, 'Completed rewatch'),
      mediaType: 'tv',
      status: 'watched',
      watchedAt: 500,
      episodes: { '1-1': 400 },
      rewatches: [700, 1100],
    }
    assert.equal((await post('/__data/library', { clear: false, changes: { 'tv:7': completedRewatch } })).status, 204)

    const settingsWrites = await Promise.all([
      post('/__data/settings', { theme: 'velvet' }),
      post('/__data/settings', { archiveName: 'My Archive' }),
    ])
    assert.deepEqual(settingsWrites.map((response) => response.status), [204, 204])
    const settings = await (await fetch(`${base}/__data/settings`)).json()
    assert.equal(settings.theme, 'velvet')
    assert.equal(settings.archiveName, 'My Archive')

    assert.equal((await post('/__data/library', { 'movie:3': entry(3, 'Cross-site') }, 'http://attacker.example')).status, 403)
    assert.equal((await fetch(`${base}/data/database.sqlite`)).status, 404)
    assert.deepEqual(readdirSync(path.join(root, 'data')).sort(), ['database.sqlite'])

    const previous = child
    child = null
    previous.kill('SIGTERM')
    await Promise.race([once(previous, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))])
    child = startServer()
    await waitForServer(child, base)
    library = await (await fetch(`${base}/__data/library`)).json()
    assert.equal(library['tv:4'].status, 'dropped')
    assert.equal(library['tv:4'].watchedAt, 1234)
    assert.equal(library['tv:4'].rewatching, false)
    assert.deepEqual(library['tv:4'].rewatchEpisodes, { '1-2': 1201 })
    assert.equal(library['tv:5'].rewatching, true)
    assert.deepEqual(library['tv:5'].rewatchEpisodes, { '1-1': 1000 })
    assert.deepEqual(library['tv:5'].rewatches, [700])
    assert.equal(library['tv:7'].status, 'watched')
    assert.equal(library['tv:7'].watchedAt, 500)
    assert.deepEqual(library['tv:7'].episodes, { '1-1': 400 })
    assert.deepEqual(library['tv:7'].rewatches, [700, 1100])
    assert.deepEqual(readdirSync(path.join(root, 'data')).sort(), ['database.sqlite'])
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))])
    }
    rmSync(root, { recursive: true, force: true })
  }
})
