// Imported first by tests, evals and the scenario script: they work in the "test" schema,
// so their resets never touch the app's data. Must run before lib/db is loaded.
process.env.DB_SCHEMA = "test";
