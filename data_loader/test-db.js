import { ChromaClient } from "chromadb";

const chromaClient = new ChromaClient();

const collection = await chromaClient.getOrCreateCollection({
  name: "movies",
});

console.log(await collection.count());
console.log(await collection.query({ queryTexts: ["A young boy discovers he has magical powers and attends a school for wizards."] }));
