// «Publicar sitio» (ver lib/portfolioPublish.ts).
//   GET  → PublishStatus { configured, lastPublishedAt, pending }
//   POST → { lastPublishedAt }  (lanza un build nuevo en Vercel)
//   codes: not_configured, publish_failed, rate_limited, portfolio_unavailable
import type { APIRoute } from "astro";
import { isPublishConfigured, publishStatus, triggerPublish } from "../../../lib/portfolioPublish";
import { checkRateLimit } from "../../../lib/rateLimit";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async () => {
  try {
    return json(await publishStatus());
  } catch (err) {
    console.error("[portfolio/publish] GET", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const POST: APIRoute = async () => {
  if (!isPublishConfigured()) return json({ error: "not_configured" }, 503);
  // Un build por minuto basta; evita lanzar varios con clics repetidos.
  if (!checkRateLimit("portfolio-publish", 1, 60_000)) {
    return json({ error: "rate_limited" }, 429);
  }
  try {
    const at = await triggerPublish();
    return json({ lastPublishedAt: at.toISOString() });
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "not_configured") return json({ error: code }, 503);
    if (code === "publish_failed") return json({ error: code }, 502);
    console.error("[portfolio/publish] POST", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
