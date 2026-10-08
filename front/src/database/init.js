import react from 'react'

import { ChromaClient } from "chromadb"

function useChroma() {
    const [hasChromaConnection, setHasChromaConnection] = react.useState(false)
    const [moviesCollection, setMoviesCollection] = react.useState(null)

    react.useEffect(() => {
      const initializeChroma = async () => {
        const chromaClient = new ChromaClient()

        const collection = await chromaClient.getCollection({
          name: "movies",
          space: "cosine",
        })

        setMoviesCollection(collection)
        setHasChromaConnection(true)
      }

      initializeChroma()
    }, [])

    return [hasChromaConnection, moviesCollection]
}

export default useChroma
