import Scene from './components/Scene'
import Marquee from './components/Marquee'
import './styles/app.css'

export default function App() {
  return (
    <>
      {/* WebGL bas-relief layer */}
      <Scene />

      {/* Editorial overlay */}
      <div className="frame">
        <header className="nav">
          <a className="nav__brand u-mono" href="/">
            BinaryPencil©
          </a>
          <nav className="nav__links u-mono">
            <a href="#about">About</a>
            <a href="#fragments">Fragments</a>
            <a href="#contact">Contact</a>
          </nav>
        </header>

        {/* Left rail */}
        <div className="rail rail--left u-mono">
          <span>✳ Worldwide ✳</span>
          <span>Nº Los Angeles</span>
        </div>

        {/* Right micro-statement */}
        <div className="statement u-mono">
          A new calibration. A re-balance<br />of conformed ideas
          <div className="statement__mark" aria-hidden="true">
            <span className="statement__dot" />
            <span className="statement__line" />
            <span className="statement__star">✳</span>
          </div>
        </div>

        {/* Center serif lockup */}
        <div className="lockup">
          <p className="lockup__lead u-mono">
            A futurist&apos;s journey, unlocking<br />
            the hidden potential of visionary brands.
          </p>
          <h1 className="lockup__title u-serif">
            Binary Pencil© the Independent<br />
            Design Studio of Justin Greene.
          </h1>
        </div>

        <Marquee
          text="Independent Design Studio"
          separator="✳"
          repeat={8}
        />
      </div>
    </>
  )
}
