# Data attribution

`data/NGC.csv`, `data/addendum.csv` and the derived `app/public/catalog.json` come from
[OpenNGC](https://github.com/mattiaverga/OpenNGC) by Mattia Verga, licensed CC-BY-SA 4.0.

Sky imagery is streamed from HiPS surveys served by CDS (Aladin Lite); see each survey's own terms.
Cloud forecasts come from [Open-Meteo](https://open-meteo.com/).

Additional catalogs (data/raw, fetched by `app/scripts/fetch-catalogs.mjs`) come from the CDS services:
VizieR (van den Bergh VII/21, Barnard VII/220A, Lynds LDN VII/7A, Sharpless VII/20, Hickson VII/213,
Rodgers-Campbell-Whiteoak VII/216, Arp VII/192, Dias open clusters B/ocl) and SIMBAD (Abell planetary nebulae).
See https://cds.unistra.fr/ for their acknowledgement requirements.
