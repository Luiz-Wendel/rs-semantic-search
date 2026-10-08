import './index.css'

const LOADING_URL = "https://cdn.pixabay.com/animation/2023/08/11/21/18/21-18-05-265_512.gif"

function LoadingIndicator() {
  return <div className="loading-indicator">
    <img
      src={LOADING_URL}
      width="20"
      height="20"
    />
    <p className="loading">Loading...</p>
  </div>
}

export default LoadingIndicator
