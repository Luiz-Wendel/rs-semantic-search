
import { ChromaClient } from "chromadb";

const client = new ChromaClient();

const COLLECTION_NAME = "movies_gemini";

async function main() {
  const collections = await client.listCollections();

  const exists = collections.some(
    (collection) =>
      (typeof collection === "string"
        ? collection
        : collection.name) === COLLECTION_NAME
  );

  if (!exists) {
    console.log(`A collection "${COLLECTION_NAME}" não existe.`);
    return;
  }

  await client.deleteCollection({
    name: COLLECTION_NAME,
  });

  console.log(
    `Collection "${COLLECTION_NAME}" excluída com sucesso.`
  );
}

main().catch((error) => {
  console.error("Erro ao excluir collection:", error);
  process.exitCode = 1;
});