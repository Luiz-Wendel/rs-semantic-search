import './App.css'

function App() {

  return (
    <>
      <h1>Movie Search</h1>

      <div className="search">
        <textarea placeholder="A movie about..."></textarea>
        <button>Search</button>
      </div>

      <div className="movie-list">
        <div className="movie-card"></div>
        <div className="movie-card"></div>
        <div className="movie-card"></div>
      </div>
    </>
  )
}

export default App
