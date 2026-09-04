#!/usr/bin/env python3
"""
Generate an anonymized sample of a real VAG export.

The real export has 38 sensors and 99.75% of rows have no `value` field.
This script mirrors that shape: every sensor gets rows, most rows have no
value, but every sensor also has at least 2 rows with a real value so the
UI shows real Latest / Min / Max numbers (not just "—").

Per-sensor strategy:
  - 12 rows per sensor (a mix of present-value and missing-value rows)
  - 2 rows per sensor have a real value (one mid-range, one range-bound)
  - timestamps: mix of "YYYY-MM-DD HH:MM:SS" (real-export format) and ISO
  - VIN + userId replaced with neutral values
  - keys are real UUIDs from the source (anonymized fields only)

The output is committed at sample/sample.json.
"""
import json
import random
from pathlib import Path

random.seed(42)

REAL = Path("/tmp/TMBJW9PS5ST025024_20260901141844.json")
OUT = Path("/tmp/work/vag-reader/sample/sample.json")

# (field_name, sample_count, range_lo, range_hi, value_type)
# value_type: "int" | "float" | "bool" | "enum"
# Use real-world plausible ranges so charts have shape.
SENSORS = [
    # name,                                 count, lo,  hi,  type
    ("acceleratorPositionIndication",        12,  0,   100, "int"),    # %
    ("boardnetBatteryVoltageIndication",     12,  11.5, 14.8, "float"),# V
    ("brakePressureIndication",              12,  0,   250, "float"),  # bar
    ("clutchStateIndication",                12,  0,   1,   "int"),    # 0/1
    ("currentGearIndication",                12,  -1,  8,   "int"),    # -1=R, 0=N, 1-6
    ("doorTrunkStateIndication",             12,  0,   1,   "int"),    # 0=closed, 1=open
    ("driverIsBrakingIndication",            12,  0,   1,   "int"),
    ("drivingLightFrontIndication",          12,  0,   1,   "int"),
    ("drivingLightRearIndication",           12,  0,   1,   "int"),
    ("fogLightFrontIndication",              12,  0,   1,   "int"),
    ("fogLightRearIndication",               12,  0,   1,   "int"),
    ("freeWheelingIndication",               12,  0,   1,   "int"),
    ("gearboxOilTemperaturIndication",       12,  60,  120, "int"),    # °C
    ("highBeamFrontIndication",              12,  0,   1,   "int"),
    ("ignition",                             12,  0,   2,   "enum"),   # 0=off,1=acc,2=on
    ("inspectionDistance",                   12,  27000, 30000, "int"), # km
    ("inspectionOilDistance",                12,  27000, 30000, "int"),
    ("longTermAverageConsumption",           12,  4.5, 9.5, "float"),  # l/100km
    ("longTermAveragePrimaryEngineConsumptionIndication", 12, 4.5, 9.5, "float"),
    ("longTermAverageSecondaryEngineConsumptionIndication", 12, 4.5, 9.5, "float"),
    ("longTermAverageVehicleSpeedIndication", 12,  30,  80, "int"),    # km/h
    ("longTermTimeIndication",               12,  0,   100000, "int"), # minutes
    ("mileage_km",                            2,  15000, 15200, "int"), # total km
    ("outsideTemperatureIndication",         12,  -10, 35, "int"),    # °C
    ("parkingBrakeIndication",               12,  0,   1,   "int"),
    ("primaryEngineAbsChargingAirPressureIndication", 12, 0.8, 2.5, "float"),
    ("primaryEngineCoolantTemperatureIndication", 12, 70, 105, "int"),
    ("primaryEngineCurrentOutputPowerIndication", 12, 0, 200, "int"),  # kW
    ("primaryEngineMaxChargingAirPressureIndication", 12, 0.8, 2.8, "float"),
    ("primaryEngineMaxOutputPowerIndication", 12, 80, 200, "int"),
    ("primaryEngineOilTemperatureIndication", 12, 70, 120, "int"),
    ("primaryEngineRelChargingAirPressureIndication", 12, 0.6, 2.2, "float"),
    ("primaryEngineSpeedIndication",         12,  700, 4500, "int"),  # rpm
    ("recommendedGearIndication",            12,  1,   6,   "int"),
    ("recuperationLevelIndication",          12,  0,   5,   "int"),
    ("reverseGearIndication",                12,  0,   1,   "int"),
    ("secondaryEngineBatteryStateOfChargeIndication", 12, 20, 95, "int"),
    ("speed",                                12,  0,   200, "int"),    # km/h
]

