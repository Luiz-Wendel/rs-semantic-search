
import fs from "node:fs";
import csv from "csv-parser";
import { ChromaClient } from "chromadb";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const genai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const chromaClient = new ChromaClient();

const COLLECTION_NAME = "movies_gemini";
const CSV_FILE = "mpst_full_data.csv";
const EMBEDDINGS_FILE = "gemini_embeddings.json";
const CHECKPOINT_FILE = "checkpoint.json";

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES = 20_000;
const MAX_RETRIES = 5;

const collection = await chromaClient.getOrCreateCollection({
  name: COLLECTION_NAME,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedWithRetry(documents, attempt = 0) {
  try {
    return await genai.models.embedContent({
      model: "gemini-embedding-2",
      contents: documents,
      config: {
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      },
    });
  } catch (error) {
    if (error.status !== 429 || attempt >= MAX_RETRIES) {
      throw error;
    }

    const delay = Math.min(60_000, 2_000 * 2 ** attempt);

    console.log(
      `Rate limit exceeded. Retry ${attempt + 1}/${MAX_RETRIES}. ` +
      `Waiting ${delay / 1000}s...`
    );

    await sleep(delay);
    return embedWithRetry(documents, attempt + 1);
  }
}

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(file)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function importFromJson() {
  console.log(`Using precomputed embeddings: ${EMBEDDINGS_FILE}`);

  const records = JSON.parse(
    fs.readFileSync(EMBEDDINGS_FILE, "utf8")
  );

  if (!Array.isArray(records)) {
    throw new Error("Embeddings JSON must contain an array.");
  }

  const rows = await readCsv(CSV_FILE);
  const moviesById = new Map(
    rows
      .filter((row) => row.imdb_id?.trim())
      .map((row) => [row.imdb_id.trim(), row])
  );

  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);

    const ids = [];
    const embeddings = [];
    const documents = [];
    const metadatas = [];

    for (const record of batch) {
      const id = record.id;
      const movie = moviesById.get(id);
      const embedding = record.embedding;

      if (!movie) {
        console.warn(`Skipping ${id}: not found in CSV`);
        skipped++;
        continue;
      }

      if (
        !Array.isArray(embedding) ||
        embedding.length !== 768 ||
        !embedding.every(Number.isFinite)
      ) {
        throw new Error(`Invalid embedding for ${id}`);
      }

      const document = {
        title: movie.title ?? "",
        tags: movie.tags ?? "",
        synopsis: movie.plot_synopsis ?? "",
      };

      ids.push(id);
      embeddings.push(embedding);
      documents.push(JSON.stringify(document));
      metadatas.push(document);
    }

    if (ids.length > 0) {
      await collection.upsert({
        ids,
        embeddings,
        documents,
        metadatas,
      });

      imported += ids.length;
    }

    console.log(
      `JSON import: ${Math.min(i + 100, records.length)}/` +
      `${records.length}; imported=${imported}; skipped=${skipped}`
    );
  }

  console.log("JSON import completed.");
}

async function importFromGemini() {
  console.log("Embeddings JSON not found. Generating embeddings with Gemini.");

  const rows = await readCsv(CSV_FILE);

  const ids = [];
  const documents = [];
  const metadatas = [];

  for (const row of rows) {
    const id = row.imdb_id?.trim();

    if (!id) continue;

    const document = {
      title: row.title ?? "",
      tags: row.tags ?? "",
      synopsis: row.plot_synopsis ?? "",
    };

    ids.push(id);
    documents.push(JSON.stringify(document));
    metadatas.push(document);
  }

  let startIndex = 0;

  if (fs.existsSync(CHECKPOINT_FILE)) {
    const checkpoint = JSON.parse(
      fs.readFileSync(CHECKPOINT_FILE, "utf8")
    );

    startIndex = checkpoint.startIndex ?? 0;

    if (
      !Number.isInteger(startIndex) ||
      startIndex < 0 ||
      startIndex > ids.length
    ) {
      throw new Error("Invalid checkpoint index.");
    }

    console.log(`Resuming from index ${startIndex}`);
  }

  while (startIndex < ids.length) {
    const endIndex = Math.min(
      startIndex + BATCH_SIZE,
      ids.length
    );

    const batchDocuments = documents.slice(startIndex, endIndex);

    const response = await embedWithRetry(batchDocuments);
    const embeddings = response.embeddings.map(({ values }) => values);

    if (
      embeddings.length !== batchDocuments.length ||
      embeddings.some(
        (embedding) =>
          !Array.isArray(embedding) ||
          embedding.length !== 768 ||
          !embedding.every(Number.isFinite)
      )
    ) {
      throw new Error("Gemini returned invalid embeddings.");
    }

    await collection.upsert({
      ids: ids.slice(startIndex, endIndex),
      embeddings,
      documents: batchDocuments,
      metadatas: metadatas.slice(startIndex, endIndex),
    });

    startIndex = endIndex;

    fs.writeFileSync(
      CHECKPOINT_FILE,
      JSON.stringify({ startIndex })
    );

    console.log(`Gemini import: ${startIndex}/${ids.length}`);

    if (startIndex < ids.length) {
      await sleep(DELAY_BETWEEN_BATCHES);
    }
  }

  fs.rmSync(CHECKPOINT_FILE, { force: true });
  console.log("Gemini import completed.");
}

// Choose the import path automatically.
if (fs.existsSync(EMBEDDINGS_FILE)) {
  await importFromJson();
} else {
  await importFromGemini();
}

console.log("Import process finished.");
