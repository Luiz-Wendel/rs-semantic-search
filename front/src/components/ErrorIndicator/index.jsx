import './index.css'

function ErrorIndicator({ error }) {
  return (
    <div className="error-indicator">
      <p>Something went wrong:</p>
      <pre>{error}</pre>
    </div>
  )
}

export default ErrorIndicator
