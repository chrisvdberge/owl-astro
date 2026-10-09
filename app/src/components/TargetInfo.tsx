import { useState } from 'react'
import { catalogTag, isCustom, type CatObject } from '../lib/catalog'
import { useImages, type Img } from '../lib/images'

const enc = encodeURIComponent

/** Search links for places that have far more pictures (and amateur results) than any one API. */
function links(o: CatObject) {
  const ident = isCustom(o.id) ? o.names[0] : o.m ?? o.id
  const q = [ident, !isCustom(o.id) ? o.names[0] : ''].filter(Boolean).join(' ')
  return [
    { label: 'AstroBin', href: `https://app.astrobin.com/search?q=${enc(ident)}` },
    { label: 'Google Images', href: `https://www.google.com/search?tbm=isch&q=${enc(q + ' astrophotography')}` },
    ...(isCustom(o.id) ? [] : [
      { label: 'SIMBAD', href: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${enc(o.id)}` },
      { label: 'Wikipedia', href: `https://en.wikipedia.org/wiki/Special:Search?search=${enc(q)}` },
    ]),
  ]
}

/** Facts, search links and example images for a catalog object (or custom field). `lazy` waits for `open` before fetching images. */
export default function TargetInfo({ o, open = true, compact = false }: { o: CatObject; open?: boolean; compact?: boolean }) {
  const { images, loading, error } = useImages(o, open)
  const [view, setView] = useState<Img | null>(null)
  const aka = [o.m, ...o.names.slice(1), ...o.alt].filter((x): x is string => !!x && x !== o.id).slice(0, 6)
  return (
    <div className="info">
      {!compact && <p className="note">
        {o.typeName}{o.names[0] && !isCustom(o.id) ? ` · ${o.names[0]}` : ''}{!isCustom(o.id) && ` · ${catalogTag(o)}`} · {o.con}
        {o.mag != null && ` · mag ${o.mag}`}{o.maj ? ` · ${o.maj}′${o.min ? ` × ${o.min}′` : ''}` : ''}{o.sb != null && ` · ${o.sb} mag/arcsec²`}
        {aka.length > 0 && <><br />Also: {aka.join(', ')}</>}
      </p>}
      <div className="chips">{links(o).map((l) => <a key={l.label} className="chip" href={l.href} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</div>
      {!isCustom(o.id) && (
        <>
          {loading && <p className="note">Looking for example images…</p>}
          {error && <p className="note">Couldn’t reach Wikimedia Commons — use the links above.</p>}
          {images && images.length === 0 && <p className="note">No images on Wikimedia Commons — try the links above.</p>}
          {images && images.length > 0 && (
            <div className="gal">{images.map((im) => <img key={im.id} crossOrigin="anonymous" src={im.thumb} alt={im.title} title={im.title} loading="lazy" onClick={() => setView(im)} />)}</div>
          )}
        </>
      )}
      {view && (
        <div className="modal" onClick={() => setView(null)}>
          <div className="lightbox" onClick={(e) => e.stopPropagation()}>
            <h2>{view.title}<button onClick={() => setView(null)}>Close</button></h2>
            <img src={view.full} crossOrigin="anonymous" alt={view.title} onError={(e) => { if (e.currentTarget.src !== view.thumb) e.currentTarget.src = view.thumb }} />
            <p className="note">{view.artist && `${view.artist} · `}{view.license} · <a href={view.page} target="_blank" rel="noreferrer">Source on Wikimedia Commons ↗</a></p>
          </div>
        </div>
      )}
    </div>
  )
}
