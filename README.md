# Bikewatching

GitHub Pages: https://gyjdb.github.io/bikewatching/

An interactive map of Bluebikes traffic around Boston and Cambridge in March 2024, built for DSC 106 Lab 7 with Mapbox GL JS and D3.

## What it shows

- Bike lanes in Boston and Cambridge, drawn as map layers from each city's open data.
- One circle per Bluebikes station, drawn with D3 in an SVG over the map. A circle's area is the number of trips that started or ended there.
- Circle color in three steps: more departures, balanced, or more arrivals. The legend uses the same colors.
- A time slider that keeps the trips within an hour of the selected time. The chart behind it shows how many rides start through the day, and "Play the day" runs the slider through 24 hours.
- A tooltip with each station's name and exact numbers. It keeps up with the slider, so one station can be watched while the day plays.
- A list of the busiest stations at the selected time, for reading without the map.

Over a whole day almost every station sends out about as many bikes as it takes in, so the circles start out gray. Pick an hour and the commute shows: at 8:30 AM the residential edges turn blue, and Kendall Square, downtown Boston, and Longwood turn amber.

## How it works

- `map.js` counts the 261,687 trips into running totals per station and minute while the CSV downloads, and does not keep the rows. Any time window is then one subtraction per station, so the slider stays smooth.
- The SVG is added to Mapbox's own canvas container, so a drag or a scroll that starts on a circle still moves the map.
- The page follows the system's light or dark setting, basemap included.
- On a narrow screen the page scrolls past the map. There, one finger scrolls the page and two fingers move the map.

## Files

- `index.html`: the page, the slider, the legend.
- `global.css`: fonts, colors, and base styles.
- `map.css`: the layout, the station circles, the time filter, the list, the legend, the tooltip.
- `map.js`: the map, data loading, and all interaction.
- `assets/`: the favicon and the two fonts.

## Access token

`map.js` needs a Mapbox public token (it starts with `pk.`) at the top of the file. Public tokens are meant to be used in web pages. In the Mapbox account, the token can be restricted to this site's URL.

## Run locally

Serve the folder over HTTP, because the page loads JavaScript modules:

```sh
python -m http.server 8000
```

Then open http://localhost:8000.

## Data and credits

- Stations and March 2024 trips: [Bluebikes system data](https://bluebikes.com/system-data), in the copies hosted for DSC 106 Lab 7.
- Boston bike lanes: [Existing Bike Network 2022](https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022), City of Boston.
- Cambridge bike lanes: [Bike Facilities](https://github.com/cambridgegis/cambridgegis_data), City of Cambridge GIS.
- Basemap: Mapbox and OpenStreetMap contributors.
- Fonts: Roboto Serif and Martian Mono, under the SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
- The favicon is an original drawing.

[Lab 7 instructions](https://dsc106.com/labs/lab07/)
