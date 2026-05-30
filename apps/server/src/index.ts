import { buildApp } from "./app.js";
import { loadServerConfig } from "./config.js";

const config = loadServerConfig();
const app = buildApp();

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`LeDashboard server running at http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
