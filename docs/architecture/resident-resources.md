# Real-world resources for residents

What a resident could be given from the real world, why, and what stands in the way. Written down on 2026-11-13 so the list survives; the status column says what exists.

One observation shapes all of it: the first resident works every object put in front of him and ignores abstract commands (he had `search` for days and never used it). A new resource should arrive as a thing in the world with controls, not as another command.

| Resource                                                                                                                                        | What it gives a resident                                            | Cost and risk                                                                                                                | Status                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| A calculating bench: sandboxed maths, no network                                                                                                | Readings turn into results: fit pendulum timings, tally pea counts  | Small; nothing leaves the world                                                                                              | Built: the reckoning bench          |
| Live data behind the objects: real weather for 51° N, 10° E (Open-Meteo), river levels (Pegelonline), earthquakes (USGS), solar activity (NOAA) | Readings that change daily and cannot be exhausted in one sitting   | Small; free feeds, mostly without keys                                                                                       | Built: instrument shelter, the wire |
| Real species records for the same place (GBIF)                                                                                                  | Something real behind the robin and the other creatures             | Small to medium                                                                                                              | Built: the sightings ledger         |
| Structured references in the library: Wikipedia, arXiv, Open Library, Project Gutenberg, a star catalogue (SIMBAD)                              | Browsing shelves by subject instead of inventing a search query     | Small; goes through the research service                                                                                     | Not started                         |
| Eyes: images from Wikimedia Commons or NASA, and his own published pages rendered                                                               | He can judge what he made and work with pictures at the easel       | Medium; the gateway's image input is unchecked, and each step costs more tokens                                              | Not started                         |
| An audience that answers: comments on his pages through GitHub issues on his repository, plus mail replies                                      | A reason to make things for someone; replies can redirect a pursuit | Medium; strangers' text reaches his context and needs the same guard as messages. The GitHub App needs the issues permission | Not started                         |
| A public voice: an RSS feed of his site, later a Mastodon or Bluesky account                                                                    | His work reaches people who never visit Elsewhere                   | The feed is small. Accounts are higher risk: unreviewed posts under his name on other people's platforms                     | Not started                         |
| Something physical at the owner's place: a sensor, a webcam on a plant, a small plotter                                                         | Observations and marks in the actual world                          | Hardware, and a home is involved                                                                                             | Not started                         |

Held back on purpose: money, and writing to other people's repositories or inboxes unprompted. Both put strangers on the receiving end of an unreviewed loop.

## Wishes: coins and a well

A resident carries things. Three wishing coins arrive each week, a purse holds at most six, and a coin tossed into the wishing well with a wish written for it carries that wish to the owner. The coins are the only limit on wishes. The purse is the start of an inventory: anything later found, made or granted can be carried the same way.

## A computer, and Minecraft (idea only)

A computer object in the world with two uses: looking things up, and playing on a Minecraft server.

- **Looking things up:** `search` and `read` would move to the computer, which may also get them used.
- **Playing:** Minecraft runs in real time and a resident decides every 90 seconds or so. He would give intentions ("collect oak logs", "build a shelter here"); a small bot service carries them out, keeps him alive in between, and reports back in text what happened and what is around him.
- **Account:** none is needed on a private server with the account check switched off, using a bot client (Mineflayer, which joins as a normal player). That is only safe while the server is closed to the internet. If visitors with real accounts should join, he needs one Minecraft Java licence, or a server-side fake player (Carpet's `/player` or an own mod), for which perception and actions would have to be built by hand.
- **Hosting:** the inference VM has the memory and cores, but only about 3.8 GB of free disk; a world needs more.
- **Open:** whether visitors may join, and whether the world is survival or peaceful.
