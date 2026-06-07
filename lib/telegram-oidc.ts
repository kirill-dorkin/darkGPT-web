import { createPublicKey, verify, type JsonWebKey } from "crypto";

type Jwk = JsonWebKey & {
  kid?: string;
  alg?: string;
};

type TelegramJwtHeader = {
  alg?: string;
  kid?: string;
};

type TelegramIdTokenClaims = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  id?: number | string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  phone_number?: string;
};

export type TelegramOidcUser = {
  id: string;
  username: string | null;
  name: string | null;
  picture: string | null;
  phoneNumber: string | null;
};

const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json";

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="), "base64");
}

function parseJwtPart<T>(value: string): T {
  return JSON.parse(base64UrlDecode(value).toString("utf8")) as T;
}

async function fetchTelegramJwks() {
  const response = await fetch(TELEGRAM_JWKS_URL, {
    cache: "force-cache",
    next: { revalidate: 3600 },
  });
  if (!response.ok) {
    throw new Error("Could not load Telegram JWKS");
  }
  return (await response.json()) as { keys?: Jwk[] };
}

function verifySignature(alg: string, jwk: Jwk, signingInput: string, signature: Buffer) {
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(signingInput, "utf8");

  if (alg === "RS256") {
    return verify("RSA-SHA256", data, key, signature);
  }

  if (alg === "ES256" || alg === "ES256K") {
    return verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature);
  }

  if (alg === "EdDSA") {
    return verify(null, data, key, signature);
  }

  return false;
}

export async function verifyTelegramIdToken(idToken: string, clientId: string): Promise<TelegramOidcUser> {
  if (!clientId || !/^\d+$/.test(clientId)) {
    throw new Error("TELEGRAM_CLIENT_ID is not configured");
  }

  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Telegram id_token is malformed");
  }

  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = parseJwtPart<TelegramJwtHeader>(encodedHeader);
  const claims = parseJwtPart<TelegramIdTokenClaims>(encodedClaims);

  if (!header.alg || !header.kid) {
    throw new Error("Telegram id_token header is invalid");
  }

  const jwks = await fetchTelegramJwks();
  const jwk = jwks.keys?.find((item) => item.kid === header.kid && item.alg === header.alg);
  if (!jwk) {
    throw new Error("Telegram signing key was not found");
  }

  const verified = verifySignature(header.alg, jwk, `${encodedHeader}.${encodedClaims}`, base64UrlDecode(encodedSignature));
  if (!verified) {
    throw new Error("Telegram id_token signature is invalid");
  }

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== TELEGRAM_ISSUER) {
    throw new Error("Telegram id_token issuer is invalid");
  }
  if (!audiences.includes(clientId)) {
    throw new Error("Telegram id_token audience is invalid");
  }
  if (!claims.exp || claims.exp < now) {
    throw new Error("Telegram id_token expired");
  }
  if (claims.iat && claims.iat > now + 60) {
    throw new Error("Telegram id_token issue time is invalid");
  }

  const id = claims.id || claims.sub;
  const userId = typeof id === "number" || typeof id === "string" ? String(id).trim() : "";
  if (!/^\d{4,24}$/.test(userId)) {
    throw new Error("Telegram id_token user id is invalid");
  }

  return {
    id: userId,
    username: claims.preferred_username || null,
    name: claims.name || null,
    picture: claims.picture || null,
    phoneNumber: claims.phone_number || null,
  };
}
