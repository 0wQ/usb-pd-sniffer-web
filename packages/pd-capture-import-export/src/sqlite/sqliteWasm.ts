import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'

let sqlite3Promise: Promise<Sqlite3Static> | null = null

function assertBrowserEnvironment(): void {
  if (typeof window === 'undefined' && typeof self === 'undefined') {
    throw new Error(
      '@usb-pd-sniffer/pd-capture-import-export sqlite support is browser-only',
    )
  }
}

function sqliteResultToString(sqlite3: Sqlite3Static, rc: number): string {
  return sqlite3.capi.sqlite3_js_rc_str(rc)
}

export async function getSqlite3(): Promise<Sqlite3Static> {
  assertBrowserEnvironment()

  if (sqlite3Promise === null) {
    sqlite3Promise = sqlite3InitModule()
  }

  return sqlite3Promise
}

export async function openReadonlySqliteDatabase(
  bytes: Uint8Array,
): Promise<Database> {
  const sqlite3 = await getSqlite3()
  const db = new sqlite3.oo1.DB(':memory:')
  let dataPointer: number | null = null

  try {
    dataPointer = sqlite3.wasm.allocFromTypedArray(bytes)

    const rc = sqlite3.capi.sqlite3_deserialize(
      db,
      'main',
      dataPointer,
      bytes.byteLength,
      bytes.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
        sqlite3.capi.SQLITE_DESERIALIZE_READONLY,
    )

    if (rc !== sqlite3.capi.SQLITE_OK) {
      throw new Error(
        `Failed to deserialize sqlite database: ${sqliteResultToString(
          sqlite3,
          rc,
        )}`,
      )
    }

    dataPointer = null
    return db
  } catch (error) {
    if (dataPointer !== null) {
      sqlite3.wasm.dealloc(dataPointer)
    }
    db.close()
    throw error
  }
}

export async function createWritableSqliteDatabase(): Promise<Database> {
  const sqlite3 = await getSqlite3()
  return new sqlite3.oo1.DB(':memory:')
}

export async function exportSqliteDatabaseBytes(
  db: Database,
): Promise<Uint8Array> {
  const sqlite3 = await getSqlite3()
  return sqlite3.capi.sqlite3_js_db_export(db)
}
