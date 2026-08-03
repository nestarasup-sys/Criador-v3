/** Single source for the Nymi Gacha loopback data-service endpoint. */
export const LOCAL_DATA_URL = "http://127.0.0.1:6800";
const SESSION_PATH = "/session";
const SESSION_HEADER = "X-Gacha-Session";

let sessionToken: string | null = null;
let sessionRequest: Promise<string> | null = null;

async function loadSession() {
  const response = await fetch(`${LOCAL_DATA_URL}${SESSION_PATH}`, { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as { token?: unknown };
  if (!response.ok || typeof result.token !== "string" || !result.token) {
    throw new Error("Não foi possível iniciar a sessão local do Nymi Gacha.");
  }
  sessionToken = result.token;
  return sessionToken;
}

function ensureSession() {
  if (sessionToken) return Promise.resolve(sessionToken);
  if (!sessionRequest) sessionRequest = loadSession().finally(() => { sessionRequest = null; });
  return sessionRequest;
}

export async function localDataFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  let token = await ensureSession();
  headers.set(SESSION_HEADER, token);
  let response = await fetch(`${LOCAL_DATA_URL}${path}`, { ...init, headers });
  if (response.status === 401 && path !== SESSION_PATH) {
    sessionToken = null;
    token = await ensureSession();
    headers.set(SESSION_HEADER, token);
    response = await fetch(`${LOCAL_DATA_URL}${path}`, { ...init, headers });
  }
  return response;
}
