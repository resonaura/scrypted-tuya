import "reflect-metadata";
import { DataSource } from "typeorm";
import * as fs from "node:fs";
import * as path from "node:path";
import { CameraEntity, SettingEntity } from "./entities/index.js";
import { env } from "../config/env.js";

let dataSource: DataSource | null = null;

export function getDataSource(): DataSource {
  if (!dataSource) {
    const dbPath = env.SQLITE_PATH;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    dataSource = new DataSource({
      type: "better-sqlite3",
      database: dbPath,
      synchronize: true,
      logging: false,
      entities: [CameraEntity, SettingEntity],
    });
  }
  return dataSource;
}

export async function initDatabase(): Promise<DataSource> {
  const ds = getDataSource();
  if (!ds.isInitialized) {
    await ds.initialize();
  }
  return ds;
}
