import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

type Props = {
  text: string
  separator?: string
  repeat?: number
  /** seconds for one full loop */
  duration?: number
}

/**
 * Seamless infinite marquee. Two identical tracks sit side by side inside an
 * inner flex row; translating that row by -50% (exactly one track width) and
 * repeating makes the seam invisible. GSAP drives it.
 */
export default function Marquee({
  text,
  separator = '✳',
  repeat = 6,
  duration = 22,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null!)

  const track = (key: string) => (
    <div className="marquee__track" key={key} aria-hidden={key === 'b'}>
      {Array.from({ length: repeat }, (_, i) => (
        <span className="marquee__item u-cond" key={i}>
          {text}
          <span className="marquee__sep">{separator}</span>
        </span>
      ))}
    </div>
  )

  useGSAP(
    () => {
      gsap.to('.marquee__inner', {
        xPercent: -50,
        ease: 'none',
        duration,
        repeat: -1,
      })
    },
    { scope: wrap },
  )

  return (
    <div className="marquee" ref={wrap}>
      <div className="marquee__inner">
        {track('a')}
        {track('b')}
      </div>
    </div>
  )
}
