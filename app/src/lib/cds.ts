/**
 * True when CDS (Strasbourg) does not answer but ESASky does, checked once per visit: the sky view then loads its surveys
 * from ESASky's mirrors. Offline both fail, so the view keeps the CDS tiles it has cached.
 * no-cors, and URLs the service worker does not cache: only whether the host answers matters.
 */
let check: Promise<boolean> | null = null

const answers = (url: string) => fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) }).then(() => true, () => false)

export function cdsDown(): Promise<boolean> {
  check ??= Promise.all([
    answers('https://alasky.cds.unistra.fr/MocServer/query?ID=CDS%2FP%2FDSS2%2Fcolor&get=id'),
    answers('https://skies.esac.esa.int/DSSColor/'),
  ]).then(([cds, esa]) => !cds && esa)
  return check
}
