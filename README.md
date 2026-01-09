# Abfahre

A tiny “Swiss departure board” web app I built for fun.

Type a stop name (or use location), and it shows the next departures in a typical departure board style. Times update live and the list refreshes regularly.

## How it works

- Frontend-only: plain HTML/CSS/JS (no build step)
- Station search: calls `/v1/locations`
- Departures: calls `/v1/stationboard`
- Updates: countdown ticks every second, data refreshes periodically

## Data source / attribution

Departure data is fetched from the Transport API at https://transport.opendata.ch.

The Transport API describes itself as an *inofficial* Swiss public transport API and notes that it uses the timetable web service from https://timetable.search.ch.

Not affiliated with SBB/CFF/FFS, VBZ, search.ch, or Opendata.ch.
