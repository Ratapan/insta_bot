// Backfill de los datos de imagen que necesita el sitio nuevo (portfolio_2026):
// width, height y color (del WebP publicado) y takenAt (EXIF DateTimeOriginal,
// si el WebP lo conserva) en los docs de `images` a los que les falta alguno de
// width/height/color.
//
// Uso (desde insta_bot/):
//   pnpm backfill:image-facts            → dry-run: calcula y muestra, NO escribe
//   pnpm backfill:image-facts --apply    → backup JSON en backups/ y luego escribe
// Opciones: --limit N (solo los primeros N docs), --concurrency N (por defecto 4).
//
// Lee las imágenes por su URL PÚBLICA (no necesita PORTFOLIO_R2_*). Solo hace
// $set de los campos que faltan: nunca pisa un valor existente y no toca
// updatedAt (es un dato derivado del archivo, no una edición).
import { mkdirSync, writeFileSync } from "node:fs";
import { MongoClient, type ObjectId } from "mongodb";
import { extractExif, imageFacts } from "../src/lib/portfolioImage.ts";
import {
  portfolioImageFieldsSchema,
  type PortfolioImageFields,
} from "../src/lib/portfolioSchema.ts";

interface ImageDoc {
  _id: ObjectId;
  url: string;
  width?: number;
  height?: number;
  color?: string;
  takenAt?: Date;
}

interface Result {
  doc: ImageDoc;
  set?: PortfolioImageFields;
  error?: string;
}

function parseArgs(argv: string[]) {
  const args = { apply: false, limit: 0, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (arg !== "--") throw new Error(`Opción desconocida: ${arg}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 0) throw new Error("--limit inválido");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency inválido");
  }
  return args;
}

/** Map con concurrencia acotada, conservando el orden de entrada. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function analyze(doc: ImageDoc): Promise<Result> {
  try {
    const res = await fetch(doc.url);
    if (!res.ok) return { doc, error: `HTTP ${res.status}` };
    const buffer = Buffer.from(await res.arrayBuffer());
    const facts = await imageFacts(buffer);

    const set: Record<string, unknown> = {};
    if (doc.width === undefined) set.width = facts.width;
    if (doc.height === undefined) set.height = facts.height;
    if (doc.color === undefined) set.color = facts.color;
    if (doc.takenAt === undefined) {
      const takenAt = extractExif(buffer).takenAt;
      if (takenAt) set.takenAt = takenAt;
    }
    // Mismo contrato que el resto de escrituras (lanza si algo no cuadra).
    return { doc, set: portfolioImageFieldsSchema.parse(set) };
  } catch (err) {
    return { doc, error: err instanceof Error ? err.message : String(err) };
  }
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/[^/]+\//, "");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.PORTFOLIO_MONGODB_URI;
  if (!uri) {
    throw new Error("Falta PORTFOLIO_MONGODB_URI (corre el script con --env-file=.env).");
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const col = client.db().collection<ImageDoc>("images");

    const total = await col.countDocuments();
    let docs = await col
      .find(
        {
          $or: [
            { width: { $exists: false } },
            { height: { $exists: false } },
            { color: { $exists: false } },
          ],
        },
        { projection: { url: 1, width: 1, height: 1, color: 1, takenAt: 1 } },
      )
      .sort({ url: 1 })
      .toArray();
    if (args.limit) docs = docs.slice(0, args.limit);

    console.log(
      `${docs.length} docs sin width/height/color (de ${total} en total)` +
        (args.apply ? " — modo APPLY" : " — dry-run"),
    );
    if (docs.length === 0) return;

    const results = await mapLimit(docs, args.concurrency, analyze);
    const ok = results.filter((r) => r.set);
    const failed = results.filter((r) => r.error);

    for (const r of results) {
      if (r.error) {
        console.log(`  ✗ ${shortUrl(r.doc.url)} — ${r.error}`);
        continue;
      }
      const s = r.set!;
      const size = s.width && s.height ? `${s.width}×${s.height}` : "(dims ya estaban)";
      const taken = s.takenAt instanceof Date ? s.takenAt.toISOString().slice(0, 16) : "—";
      console.log(`  ✓ ${shortUrl(r.doc.url)}  ${size}  ${s.color ?? ""}  captura: ${taken}`);
    }

    const withTakenAt = ok.filter((r) => r.set!.takenAt).length;
    console.log(
      `\nResumen: ${ok.length} listos (${withTakenAt} con fecha de captura), ${failed.length} con error.`,
    );

    if (!args.apply) {
      console.log("Dry-run: no se escribió nada. Corre con --apply para guardar.");
    } else if (ok.length > 0) {
      // Backup de los docs COMPLETOS que se van a tocar, antes de escribir.
      mkdirSync("backups", { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `backups/images-before-facts-${stamp}.json`;
      const before = await col.find({ _id: { $in: ok.map((r) => r.doc._id) } }).toArray();
      writeFileSync(backupPath, JSON.stringify(before, null, 2));
      console.log(`Backup: ${backupPath} (${before.length} docs)`);

      let written = 0;
      for (const r of ok) {
        const res = await col.updateOne({ _id: r.doc._id }, { $set: r.set! });
        written += res.modifiedCount;
      }
      console.log(`Aplicado: ${written} docs actualizados.`);
    }

    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
