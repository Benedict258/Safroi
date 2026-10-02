import { migrate } from "../src/lib/migrate";
import { closePool } from "../src/lib/db";

migrate()
  .then((a) => console.log(a.length ? `Applied: ${a.join(", ")}` : "Database is up to date."))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closePool);
