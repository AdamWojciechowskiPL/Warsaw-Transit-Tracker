import { Client, QueryResult } from "@neondatabase/serverless";
import { AppUser, RouteProfile, RouteSegment, TransferConfig } from "./types";

export class Database {
  private client: Client;

  constructor() {
    // Pobieramy connection string ze zmiennych środowiskowych
    if (!process.env.DATABASE_URL) {
      throw new Error("Missing DATABASE_URL environment variable");
    }
    this.client = new Client(process.env.DATABASE_URL);
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    await this.client.end();
  }

  // Generyczny helper do zapytań
  async query<T>(text: string, params?: any[]): Promise<T[]> {
    const res: QueryResult = await this.client.query(text, params);
    return res.rows as T[];
  }

  async queryOne<T>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows.length > 0 ? rows[0] : null;
  }

  // --- User Repository Methods ---

  async getUserBySubject(sub: string): Promise<AppUser | null> {
    return this.queryOne<AppUser>(
      `SELECT * FROM app_user WHERE identity_subject = $1`,
      [sub]
    );
  }

  async createUser(sub: string, email?: string, name?: string): Promise<AppUser> {
    // Upsert (idempotentny zapis)
    return (await this.queryOne<AppUser>(
      `INSERT INTO app_user (identity_subject, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (identity_subject) DO UPDATE 
       SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
       RETURNING *`,
      [sub, email, name]
    ))!;
  }

  // --- Profile Repository Methods ---

  async getActiveProfile(userId: string): Promise<{ profile: RouteProfile, config: TransferConfig, segments: RouteSegment[] } | null> {
    // 1. Pobierz profil
    const profile = await this.queryOne<RouteProfile>(
      `SELECT * FROM route_profile WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [userId]
    );

    if (!profile) return null;

    // 2. Pobierz konfigurację transferu
    const config = await this.queryOne<TransferConfig>(
      `SELECT * FROM transfer_config WHERE profile_id = $1`,
      [profile.id]
    );

    // 3. Pobierz segmenty
    const segments = await this.query<RouteSegment>(
      `SELECT * FROM route_segment WHERE profile_id = $1 ORDER BY seq ASC`,
      [profile.id]
    );

    if (!config) throw new Error(`Data integrity error: Profile ${profile.id} missing transfer_config`);

    return { profile, config, segments };
  }
}