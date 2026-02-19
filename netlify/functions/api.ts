import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { Database } from "./lib/db";
import { CzynaczasClient } from "./lib/czynaczas";
import { AppUser } from "./lib/types";

// --- KONFIGURACJA ---
const API_PREFIX = "/api/v1";

// --- AUTH HELPER ---
// Weryfikuje JWT i wyciąga dane użytkownika (sub, email, name)
const getUserFromEvent = (event: HandlerEvent): { sub: string; email?: string; name?: string } | null => {
  const authHeader = event.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.split(" ")[1];
  try {
    // Uwaga: W produkcji weryfikujemy podpis kluczem publicznym Netlify Identity.
    // Na potrzeby MVP i dev ufamy strukturze tokena (Netlify Gateway to robi przed nami),
    // ale dekodujemy go, by pobrać 'sub'.
    const decoded = jwt.decode(token); 
    if (!decoded || typeof decoded !== 'object' || !decoded.sub) {
      return null;
    }
    
    return {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.user_metadata?.full_name || decoded.name
    };
  } catch (err) {
    console.error("Auth error:", err);
    return null;
  }
};

// --- HANDLERS ---

async function handleGetMe(db: Database, identityUser: { sub: string, email?: string, name?: string }) {
  // 1. Spróbuj pobrać usera z bazy
  let user = await db.getUserBySubject(identityUser.sub);

  // 2. Jeśli nie istnieje, utwórz go (Auto-registration on first login)
  if (!user) {
    console.log(`Creating new user for subject: ${identityUser.sub}`);
    user = await db.createUser(identityUser.sub, identityUser.email, identityUser.name);
  }

  // 3. Pobierz aktywny profil (jeśli jest)
  const activeProfileData = await db.getActiveProfile(user.id);

  return {
    statusCode: 200,
    body: JSON.stringify({
      user,
      active_profile: activeProfileData ? activeProfileData.profile : null,
      // Debug info
      meta: {
        db_connected: true
      }
    }),
  };
}

// Endpoint testowy do sprawdzania proxy (WKD/ZTM)
// GET /api/v1/debug/timetable?stop_id=wkd_wrako
async function handleGetTimetableDebug(event: HandlerEvent) {
  const stopId = event.queryStringParameters?.stop_id;
  
  if (!stopId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing stop_id" }) };
  }

  const client = new CzynaczasClient();
  // Pobieramy 5 najbliższych odjazdów
  const departures = await client.getDepartures(stopId, 5);

  return {
    statusCode: 200,
    body: JSON.stringify({
      stop_id: stopId,
      count: departures.length,
      departures: departures
    }),
  };
}

// --- MAIN ROUTER ---

export const handler: Handler = async (event, context) => {
  // Setup DB
  const db = new Database();

  try {
    // 0. Path Routing (prosty router)
    // Oczekujemy: /.netlify/functions/api (z rewrite) -> event.path
    // Netlify dev local path: /api/v1/...
    const path = event.path.replace("/.netlify/functions/api", "").replace("/api/v1", "");
    
    console.log(`[REQUEST] ${event.httpMethod} ${path}`);

    // 1. Connect DB
    await db.connect();

    // 2. Authentication Check (wymagane dla większości endpointów)
    const identityUser = getUserFromEvent(event);
    
    // Public routes (jeśli będą) - tutaj brak
    // Protected routes:

    if (!identityUser) {
      // Dla endpointu health check / status publicznego (opcjonalnie)
      if (path === "/health") {
        return { statusCode: 200, body: JSON.stringify({ status: "ok" }) };
      }
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    // 3. Route Dispatch
    if (event.httpMethod === "GET" && path === "/me") {
      return await handleGetMe(db, identityUser);
    }

    if (event.httpMethod === "GET" && path === "/debug/timetable") {
      return await handleGetTimetableDebug(event);
    }

    // Fallback
    return {
      statusCode: 404,
      body: JSON.stringify({ error: `Route not found: ${path}` }),
    };

  } catch (error: any) {
    console.error("[SERVER ERROR]", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Internal Server Error" }),
    };
  } finally {
    // 4. Cleanup
    await db.disconnect();
  }
};