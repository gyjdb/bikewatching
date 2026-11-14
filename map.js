// Import Mapbox as an ESM module, and D3 for loading data, scales, and drawing the stations.
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Step 1.3: the default public token from the Mapbox account dashboard. It starts with "pk.".
mapboxgl.accessToken = 'pk.eyJ1IjoiZ3lqZGIiLCJhIjoiY213ZnpxenRuMDc3OTM0cHllbHpsOHQycyJ9.0EYUtqrniAZpweTtYbXOsg';

const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRIPS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
const BIKE_LANE_URLS = {
  boston: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  cambridge: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
};

const MINUTES_IN_DAY = 1440;
// A time filter keeps trips that started or ended within this many minutes of the selected time.
const WINDOW = 60;
// One slot per minute, plus a leading zero, so each station's counts can be stored as running totals.
const SLOTS = MINUTES_IN_DAY + 1;
// Minutes per bar in the chart of the day under the slider.
const PROFILE_BIN = 10;
// How long "Play the day" takes to run through 24 hours, in seconds.
const PLAY_SECONDS = 24;
// How many stations the "Busiest stations" list shows when it has the room.
const BUSIEST_ROWS = 5;

const mapElement = document.getElementById('map');
const statusText = document.getElementById('status');
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');
const playButton = document.getElementById('play');
const tooltip = document.getElementById('tooltip');
const formatCount = d3.format(',');

// Running totals of trips per station per minute, filled in once the trip data has loaded.
let departureTotals;
let arrivalTotals;

let map;

