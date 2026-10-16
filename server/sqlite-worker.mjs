import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync(process.argv[2]);
database.exec('PRAGMA busy_timeout = 1000');
const changes = database.prepare('SELECT total_changes() AS count');
changes.setReadBigInts(true);

function execute(sql, parameters = []) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('SQL requires a nonempty string.');
  const statement = database.prepare(sql);
  const tail = sql.slice(statement.sourceSQL.length);
  if (!/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/.test(tail)) throw new Error('Send one SQL statement per execution.');
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  const before = changes.get().count;
  const rows = Array.isArray(parameters) ? statement.all(...parameters) : statement.all(parameters);
  return { columns: statement.columns(), rows, rowsAffected: changes.get().count - before };
}

function schema() {
  return database.prepare("SELECT name, type, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(table => ({ ...table, columns: database.prepare('SELECT name, type, "notnull" AS required, dflt_value AS defaultValue, pk FROM pragma_table_info(?)').all(table.name) }));
}

process.on('message', ({ id, op, sql, parameters }) => {
  try {
    const result = op === 'execute' ? execute(sql, parameters) : op === 'schema' ? schema() : (() => { throw new Error(`Unknown SQLite operation: ${op}.`); })();
    process.send({ id, result });
  } catch (error) { process.send({ id, error: error.message }); }
});
