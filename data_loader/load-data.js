import fs from "fs";

import { ChromaClient } from "chromadb";
import csv from "csv-parser";

const chromaClient = new ChromaClient();

const collection = await chromaClient.getOrCreateCollection({
  name: "movies",
});

const ids = [];
const documents = [];
const metadatas = [];

fs.createReadStream("mpst_full_data.csv")
  .pipe(csv())
  .on("data", async (row) => {
    const { imdb_id, plot_synopsis, title, tags } = row;

    const document = {
      title: title,
      tags: tags,
      synopsis: plot_synopsis,
    };

    ids.push(imdb_id);
    documents.push(JSON.stringify(document));
    metadatas.push(document);
  })
  .on("end", async () => {
    let startIndex = 0;
    const batchSize = 500;

    while (startIndex < ids.length) {
      const endIndex = Math.min(startIndex + batchSize, ids.length);
      const batchIds = ids.slice(startIndex, endIndex);
      const batchDocuments = documents.slice(startIndex, endIndex);
      const batchMetadatas = metadatas.slice(startIndex, endIndex);

      await collection.add({
        ids: batchIds,
        documents: batchDocuments,
        metadatas: batchMetadatas,
      });

      startIndex = endIndex;
    }
  });
