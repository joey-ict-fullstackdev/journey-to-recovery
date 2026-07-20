import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import dbConfig from "../config/db.config";

const urlDB = `mysql://${process.env.MYSQLUSER}:${process.env.MYSQL_ROOT_PASSWORD}@${process.env.RAILWAY_TCP_PROXY_DOMAIN}:${process.env.RAILWAY_TCP_PROXY_PORT}/${process.env.MYSQL_DATABASE}`;

const pool =
  process.env.NODE_ENV === "production"
    ? mysql.createPool(urlDB)
    : mysql.createPool({
        host: dbConfig.HOST,
        user: dbConfig.USER,
        password: dbConfig.PASSWORD,
        database: dbConfig.DB,
        namedPlaceholders: true,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });

export const db = drizzle(pool);

export default pool;
