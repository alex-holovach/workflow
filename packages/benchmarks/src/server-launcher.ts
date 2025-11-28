import cp from 'node:child_process';
import path from 'node:path';
import jsonlines from 'jsonlines';

interface ServerControl {
  state: 'listening';
  info: { port: number };
  kill: () => void;
}

export async function launchServer(opts: {
  world: string;
}): Promise<ServerControl> {
  const benchmarksDir = path.join(process.cwd());
  const serverPath = path.join(benchmarksDir, 'dist/server.mjs');

  const proc = cp.spawn('node', [serverPath], {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    cwd: benchmarksDir,
    env: {
      ...process.env,
      WORKFLOW_TARGET_WORLD: opts.world,
      CONTROL_FD: '3',
    },
  });

  proc.stderr?.on('data', (chunk) => {
    console.error(`[server:${opts.world}] ${chunk.toString()}`);
  });

  const fd3 = proc.stdio[3];
  if (!fd3) {
    throw new Error('fd3 should be defined');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Server startup timeout'));
    }, 60_000);

    fd3.pipe(jsonlines.parse()).on('data', (chunk: any) => {
      clearTimeout(timeout);
      if (chunk.state === 'listening') {
        resolve({
          state: 'listening',
          info: { port: chunk.info.port },
          kill: () => proc.kill(),
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}
