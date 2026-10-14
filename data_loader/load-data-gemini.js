
import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline";
import csv from "csv-parser";
import { GoogleGenAI } from "@google/genai";
import { ChromaClient } from "chromadb";

// =====================================================
// CONFIGURAÇÕES
// =====================================================

const MODEL = "gemini-embedding-2";
const DIMENSIONS = 768;

const CSV_FILE = "mpst_full_data.csv";
const CHECKPOINT_FILE = "embeddings_checkpoint.jsonl";
const IGNORED_FILE = "movies_ignored.jsonl";
const COLLECTION_NAME = "movies_gemini";

// Limites locais estimados
const MAX_ESTIMATED_TOKENS_PER_MINUTE = 25_000;
const MAX_REQUESTS_PER_MINUTE = 30;

// Estimativa preventiva, não é o tokenizador oficial.
const CHARS_PER_ESTIMATED_TOKEN = 2.5;

// Filme inteiro acima deste valor será ignorado.
const MAX_MOVIE_TOKENS = 5_000;

const CHROMA_BATCH_SIZE = 100;
const MAX_RETRIES = 5;

if (!process.env.GEMINI_API_KEY) {
  throw new Error("Defina GEMINI_API_KEY no arquivo .env");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const chroma = new ChromaClient();

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// =====================================================
// TEXTO E ESTIMATIVA
// =====================================================

function buildText(movie) {
  return [
    `title: ${movie.title}`,
    `tags: ${movie.tags}`,
    `text: ${movie.synopsis}`,
  ].join(" | ");
}

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_ESTIMATED_TOKEN);
}

// =====================================================
// LEITURA DO CSV
// =====================================================

async function readCsv() {
  const movies = [];
  const seenIds = new Set();

  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_FILE)
      .pipe(csv())
      .on("data", (row) => {
        const id = row.imdb_id?.trim();
        const title = row.title?.trim();

        if (!id || !title || seenIds.has(id)) return;

        seenIds.add(id);

        const movie = {
          id,
          title,
          tags: row.tags?.trim() || "",
          // Preserva a sinopse completa.
          synopsis: row.plot_synopsis || "",
        };

        movie.document = buildText(movie);
        movie.estimatedTokens = estimateTokens(movie.document);

        movies.push(movie);
      })
      .on("end", resolve)
      .on("error", reject);
  });

  return movies;
}

// =====================================================
// CHECKPOINT
// =====================================================

async function loadCheckpoint() {
  const completed = new Map();

  if (!fs.existsSync(CHECKPOINT_FILE)) {
    return completed;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(CHECKPOINT_FILE),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const item = JSON.parse(line);

      if (
        !item.id ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== DIMENSIONS
      ) {
        continue;
      }

      if (item.model && item.model !== MODEL) {
        console.warn(
          `Checkpoint ignorado para ${item.id}: ` +
          `modelo incompatível (${item.model}).`
        );
        continue;
      }

      if (
        item.dimensions &&
        item.dimensions !== DIMENSIONS
      ) {
        continue;
      }

      completed.set(item.id, item);
    } catch {
      console.warn("Linha inválida ignorada no checkpoint.");
    }
  }

  return completed;
}

async function appendCheckpoint(item) {
  await fs.promises.appendFile(
    CHECKPOINT_FILE,
    JSON.stringify(item) + "\n"
  );
}

// =====================================================
// RELATÓRIO DE FILMES IGNORADOS
// =====================================================

async function writeIgnoredReport(movies) {
  const oversized = movies.filter(
    (movie) => movie.estimatedTokens > MAX_MOVIE_TOKENS
  );

  const content = oversized
    .map((movie) => JSON.stringify({
      id: movie.id,
      title: movie.title,
      estimatedTokens: movie.estimatedTokens,
      reason: `Texto completo acima do limite estimado de ${MAX_MOVIE_TOKENS} tokens`,
    }))
    .join("\n");

  await fs.promises.writeFile(
    IGNORED_FILE,
    content ? content + "\n" : "",
    "utf8"
  );

  return oversized;
}

// =====================================================
// LIMITADOR DE RPM E TPM
// =====================================================

const usageWindow = [];

async function waitForCapacity(tokens) {
  if (tokens > MAX_ESTIMATED_TOKENS_PER_MINUTE) {
    throw new Error("A entrada excede o orçamento local por minuto.");
  }

  while (true) {
    const now = Date.now();
    const cutoff = now - 60_000;

    while (
      usageWindow.length > 0 &&
      usageWindow[0].timestamp <= cutoff
    ) {
      usageWindow.shift();
    }

    const usedTokens = usageWindow.reduce(
      (sum, entry) => sum + entry.tokens,
      0
    );

    if (
      usageWindow.length < MAX_REQUESTS_PER_MINUTE &&
      usedTokens + tokens <= MAX_ESTIMATED_TOKENS_PER_MINUTE
    ) {
      usageWindow.push({ timestamp: now, tokens });
      return;
    }

    if (usageWindow.length === 0) {
      await sleep(1000);
      continue;
    }

    const delay = Math.max(
      250,
      usageWindow[0].timestamp + 60_000 - now + 100
    );

    console.log(
      `Limitador TPM/RPM: aguardando ${(delay / 1000).toFixed(1)}s`
    );

    await sleep(delay);
  }
}

