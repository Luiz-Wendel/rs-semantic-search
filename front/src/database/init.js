import react from 'react'

import { ChromaClient } from "chromadb"

function useChroma(collectionName) {
    const [hasChromaConnection, setHasChromaConnection] = react.useState(false)
    const [moviesCollection, setMoviesCollection] = react.useState(null)

    react.useEffect(() => {
      const initializeChroma = async () => {
        const chromaClient = new ChromaClient()

        const collection = await chromaClient.getCollection({
          name: collectionName,
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
