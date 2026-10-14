import { GoogleGenAI } from "@google/genai"

async function queryText(collection, query) {
  return collection.query({ queryTexts: [query]})
}

async function queryEmbedding(collection, query) {
  const genai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY })

  const response = await genai.models.embedContent({
    model: "gemini-embedding-2",
    contents: query,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768,
    },
  });

  const embedding = response.embeddings[0].values;

  return collection.query({ queryEmbeddings: [embedding]})
}

async function getMovies(moviesCollection, query) {
  let result;

  switch (moviesCollection.name) {
    case "movies_gemini":
      result = await queryEmbedding(moviesCollection, query)
      break
    default:
      result = await queryText(moviesCollection, query)
  }

  const distances = result.distances[0].map((distance) => (((1 - distance) + 1) / 2).toFixed(2))

  const movies =[]
  for(let i = 0; i < result.ids[0].length; i++) {
    movies.push({
      id: result.ids[0][i],
      distance: distances[i],
      title: result.metadatas[0][i].title,
      tags: result.metadatas[0][i].tags.split(", "),
      synopsis: result.metadatas[0][i].synopsis,
    })
  }

  return movies
}

export { getMovies }