// =====================================================
// RETENTATIVAS
// =====================================================

function isRetryable(error) {
  const message = String(error?.message || error);
  const status = Number(error?.status ?? error?.code);

  return (
    [429, 500, 502, 503, 504].includes(status) ||
    /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE/i
      .test(message)
  );
}

function getRetryDelay(error, attempt) {
  const message = String(error?.message || error);
  const match = message.match(/retry in ([\d.]+)s/i);

  if (match) {
    return Math.ceil(Number(match[1]) * 1000) + 1000;
  }

  return Math.min(2000 * 2 ** attempt, 60_000);
}

// =====================================================
// EMBEDDING: UM FILME INTEIRO POR CHAMADA
// =====================================================

async function embedMovie(movie) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForCapacity(movie.estimatedTokens);

    try {
      const response = await ai.models.embedContent({
        model: MODEL,
        contents: movie.document,
        config: {
          outputDimensionality: DIMENSIONS,
        },
      });

      const values = response.embeddings?.[0]?.values;

      if (!Array.isArray(values) || values.length !== DIMENSIONS) {
        throw new Error(
          `Embedding inválido para "${movie.title}".`
        );
      }

      return values;
    } catch (error) {
      if (!isRetryable(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      const delay = getRetryDelay(error, attempt);

      console.warn(
        `Erro temporário em "${movie.title}". ` +
        `Tentativa ${attempt + 1}/${MAX_RETRIES}; ` +
        `aguardando ${(delay / 1000).toFixed(1)}s.`
      );

      await sleep(delay);
    }
  }

  throw new Error(`Falha no embedding de "${movie.title}".`);
}

// =====================================================
// IMPORTAÇÃO NO CHROMADB
// =====================================================

async function importIntoChroma(items) {
  const collection = await chroma.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { "hnsw:space": "cosine" },
  });

  for (
    let start = 0;
    start < items.length;
    start += CHROMA_BATCH_SIZE
  ) {
    const batch = items.slice(start, start + CHROMA_BATCH_SIZE);

    await collection.upsert({
      ids: batch.map((item) => item.id),
      embeddings: batch.map((item) => item.embedding),
      documents: batch.map((item) => item.document),
      metadatas: batch.map((item) => ({
        title: item.title,
        tags: item.tags,
        model: item.model || MODEL,
      })),
    });

    console.log(
      `ChromaDB: ${Math.min(start + batch.length, items.length)}` +
      `/${items.length}`
    );
  }
}

// =====================================================
// EXECUÇÃO
// =====================================================

async function main() {
  if (!fs.existsSync(CSV_FILE)) {
    throw new Error(`CSV não encontrado: ${CSV_FILE}`);
  }

  const movies = await readCsv();
  const completed = await loadCheckpoint();

  const ignored = await writeIgnoredReport(movies);
  const ignoredIds = new Set(ignored.map((movie) => movie.id));

  const pending = movies.filter(
    (movie) =>
      !completed.has(movie.id) &&
      !ignoredIds.has(movie.id)
  );

  console.log(`Filmes no CSV: ${movies.length}`);
  console.log(`Vetores reaproveitados: ${completed.size}`);
  console.log(`Filmes ignorados por tamanho: ${ignored.length}`);
  console.log(`Filmes pendentes para embedding: ${pending.length}`);
  console.log(`Orçamento local estimado: ${MAX_ESTIMATED_TOKENS_PER_MINUTE} TPM`);

  if (ignored.length > 0) {
    console.log(`Relatório de ignorados: ${IGNORED_FILE}`);
  }

  for (let index = 0; index < pending.length; index++) {
    const movie = pending[index];

    console.log(
      `\nFilme ${index + 1}/${pending.length}: ${movie.title} ` +
      `(${movie.estimatedTokens} tokens estimados)`
    );

    const embedding = await embedMovie(movie);

    const item = {
      id: movie.id,
      title: movie.title,
      tags: movie.tags,
      document: movie.document,
      embedding,
      model: MODEL,
      dimensions: DIMENSIONS,
    };

    // Salva somente após receber e validar o vetor completo.
    await appendCheckpoint(item);
    completed.set(item.id, item);

    console.log(
      `Checkpoint: ${completed.size}/${movies.length}`
    );
  }

  // Importa os vetores válidos disponíveis. Filmes ignorados não
  // são apagados automaticamente da collection se já existirem nela.
  const allItems = movies
    .filter((movie) => !ignoredIds.has(movie.id))
    .map((movie) => {
      const saved = completed.get(movie.id);
      if (!saved) return null;

      return {
        id: movie.id,
        title: movie.title,
        tags: movie.tags,
        document: saved.document || movie.document,
        embedding: saved.embedding,
        model: saved.model || MODEL,
      };
    })
    .filter(Boolean);

  if (allItems.length > 0) {
    await importIntoChroma(allItems);
  }

  console.log("-----------------------------------");
  console.log(`Embeddings disponíveis: ${allItems.length}`);
  console.log(`Filmes ignorados: ${ignored.length}`);
  console.log(`Relatório: ${IGNORED_FILE}`);
  console.log("Execução concluída.");
}

main().catch((error) => {
  console.error("Erro fatal:", error);
  process.exitCode = 1;
});
