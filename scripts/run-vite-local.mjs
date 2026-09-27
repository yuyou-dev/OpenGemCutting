import { runLocalServer } from '../setup/local-server.mjs';

try {
  await runLocalServer(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
