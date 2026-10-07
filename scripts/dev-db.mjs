// Local dev Postgres without Docker (D31/D32): real server binaries via
// embedded-postgres, data under .pgdata/dev. Prod stays Neon — this is dev-only.
import EmbeddedPostgresModule from "embedded-postgres";

const EmbeddedPostgres =
  EmbeddedPostgresModule.default ?? EmbeddedPostgresModule;

const dataDir = new URL("../.pgdata/dev", import.meta.url).pathname;
const PORT = 5433;

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

try {
  await server.initialise();
} catch {
  console.log("cluster already initialised — reusing");
}
await server.start();
try {
  await server.createDatabase("glados_dev");
} catch {
  console.log("database glados_dev already exists");
}

console.log(
  `dev Postgres ready: postgresql://postgres:postgres@localhost:${PORT}/glados_dev`
);
console.log("press Ctrl-C to stop");
setInterval(() => {}, 1 << 30);
