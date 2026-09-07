# Third-party notices

## AKILIMO QUEFTS

The numerical core in harvest-model.js is adapted from R/quefts.R in
https://github.com/IITA-AKILIMO/akilimo-recommendations (main, retrieved 2026-09-07).
The upstream license is embedded in README.md.
Changes: JavaScript port, configurable crop coefficients, zero/singular-case guards,
nonnegative output bound, explicit kg/ha dry-matter units. Climate/economic layers
are demo assumptions, not upstream LINTUL or its calibrated datasets.

MIT License

Copyright (c) 2024 Akilimo Project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Weather and maps

Historical weather: Open-Meteo ERA5, https://open-meteo.com/en/docs/historical-weather-api; data attribution CC BY 4.0. Hosted free endpoint is intended here for demo use.
Maps: OpenStreetMap contributors (attribution shown in map). Existing Leaflet 1.9.4 dependency is reused.

## Crop parameters

Cassava concentration/recovery values: supplied AKILIMO report, citing Ezui et al. (2016).
Sweet potato: potato proxy from supplied report, citing Nijhof (1987); uncalibrated and dry/fresh basis requires verification. No claim of sweet-potato validation.

## China soil surface data (local runtime assets)

Dai, Y., Shangguan, W. (2019). Dataset of soil properties for land surface modeling over China. National Tibetan Plateau / Third Pole Environment Data Center.
https://doi.org/10.11888/Soil.tpdc.270281

Required article citation: Shangguan et al. (2013). A China Dataset of Soil Properties for Land Surface Modeling. Journal of Advances in Modeling Earth Systems. https://doi.org/10.1002/jame.20026

Official dataset license: Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0), https://creativecommons.org/licenses/by-nc-sa/4.0/
Local derived surface grids retain this license. Changes: extracted the 0–4.5 cm layer; lossless NetCDF4 compression; source missing-value metadata retained. Separate QC layers not included. Display units converted (ppm→mg/kg, organic matter %→g/kg). Data is historical background, not live measurement.
