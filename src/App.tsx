import Scene from './components/Scene'
import './styles/app.css'

export default function App() {
  return (
    <>
      {/* WebGL bas-relief hero */}
      <Scene />

      {/* Editorial overlay — matched to Figma frame 1846:2 */}
      <div className="frame">
        <header className="nav">
          <a className="nav__brand" href="/">
            B&amp;P.D.C.
          </a>
          <nav className="nav__links">
            <a href="#work">Work</a>
            <a href="#fragments">Fragments</a>
          </nav>
        </header>

        <img className="wordmark" src="/hero/wordmark.svg" alt="Binary Pencil" />

        <p className="tagline">
          Binary &amp; Pencil© the Independent Design Studio of Justin Greene.
        </p>
      </div>
    </>
  )
}
