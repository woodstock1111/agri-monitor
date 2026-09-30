-- Historical daily weather for harvest prediction, one row per point and calendar year.
-- Filled on demand from Open-Meteo's ERA5 archive; later requests for the same point read from here.
-- Coordinates are rounded to 4 decimals (~11 m) before lookup and before the upstream request.
-- A year is final once fetched after 1 April of the following year (ERA5T preliminary data has been replaced by then);
-- earlier fetches are refreshed after a week.
CREATE TABLE harvest_weather_years (
    lat        numeric(7,4) NOT NULL,
    lng        numeric(8,4) NOT NULL,
    year       integer      NOT NULL,
    source     text         NOT NULL,
    daily      jsonb        NOT NULL,              -- { time: [...], <variable>: [...] } for that year only
    fetched_at timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (lat, lng, year)
);