// Step 3.3: convert a station's longitude and latitude to pixels on the map as it is drawn right now.
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Step 5.2: minutes since midnight, as a time like "8:30 AM".
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// The stretch of the day a time filter covers, like "7:30 AM – 9:30 AM".
function describeWindow(timeFilter) {
  if (timeFilter === -1) return 'all day';
  const from = (timeFilter - WINDOW + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const to = (timeFilter + WINDOW) % MINUTES_IN_DAY;
  return `${formatTime(from)} – ${formatTime(to)}`;
}

// "2024-03-20 08:18:13" -> 498. Reading the digits directly avoids Date parsing,
// which is slower and handles this format differently across browsers.
function minutesSinceMidnight(timestamp) {
  return Number(timestamp.slice(11, 13)) * 60 + Number(timestamp.slice(14, 16));
}

// Trips at one station between two minutes of the day, both included.
function countBetween(totals, station, from, to) {
  const start = station * SLOTS;
  return totals[start + to + 1] - totals[start + from];
}

// Step 5.3: trips at one station within WINDOW minutes of the selected time. The window wraps around midnight.
function countNear(totals, station, timeFilter) {
  if (timeFilter === -1) return countBetween(totals, station, 0, MINUTES_IN_DAY - 1);
  const minute = timeFilter % MINUTES_IN_DAY;
  const from = minute - WINDOW;
  const to = minute + WINDOW;
  if (from < 0) {
    return countBetween(totals, station, 0, to) + countBetween(totals, station, from + MINUTES_IN_DAY, MINUTES_IN_DAY - 1);
  }
  if (to >= MINUTES_IN_DAY) {
    return countBetween(totals, station, from, MINUTES_IN_DAY - 1) + countBetween(totals, station, 0, to - MINUTES_IN_DAY);
  }
  return countBetween(totals, station, from, to);
}

// Steps 4.2 and 5.3: arrivals, departures, and total traffic for every station at the selected time.
function computeStationTraffic(stations, timeFilter = -1) {
  return stations.map((station, i) => {
    station.departures = countNear(departureTotals, i, timeFilter);
    station.arrivals = countNear(arrivalTotals, i, timeFilter);
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

// Step 6.1: the share of a station's traffic that is departures. A station with no trips counts as balanced.
function departureRatio(station) {
  return station.totalTraffic ? station.departures / station.totalTraffic : 0.5;
}

// Steps 4.1 and 5.4: read the trips and count them per station and minute as they arrive.
// The lab sorts trips into 1,440 buckets; running totals go one step further, so any time window
// is one subtraction per station and the slider stays smooth with a quarter of a million trips.
async function loadTrips(stationIndex, stationCount) {
  const departures = new Uint32Array(stationCount * SLOTS);
  const arrivals = new Uint32Array(stationCount * SLOTS);
  const startsByMinute = new Uint32Array(MINUTES_IN_DAY);
  let rides = 0;

  // Returning nothing from the row function tells D3 not to keep the row, which saves memory.
  await d3.csv(TRIPS_URL, trip => {
    const startMinute = minutesSinceMidnight(trip.started_at);
    const endMinute = minutesSinceMidnight(trip.ended_at);
    if (!(startMinute < MINUTES_IN_DAY && endMinute < MINUTES_IN_DAY)) return;
    const from = stationIndex.get(trip.start_station_id);
    const to = stationIndex.get(trip.end_station_id);
    if (from !== undefined) departures[from * SLOTS + startMinute + 1]++;
    if (to !== undefined) arrivals[to * SLOTS + endMinute + 1]++;
    startsByMinute[startMinute]++;
    rides++;
  });

  for (const totals of [departures, arrivals]) {
    for (let station = 0; station < stationCount; station++) {
      const start = station * SLOTS;
      for (let slot = 1; slot < SLOTS; slot++) totals[start + slot] += totals[start + slot - 1];
    }
  }
  return { departures, arrivals, startsByMinute, rides };
}

// Step 2: bike lanes from both cities, drawn under the map's labels with one shared style.
function addBikeLanes() {
  const firstLabel = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id;
  const laneStyle = {
    // Read from the legend's own swatch, so the lines on the map always match the legend.
    'line-color': getComputedStyle(document.querySelector('.legend-lanes'), '::before').backgroundColor,
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3, 18, 6],
    'line-opacity': 0.55,
  };
  for (const [city, url] of Object.entries(BIKE_LANE_URLS)) {
    map.addSource(`${city}_route`, { type: 'geojson', data: url });
    map.addLayer({ id: `${city}-bike-lanes`, type: 'line', source: `${city}_route`, paint: laneStyle }, firstLabel);
  }
}

// The chart under the slider: trips started in each ten-minute stretch of the day.
// Its x-axis is the slider's own scale, from -1 (any time) to 1440.
function renderDayProfile(startsByMinute) {
  const bins = d3.range(0, MINUTES_IN_DAY, PROFILE_BIN).map(minute => ({
    minute,
    trips: d3.sum(startsByMinute.subarray(minute, minute + PROFILE_BIN)),
  }));
  const height = 100;
  const y = d3.scaleLinear().domain([0, d3.max(bins, d => d.trips)]).range([height, 4]);
  const area = d3.area()
    .x(d => d.minute + 1 + PROFILE_BIN / 2)
    .y0(height)
    .y1(d => y(d.trips))
    .curve(d3.curveMonotoneX)
    .digits(1);
  d3.select('#day-profile .profile-area').attr('d', area(bins));
}

// Shade the part of the day the filter covers on the chart. A window that crosses midnight needs two pieces.
function renderProfileWindow(timeFilter) {
  const pieces = [];
  if (timeFilter !== -1) {
    const minute = timeFilter % MINUTES_IN_DAY;
    const from = minute - WINDOW;
    const to = minute + WINDOW;
    pieces.push([Math.max(from, 0), Math.min(to, MINUTES_IN_DAY)]);
    if (from < 0) pieces.push([from + MINUTES_IN_DAY, MINUTES_IN_DAY]);
    if (to > MINUTES_IN_DAY) pieces.push([0, to - MINUTES_IN_DAY]);
  }
  d3.select('#day-profile .profile-window')
    .selectAll('rect')
    .data(pieces)
    .join('rect')
    .attr('x', d => d[0] + 1)
    .attr('width', d => d[1] - d[0])
    .attr('y', 0)
    .attr('height', 100);
}

// The busiest stations at the selected time, as a list people can read without the map.
function renderBusiest(stations, stationFlow, timeFilter) {
  const flowLabels = new Map([[1, 'more departures'], [0.5, 'balanced'], [0, 'more arrivals']]);
  const busiest = d3.sort(stations, d => -d.totalTraffic).slice(0, BUSIEST_ROWS).filter(d => d.totalTraffic > 0);
  const items = d3.select('#busiest')
    .selectAll('li')
    .data(busiest, d => d.short_name)
    .join(enter => {
      const item = enter.append('li');
      item.append('span').attr('class', 'station-name');
      const trips = item.append('span').attr('class', 'station-trips');
      trips.append('span').attr('class', 'station-count');
      // The unit is in the list's heading; this repeats it for screen readers, which read row by row.
      trips.append('span').attr('class', 'visually-hidden').text(' trips');
      item.append('span').attr('class', 'station-flow');
      return item;
    })
    .order()
    .style('--departure-ratio', d => stationFlow(departureRatio(d)));
  items.select('.station-name').text(d => d.name);
  items.select('.station-count').text(d => formatCount(d.totalTraffic));
  // The flow shows as a colored dot, the same as the legend; its name is there for screen readers.
  items.select('.station-flow').attr('role', 'img').attr('aria-label', d => flowLabels.get(stationFlow(departureRatio(d))));
  document.getElementById('busiest-scope').textContent = `Trips, ${describeWindow(timeFilter)}`;
}

// Beside the map the list has a fixed height, so it shows only the rows that fit whole.
// Rows are counted at their tallest, a name on two lines, which keeps the count steady while the day plays.
function fitBusiestRows() {
  const section = document.querySelector('.busiest');
  const row = section.querySelector('li');
  if (!row) return;
  // In one column nothing limits the section's height, and every row shows.
  if (getComputedStyle(section).overflowY !== 'hidden') {
    delete section.dataset.rows;
    return;
  }
  const rowStyle = getComputedStyle(row);
  const tallest = 2 * parseFloat(getComputedStyle(row.querySelector('.station-name')).lineHeight) +
    parseFloat(rowStyle.paddingTop) + parseFloat(rowStyle.paddingBottom) + parseFloat(rowStyle.borderBottomWidth);
  const room = section.getBoundingClientRect().bottom - row.parentElement.getBoundingClientRect().top;
  section.dataset.rows = Math.max(0, Math.min(BUSIEST_ROWS, Math.floor(room / tallest)));
}

// Step 4.4, taken further than a <title>: a tooltip with the station's name and exact numbers.
let tooltipStation = null;

function fillTooltip(station) {
  tooltip.querySelector('.tooltip-name').textContent = station.name;
  tooltip.querySelector('.tooltip-total').textContent = `${formatCount(station.totalTraffic)} trips`;
  tooltip.querySelector('.tooltip-split').textContent =
    `${formatCount(station.departures)} departures, ${formatCount(station.arrivals)} arrivals`;
  tooltip.style.setProperty('--departure-share', departureRatio(station));
}

function showTooltip(event, station) {
  tooltipStation = station;
  fillTooltip(station);
  tooltip.hidden = false;
  const { width, height } = tooltip.getBoundingClientRect();
  const gap = 14;
  const left = event.clientX + gap + width > innerWidth ? event.clientX - gap - width : event.clientX + gap;
  const top = event.clientY + gap + height > innerHeight ? event.clientY - gap - height : event.clientY + gap;
  tooltip.style.left = `${Math.max(gap, left)}px`;
  tooltip.style.top = `${Math.max(gap, top)}px`;
}

function hideTooltip() {
  tooltipStation = null;
  tooltip.hidden = true;
}

// Says why there is no map, in the map's own place, instead of leaving an empty box.
function showMapProblem(message) {
  let note = mapElement.querySelector('.map-fallback');
  if (!note) {
    note = document.createElement('p');
    note.className = 'map-fallback';
    mapElement.append(note);
  }
  note.textContent = message;
  mapElement.classList.add('no-map');
}

function describeStation(station) {
  return `${station.name}: ${formatCount(station.totalTraffic)} trips (${formatCount(station.departures)} departures, ${formatCount(station.arrivals)} arrivals)`;
}

async function start() {
  if (!mapboxgl.accessToken.startsWith('pk.')) {
    showMapProblem('The map needs a Mapbox public token. Add it at the top of map.js.');
    statusText.textContent = 'Waiting for a Mapbox token.';
    return;
  }

  // Step 1.3: create the map, centered between Boston and Cambridge.
  // A quiet monochrome basemap keeps the data on top; it follows the system's light or dark setting.
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');
  const mapStyle = () => `mapbox://styles/mapbox/${darkScheme.matches ? 'dark-v11' : 'light-v11'}`;
  map = new mapboxgl.Map({
    container: 'map',
    style: mapStyle(),
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18,
    // In the one-column layout the page scrolls past the map, so there one finger scrolls the page
    // and two move the map. Beside the panel, the map takes every gesture.
    cooperativeGestures: !matchMedia('(min-width: 60em)').matches,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
  // Step 3.2: the SVG that holds the stations. The lab writes it into index.html; adding it to the
  // map's own canvas container instead lets a drag or a scroll that starts on a circle still move
  // the map, and gives Mapbox the empty container it asks for.
  d3.select(map.getCanvasContainer()).append('svg');
  // Step 2.1: data can only be added once the map's style has loaded. Listening for the style
  // rather than the first load brings the lanes back after the basemap switches.
  map.on('style.load', addBikeLanes);
  // The light and dark styles are swapped whole; Mapbox cannot work out a partial update between them.
  darkScheme.addEventListener('change', () => map.setStyle(mapStyle(), { diff: false }));

  // If the basemap has not arrived after a while, say so. The note goes away if the map turns up late.
  const slowMap = setTimeout(() => {
    showMapProblem('The map is taking a long time to load. The time filter and the station list still work.');
  }, 15000);
  map.once('style.load', () => {
    clearTimeout(slowMap);
    mapElement.classList.remove('no-map');
  });
  map.on('error', event => {
    if (event.error?.status === 401 || event.error?.status === 403) {
      clearTimeout(slowMap);
      showMapProblem('Mapbox did not accept the access token in map.js. The time filter and the station list still work.');
    }
  });

  // Both downloads start right away instead of waiting for the map to finish loading.
  const stationsLoading = d3.json(STATIONS_URL).then(json => json.data.stations);
  const tripsLoading = stationsLoading.then(stations =>
    loadTrips(new Map(stations.map((station, i) => [station.short_name, i])), stations.length));
  // Errors are reported where the results are awaited below.
  tripsLoading.catch(() => {});

  // The stations don't wait for the basemap's tiles: the map can place a point as soon as it exists.
  (async () => {
    let stations;
    try {
      stations = await stationsLoading;
    } catch (error) {
      console.error('Error loading stations:', error);
      statusText.textContent = 'The station list could not be loaded. Refresh to try again.';
      return;
    }

    // Step 3.3: one circle per station in the SVG that sits on top of the map.
    const svg = d3.select('#map').select('svg');
    const circles = svg
      .selectAll('circle')
      .data(stations, d => d.short_name) // the key lets D3 match circles to stations on every update
      .enter()
      .append('circle')
      .attr('r', 3)
      .style('--departure-ratio', 0.5)
      .on('pointerenter pointermove', showTooltip)
      // A mouse leaves a circle. A finger only lifts, so a tooltip opened by touch stays until the next tap.
      .on('pointerleave', event => { if (event.pointerType === 'mouse') hideTooltip(); });
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#map svg circle')) hideTooltip();
    });
    // Once the map moves, the tooltip is no longer beside its station.
    map.on('movestart', hideTooltip);

    // Keep the circles on their stations while the map pans, zooms, or resizes.
    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
    }
    updatePositions();
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    statusText.textContent = `${stations.length} stations. Loading a month of rides…`;

    let trips;
    try {
      trips = await tripsLoading;
    } catch (error) {
      console.error('Error loading trips:', error);
      statusText.textContent = 'The ride data could not be loaded. Refresh to try again.';
      return;
    }
    departureTotals = trips.departures;
    arrivalTotals = trips.arrivals;
    computeStationTraffic(stations);

    // Step 4.3: a square root scale, so a circle's area (not its radius) is proportional to its traffic.
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, d => d.totalTraffic)])
      .range([0, 25]);
    // Step 6.1: three steps of color read more clearly than a continuous blend.
    const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

    // Busy stations are drawn first, so the small ones land on top and can still be hovered.
    circles.sort((a, b) => b.totalTraffic - a.totalTraffic);

    // Step 5.3: resize and recolor the circles for the selected time.
    function updateScatterPlot(timeFilter) {
      const filteredStations = computeStationTraffic(stations, timeFilter);
      // A filter leaves fewer trips, so the circles get a larger range to stay readable.
      // Both ranges shrink on a small map, where full-size circles would cover it.
      const fit = Math.min(1, Math.max(0.6, mapElement.clientWidth / 900));
      timeFilter === -1 ? radiusScale.range([0, 25 * fit]) : radiusScale.range([3 * fit, 50 * fit]);
      circles
        .data(filteredStations, d => d.short_name)
        .join('circle')
        .attr('r', d => radiusScale(d.totalTraffic))
        .attr('aria-label', describeStation)
        .style('--departure-ratio', d => stationFlow(departureRatio(d)));
      renderBusiest(filteredStations, stationFlow, timeFilter);
      // A tooltip left open keeps up with the time, so a station can be watched while the day plays.
      if (tooltipStation) fillTooltip(tooltipStation);
    }

    // Step 5.2: show the selected time, or "(any time)" when the slider is at -1.
    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value);
      const anyTime = timeFilter === -1;
      selectedTime.textContent = anyTime ? '' : formatTime(timeFilter);
      selectedTime.hidden = anyTime;
      anyTimeLabel.hidden = !anyTime;
      timeSlider.setAttribute('aria-valuetext', anyTime ? 'Any time' : formatTime(timeFilter));
      renderProfileWindow(timeFilter);
      updateScatterPlot(timeFilter);
    }

    // "Play the day" moves the slider through 24 hours, so the morning and evening rush can be watched.
    let playing = 0;
    let lastFrame = 0;
    function stopPlaying() {
      cancelAnimationFrame(playing);
      playing = 0;
      playButton.setAttribute('aria-pressed', 'false');
      playButton.textContent = 'Play the day';
    }
    function playFrame(now) {
      const elapsed = Math.min(now - lastFrame, 100);
      lastFrame = now;
      const current = Math.max(Number(timeSlider.value), 0);
      timeSlider.value = (current + (elapsed / 1000) * (MINUTES_IN_DAY / PLAY_SECONDS)) % MINUTES_IN_DAY;
      updateTimeDisplay();
      playing = requestAnimationFrame(playFrame);
    }
    playButton.addEventListener('click', () => {
      if (playing) return stopPlaying();
      playButton.setAttribute('aria-pressed', 'true');
      playButton.textContent = 'Pause';
      lastFrame = performance.now();
      playing = requestAnimationFrame(playFrame);
    });
    // Dragging the slider takes over from the animation.
    timeSlider.addEventListener('pointerdown', stopPlaying);
    timeSlider.addEventListener('keydown', stopPlaying);

    renderDayProfile(trips.startsByMinute);
    timeSlider.addEventListener('input', updateTimeDisplay);
    timeSlider.disabled = false;
    playButton.disabled = false;
    updateTimeDisplay();
    new ResizeObserver(fitBusiestRows).observe(document.querySelector('.busiest'));
    statusText.textContent = `${formatCount(trips.rides)} rides, ${stations.length} stations, March 2024`;
  })();
}

start();