# Verify: every name in this list must exist in the real export
with REAL.open() as f:
    real = json.load(f)
real_fields = {r["dataFieldName"] for r in real["Data"]}
sample_names = {s[0] for s in SENSORS}
missing_in_real = sample_names - real_fields
extra_in_sample = sample_names - real_fields
assert not missing_in_real, f"sensors in sample but not in real: {missing_in_real}"
assert len(SENSORS) == 38, f"expected 38 sensors, got {len(SENSORS)}"
# Confirm we cover everything in the real export
assert real_fields == sample_names, (
    f"sample names do not match real names exactly; "
    f"missing from sample: {real_fields - sample_names}; "
    f"extra in sample: {sample_names - real_fields}"
)


def make_value(lo, hi, vtype):
    if vtype == "int":
        return str(random.randint(int(lo), int(hi)))
    if vtype == "float":
        return f"{random.uniform(lo, hi):.1f}"
    if vtype == "bool":
        return str(random.choice([0, 1]))
    if vtype == "enum":
        return str(random.randint(int(lo), int(hi)))
    raise ValueError(vtype)


def make_timestamp(i, total):
    # spread across July-September 2026, mix of formats
    base_day = 1 + (i * 28 // max(total - 1, 1))  # 0..28
    hour = (i * 5) % 24
    minute = (i * 11) % 60
    second = (i * 37) % 60
    if i % 3 == 0:
        return f"2026-0{((i // 3) % 3) + 7}-{base_day + 1:02d} {hour:02d}:{minute:02d}:{second:02d}"
    return f"2026-0{((i // 3) % 3) + 7}-{base_day + 1:02d}T{hour:02d}:{minute:02d}:{second:02d}Z"


data = []
for field, count, lo, hi, vtype in SENSORS:
    # always have at least 2 rows with values, the rest missing
    # pick 2 indices for values: one at start, one at end
    has_value_indices = {0, count - 1} if count > 1 else {0}
    for i in range(count):
        if i in has_value_indices:
            row = {
                "key": f"00000000-0000-4000-8000-{i:012d}",
                "dataFieldName": field,
                "value": make_value(lo, hi, vtype),
                "timestampUtc": make_timestamp(i, count),
            }
        else:
            row = {
                "key": f"00000000-0000-4000-8000-{i:012d}",
                "dataFieldName": field,
                "timestampUtc": make_timestamp(i, count),
            }
        data.append(row)

random.shuffle(data)

doc = {
    "vin": "WVWZZZANON12345",
    "userId": "00000000-0000-0000-0000-000000000000",
    "Data": data,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w") as f:
    json.dump(doc, f, indent=2)

# report
from collections import Counter
fields = Counter(r["dataFieldName"] for r in data)
with_value = sum(1 for r in data if "value" in r)
without_value = len(data) - with_value
print(f"wrote {len(data)} rows across {len(fields)} sensors")
print(f"  rows with value:    {with_value} ({with_value / len(data) * 100:.1f}%)")
print(f"  rows without value: {without_value} ({without_value / len(data) * 100:.1f}%)")
print(f"  sensors with values: {sum(1 for f in fields if any('value' in r for r in [r for r in data if r['dataFieldName'] == f]))} / {len(fields)}")
print(f"  file size: {OUT.stat().st_size} bytes")
