import { Canvas } from '@react-three/fiber'
import BasRelief from '../three/BasRelief'

/**
 * Full-viewport WebGL layer that sits behind the editorial UI.
 * An orthographic camera keeps the plate flat and pixel-stable.
 */
export default function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <BasRelief />
      </Canvas>
    </div>
  )
}
