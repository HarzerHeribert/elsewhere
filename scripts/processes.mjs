import { spawn } from 'node:child_process';

/** Run owned development services and wait for their shutdown, including descendants. */
export function runServices(specifications, { env = process.env, graceMs = 75000 } = {}) {
  const children = specifications.map(({ command, args = [], env: serviceEnv = env }) =>
    spawn(command, args, {
      stdio: 'inherit',
      env: serviceEnv,
      detached: process.platform !== 'win32',
    }),
  );
  const closed = children.map((child) => new Promise((resolve) => child.once('close', resolve)));
  const ownedGroups = new Set(
    process.platform === 'win32' ? [] : children.flatMap((child) => (child.pid ? [child.pid] : [])),
  );
  let stopping;
  let finish;
  const completion = new Promise((resolve) => {
    finish = resolve;
  });
  function signalSupervisor(child, force) {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') {
        // taskkill's tree option is needed because package managers spawn service children.
        const killer = spawn(
          'taskkill',
          ['/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])],
          { stdio: 'ignore' },
        );
        killer.on('error', () => child.kill(force ? 'SIGKILL' : 'SIGTERM'));
      } else if (child.exitCode === null && child.signalCode === null) {
        // pnpm and tsx forward termination themselves. Signalling their whole group
        // here delivers duplicate signals, which tsx interprets as a forced kill.
        child.kill('SIGTERM');
      }
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  }
  function pruneGroups() {
    for (const pid of ownedGroups) {
      try {
        process.kill(-pid, 0);
      } catch (error) {
        // Once a group has ended, never target its ID again if the OS reuses it.
        if (error.code === 'ESRCH') ownedGroups.delete(pid);
        else if (error.code !== 'EPERM') throw error;
      }
    }
  }
  async function waitForGroups() {
    while (ownedGroups.size) {
      pruneGroups();
      if (ownedGroups.size) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  function stop(code = 0) {
    if (stopping) return stopping;
    stopping = (async () => {
      const allClosed = Promise.all(closed);
      pruneGroups();
      for (const child of children) signalSupervisor(child, false);
      const escalation = setTimeout(() => {
        if (process.platform === 'win32') {
          for (const child of children) signalSupervisor(child, true);
        } else {
          pruneGroups();
          for (const pid of ownedGroups) {
            try {
              process.kill(-pid, 'SIGKILL');
            } catch (error) {
              if (error.code === 'ESRCH') ownedGroups.delete(pid);
              else console.error(error.message);
            }
          }
        }
      }, graceMs);
      // A supervisor may exit while leaving a descendant behind. Keep ownership
      // until both its handle has closed and its original group is gone.
      await Promise.all([allClosed, waitForGroups()]);
      clearTimeout(escalation);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      process.exitCode = code;
      finish(code);
    })();
    return stopping;
  }
  function onSignal() {
    void stop();
  }
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  for (const child of children) {
    child.on('error', (error) => {
      console.error(error.message);
      void stop(1);
    });
    child.on('exit', (code) => {
      if (!stopping) void stop(code ?? 1);
    });
  }
  return { stop, completion };
}
