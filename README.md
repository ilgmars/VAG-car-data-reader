# VAG Car Data Reader

[![Deploy to GitHub Pages](https://github.com/ilgmars/VAG-car-data-reader/actions/workflows/deploy.yml/badge.svg)](https://github.com/ilgmars/VAG-car-data-reader/actions/workflows/deploy.yml)

**[Open the tool](https://ilgmars.github.io/VAG-car-data-reader/)**

Reads an exported VAG vehicle data archive and shows what's in it: signal counts, latest values, min/max, time range, history charts and CSV export.

[If you have a VAG vehicle, you can use this service to request your data.](https://eu-data-act.drivesomethinggreater.com) 

## What it does

- Reads a `.zip` containing one or more JSON exports (or one or more `.json` files)
- Groups every signal, with record counts, latest value, min/max and time range
- Expand any signal to see its full timestamped history
- Filter signals, sort by any column, and export everything to CSV
- Latitude/longitude signals plot as a connected location track on a local map,
  with an opt-in OpenStreetMap street layer
- Field descriptions, units and cluster names follow the official VW Group
  EU Data Act Data Dictionary (Historical + Continuous Data, v1.0.5, 25.02.2026)

All processing happens locally in your browser. No data is uploaded.

## Usage

Open the tool, drag in your archive, or click **Load sample data** to try it.
