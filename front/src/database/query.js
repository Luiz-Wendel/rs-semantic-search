async function getMovies(moviesCollection, queryText) {
  const result = await moviesCollection.query({ queryTexts: [queryText]})

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
