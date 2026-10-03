import { getDb } from "../server/db";

async function migrate() {
  const db = await getDb();
  if (!db) {
    console.error("Database connection unavailable");
    process.exit(1);
  }
  const client = (db as any).session.client;

  async function addCol(table: string, col: string, definition: string) {
    try {
      const [cols] = await client.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
      if (cols.length === 0) {
        console.log(`Adding ${col} to ${table}`);
        await client.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
      } else {
        console.log(`${col} already in ${table}`);
      }
    } catch (e: any) {
      console.warn(`Warning adding ${col} to ${table}:`, e.message);
    }
  }

  async function addUnique(table: string, indexName: string, col: string) {
    try {
      const [idxs] = await client.query(`SHOW INDEX FROM ${table} WHERE Key_name = '${indexName}'`);
      if (idxs.length === 0) {
        console.log(`Adding unique index ${indexName} on ${table}`);
        await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${indexName} UNIQUE (${col})`);
      }
    } catch (e: any) {
      console.warn(`Warning adding unique ${indexName} to ${table}:`, e.message);
    }
  }

  await addCol("users", "passwordHash", "varchar(255) NULL");
  await addCol("users", "tokenVersion", "int NOT NULL DEFAULT 1");

  await addCol("attendance_records", "operationId", "varchar(128) NULL");
  await addUnique("attendance_records", "attendance_records_operationId_unique", "operationId");
  await addCol("attendance_records", "geofenceStatus", "enum('inside','outside','unverified') NOT NULL DEFAULT 'unverified'");
  await addCol("attendance_records", "distanceMeters", "int NULL");
  await addCol("attendance_records", "clientCheckInAt", "timestamp NULL");
  await addCol("attendance_records", "clientCheckOutAt", "timestamp NULL");
  await addCol("attendance_records", "reviewedByUserId", "int NULL");
  await addCol("attendance_records", "reviewedAt", "timestamp NULL");
  await addCol("attendance_records", "reviewNotes", "text NULL");
  try {
    await client.query("ALTER TABLE attendance_records MODIFY COLUMN status ENUM('verified', 'review', 'pending', 'rejected') NOT NULL DEFAULT 'verified'");
    console.log("attendance_records status enum updated with 'rejected'");
  } catch (e: any) {
    console.warn("Could not alter attendance_records status enum:", e.message);
  }

  await addCol("gps_points", "operationId", "varchar(128) NULL");
  await addUnique("gps_points", "gps_points_operationId_unique", "operationId");
  await addCol("gps_points", "capturedAt", "timestamp NULL");

  await addCol("tasks", "operationId", "varchar(128) NULL");
  await addUnique("tasks", "tasks_operationId_unique", "operationId");

  await addCol("customers", "operationId", "varchar(128) NULL");
  await addUnique("customers", "customers_operationId_unique", "operationId");

  await addCol("visits", "operationId", "varchar(128) NULL");
  await addUnique("visits", "visits_operationId_unique", "operationId");

  await addCol("expenses", "operationId", "varchar(128) NULL");
  await addUnique("expenses", "expenses_operationId_unique", "operationId");

  await addCol("chat_messages", "operationId", "varchar(128) NULL");
  await addUnique("chat_messages", "chat_messages_operationId_unique", "operationId");

  await addCol("visit_evidence", "operationId", "varchar(128) NULL");
  await addUnique("visit_evidence", "visit_evidence_operationId_unique", "operationId");

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id varchar(36) NOT NULL PRIMARY KEY,
        userId int NOT NULL,
        operationType varchar(64) NOT NULL,
        operationId varchar(128) NOT NULL,
        recordId varchar(64),
        responsePayload text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY idempotency_keys_operationId_unique (operationId),
        KEY idempotency_keys_userId_idx (userId),
        CONSTRAINT fk_idempotency_keys_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("idempotency_keys table verified/created");
  } catch (e: any) {
    console.warn("Could not create idempotency_keys table:", e.message);
  }

  console.log("Database schema successfully upgraded!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
