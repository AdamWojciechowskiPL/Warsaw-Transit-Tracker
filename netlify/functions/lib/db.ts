import { Client, QueryResult } from "@neondatabase/serverless";
import { AppUser, RouteProfile, RouteSegment, TransferConfig } from "./types";

export class Database {
  private client: Client;

  constructor() {
    const url = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) throw new Error("Missing DATABASE_URL environment variable");
    this.client = new Client(url);
  }

  async connect() { await this.client.connect(); }
  async disconnect() { await this.client.end(); }

  async query<T>(text: string, params?: any[]): Promise<T[]> {
    const res: QueryResult = await this.client.query(text, params);
    return res.rows as T[];
  }

  async queryOne<T>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows.length > 0 ? rows[0] : null;
  }

  // --- Users ---
  async getUserBySubject(sub: string): Promise<AppUser | null> {
    return this.queryOne<AppUser>(`SELECT * FROM app_user WHERE identity_subject = $1`, [sub]);
  }

  async createUser(sub: string, email?: string, name?: string): Promise<AppUser> {
    return (await this.queryOne<AppUser>(
      `INSERT INTO app_user (identity_subject, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (identity_subject) DO UPDATE
       SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
       RETURNING *`,
      [sub, email ?? null, name ?? null]
    ))!;
  }

  // --- Profiles ---
  async getProfiles(userId: string): Promise<RouteProfile[]> {
    return this.query<RouteProfile>(
      `SELECT * FROM route_profile WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );
  }

  async getProfileById(profileId: string, userId: string): Promise<RouteProfile | null> {
    return this.queryOne<RouteProfile>(
      `SELECT * FROM route_profile WHERE id = $1 AND user_id = $2`,
      [profileId, userId]
    );
  }

  async createProfile(userId: string, name: string): Promise<RouteProfile> {
    const profile = (await this.queryOne<RouteProfile>(
      `INSERT INTO route_profile (user_id, name) VALUES ($1, $2) RETURNING *`,
      [userId, name]
    ))!;
    // Utwórz domyślny transfer_config
    await this.query(
      `INSERT INTO transfer_config (profile_id, exit_buffer_sec, min_transfer_buffer_sec, walk_times)
       VALUES ($1, 60, 120, '{}'::jsonb)`,
      [profile.id]
    );
    return profile;
  }

  async updateProfile(profileId: string, userId: string, data: Partial<RouteProfile>): Promise<RouteProfile> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
    if (data.is_active !== undefined) {
      // Dezaktywuj pozostałe profile
      if (data.is_active) {
        await this.query(
          `UPDATE route_profile SET is_active = false WHERE user_id = $1`,
          [userId]
        );
      }
      fields.push(`is_active = $${idx++}`);
      values.push(data.is_active);
    }
    if (data.is_valid !== undefined) { fields.push(`is_valid = $${idx++}`); values.push(data.is_valid); }

    if (fields.length === 0) {
      return (await this.getProfileById(profileId, userId))!;
    }

    values.push(profileId);
    values.push(userId);

    return (await this.queryOne<RouteProfile>(
      `UPDATE route_profile SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
      values
    ))!;
  }

  async deleteProfile(profileId: string, userId: string): Promise<void> {
    await this.query(
      `DELETE FROM route_profile WHERE id = $1 AND user_id = $2`,
      [profileId, userId]
    );
  }

  // --- Segments ---
  async getSegments(profileId: string): Promise<RouteSegment[]> {
    return this.query<RouteSegment>(
      `SELECT * FROM route_segment WHERE profile_id = $1 ORDER BY seq ASC`,
      [profileId]
    );
  }

  async replaceSegments(profileId: string, segments: Partial<RouteSegment>[]): Promise<RouteSegment[]> {
    await this.query(`DELETE FROM route_segment WHERE profile_id = $1`, [profileId]);
    const result: RouteSegment[] = [];
    for (const seg of segments) {
      const row = await this.queryOne<RouteSegment>(
        `INSERT INTO route_segment (profile_id, seq, mode, agency, from_stop_id, to_stop_id, allowed_route_ids, stop_variants, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
         RETURNING *`,
        [
          profileId,
          seg.seq,
          seg.mode,
          seg.agency ?? null,
          seg.from_stop_id ?? null,
          seg.to_stop_id ?? null,
          JSON.stringify(seg.allowed_route_ids ?? []),
          JSON.stringify(seg.stop_variants ?? null),
          seg.notes ?? null
        ]
      );
      if (row) result.push(row);
    }
    return result;
  }

  // --- Transfer Config ---
  async getTransferConfig(profileId: string): Promise<TransferConfig | null> {
    return this.queryOne<TransferConfig>(
      `SELECT * FROM transfer_config WHERE profile_id = $1`,
      [profileId]
    );
  }

  async upsertTransferConfig(profileId: string, data: Partial<TransferConfig>): Promise<TransferConfig> {
    // Konwertuj walk_times z minut na sekundy (wartości w minutach z frontu)
    const walkTimesRaw = data.walk_times as Record<string, number> | undefined;
    return (await this.queryOne<TransferConfig>(
      `INSERT INTO transfer_config (profile_id, exit_buffer_sec, min_transfer_buffer_sec, walk_times)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (profile_id) DO UPDATE
       SET exit_buffer_sec = EXCLUDED.exit_buffer_sec,
           min_transfer_buffer_sec = EXCLUDED.min_transfer_buffer_sec,
           walk_times = EXCLUDED.walk_times
       RETURNING *`,
      [
        profileId,
        data.exit_buffer_sec ?? 60,
        data.min_transfer_buffer_sec ?? 120,
        JSON.stringify(walkTimesRaw ?? {})
      ]
    ))!;
  }

  // --- Active Profile (pełne dane) ---
  async getActiveProfile(userId: string): Promise<{ profile: RouteProfile; config: TransferConfig; segments: RouteSegment[] } | null> {
    const profile = await this.queryOne<RouteProfile>(
      `SELECT * FROM route_profile WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [userId]
    );
    if (!profile) return null;
    return this._loadProfileData(profile);
  }

  async getActiveProfileById(profileId: string, userId: string): Promise<{ profile: RouteProfile; config: TransferConfig; segments: RouteSegment[] } | null> {
    const profile = await this.getProfileById(profileId, userId);
    if (!profile) return null;
    return this._loadProfileData(profile);
  }

  private async _loadProfileData(profile: RouteProfile) {
    const config = await this.getTransferConfig(profile.id);
    if (!config) throw new Error(`Data integrity error: Profile ${profile.id} missing transfer_config`);
    const segments = await this.getSegments(profile.id);
    return { profile, config, segments };
  }
}
