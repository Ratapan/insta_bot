// Colección `blogs` del portafolio (posts tipo blog y repo): lista y creación.
//   GET  ?type=&status=&search=  → { blogs: BlogSummary[] }
//   POST { …BlogInput }          → 201 { blog }   (codes: invalid_fields, slug_taken)
// La lógica vive en portfolioBlogDb; aquí solo se orquesta.
import type { APIRoute } from "astro";
import {
  createBlog,
  listBlogSummaries,
  normalizeBlogForEditor,
  type ListBlogsQuery,
} from "../../../lib/portfolioBlogDb";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;
  const query: ListBlogsQuery = {};

  const type = params.get("type");
  if (type === "blog" || type === "repo") query.type = type;

  const status = params.get("status");
  if (status === "draft" || status === "published" || status === "archived") {
    query.status = status;
  }

  const search = params.get("search")?.trim();
  if (search) query.search = search;

  try {
    return json({ blogs: await listBlogSummaries(query) });
  } catch (err) {
    console.error("[portfolio/blogs] GET", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  try {
    const created = await createBlog(body);
    return json({ blog: normalizeBlogForEditor(created) }, 201);
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "invalid_fields") return json({ error: code }, 400);
    if (code === "slug_taken") return json({ error: code }, 409);
    console.error("[portfolio/blogs] POST", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
