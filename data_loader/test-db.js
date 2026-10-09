import { ChromaClient } from "chromadb";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const genai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const chromaClient = new ChromaClient();

const QUERY = "A young boy discovers he has magical powers and attends a school for wizards.";

const Moviescollection = await chromaClient.getOrCreateCollection({
  name: "movies",
});

console.log(await Moviescollection.count());
console.log(await Moviescollection.query({ queryTexts: [QUERY] }));

const Geminicollection = await chromaClient.getOrCreateCollection({
  name: "movies_gemini",
});

const response = await genai.models.embedContent({
  model: "gemini-embedding-2",
  contents: QUERY,
  config: {
    taskType: "RETRIEVAL_QUERY",
    outputDimensionality: 768,
  },
});

const queryEmbedding = response.embeddings[0].values;

console.log(await Geminicollection.count());
console.log(await Geminicollection.query({ queryEmbeddings: [queryEmbedding] }));
