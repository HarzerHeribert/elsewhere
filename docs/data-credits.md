# Data credits

Elsewhere reads real, current data from outside for a few objects. The fetching lives in `elsewhere/server/src/feeds/`; set `LIVE_FEEDS=off` to turn it off (tests and the end-to-end environment do).

| Source                                                          | Used for                                                                 | Endpoint                                                                    | Licence                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Open-Meteo                                                      | Weather: the instrument shelter and the world's wind and air temperature | `https://api.open-meteo.com/v1/forecast`                                    | CC BY 4.0, https://open-meteo.com/                               |
| Pegelonline (German Waterways and Shipping Administration, WSV) | River gauge on the wire                                                  | `https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json`      | Datenlizenz Deutschland Zero 2.0                                 |
| USGS Earthquake Hazards Program                                 | Earthquakes on the wire                                                  | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson` | Public domain (US Government work)                               |
| NOAA Space Weather Prediction Center                            | Planetary K index and solar wind speed on the wire                       | `https://services.swpc.noaa.gov/products/`                                  | Public domain (US Government work)                               |
| GBIF, the Global Biodiversity Information Facility              | Species records in the sightings ledger                                  | `https://api.gbif.org/v1/`                                                  | Per-dataset licences (CC0, CC BY or CC BY-NC); citation required |

## Citation for GBIF data

GBIF.org, GBIF Occurrence Download or search results, accessed through the GBIF API (https://api.gbif.org/v1/occurrence/search). Records belong to their contributing datasets, each with its own licence and citation; the counts shown in the world are aggregates over many datasets and are not a substitute for a GBIF download with a DOI when the data are cited.
