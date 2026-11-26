import { copyFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: project, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`docker ${args.join(' ')} failed (${code}).`)))
  })
}
try {
  try { await copyFile(new URL('../.env.example', import.meta.url), new URL('../.env', import.meta.url), constants.COPYFILE_EXCL) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  // Import after creating .env; existing user settings are always preserved.
  await import('../server/config.mjs')
  await run(['info', '--format', '{{.OSType}}'])
  await run(['compose', 'up', '-d', '--build'])
  await run(['compose', 'exec', '-T', 'app', 'node', 'scripts/init-db.mjs'])
  await run(['compose', 'exec', '-T', 'app', 'node', 'scripts/import-osm.mjs'])
  // GeoServer may take longer than PostGIS to initialize. Wait for REST readiness
  // inside the container rather than guessing a startup delay on the host.
  await run(['compose', 'exec', '-T', 'app', 'node', '--input-type=module', '-e', `
    import { geoserverUrl } from './server/config.mjs';
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch(geoserverUrl + '/web/', { signal: AbortSignal.timeout(5000) });
        if (response.ok) { ready = true; break; }
      } catch {}
      console.log('Waiting for GeoServer...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (!ready) throw new Error('GeoServer did not start. Inspect docker compose logs geoserver.');
  `])
  await run(['compose', 'exec', '-T', 'app', 'node', 'scripts/publish-geoserver.mjs'])
  await run(['compose', 'exec', '-T', 'app', 'node', 'scripts/verify-live.mjs'])
  console.log('Setup and live checks passed. Open http://localhost:3001')
} catch (error) {
  console.error(error.message)
  console.error('Setup is incomplete. Run this command in your own PowerShell with Docker Desktop running in Linux-container mode. If Docker reports WSL needs updating, run wsl --update first. Existing volumes and configuration are retained; rerunning setup refreshes OpenStreetMap data.')
  process.exitCode = 1
}
