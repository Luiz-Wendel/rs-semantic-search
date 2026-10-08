import MovieTag from '../MovieTag'

import './index.css'

function MovieCard({ id, title, tags, synopsis, distance }) {
  const distancePercentage = distance * 100
  const imdbUrl = `https://www.imdb.com/title/${id}`

  return <div className="movie-card">
    <h2 className="movie-title">
      <div className="movie-title-background" style={{ width: `${distancePercentage}%` }}>Match: {distancePercentage}%</div>
      <a href={imdbUrl} target="_blank" rel="noopener noreferrer">
        {title}
      </a>
    </h2>
    <div className="movie-tags">
      {tags.map((tag, index) => (
        <MovieTag key={index} tag={tag} />
      ))}
    </div>
    <div className="movie-synopsis">{synopsis}</div>
  </div>
}

export default MovieCard
