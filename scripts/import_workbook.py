"""Read the administrative attendance template without changing the source file."""

from __future__ import annotations

import argparse
import calendar
import json
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_cells(path: Path) -> dict[str, str]:
    with zipfile.ZipFile(path) as archive:
        for name in ("xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"):
            if name in archive.namelist() and archive.getinfo(name).file_size > 5_000_000:
                raise ValueError("Workbook XML exceeds the supported size.")
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = [
                "".join(t.text or "" for t in item.findall(".//m:t", NS))
                for item in root.findall("m:si", NS)
            ]
        root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        cells = {}
        for cell in root.findall(".//m:c", NS):
            value = cell.find("m:v", NS)
            raw = value.text or "" if value is not None else ""
            if cell.attrib.get("t") == "s" and raw:
                raw = shared[int(raw)]
            elif cell.attrib.get("t") == "inlineStr":
                raw = "".join(t.text or "" for t in cell.findall(".//m:t", NS))
            cells[cell.attrib["r"]] = raw
        return cells


def amount(cells: dict[str, str], address: str, required: bool = False) -> int:
    raw = cells.get(address, "")
    if not raw:
        if required:
            raise ValueError(
                f"Missing cached value in {address}. Recalculate and save the workbook first."
            )
        return 0
    number = Decimal(raw)
    if not number.is_finite() or number < 0:
        raise ValueError(f"Invalid hours in {address}.")
    return int((number * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def convert(cells: dict[str, str], year: int) -> dict:
    if not 2000 <= year <= 2200:
        raise ValueError("Invalid fiscal year.")
    if not cells.get("A20", "").lower().startswith("jul") or not cells.get(
        "A31", ""
    ).lower().startswith("jun"):
        raise ValueError("Unsupported workbook layout: expected July–June in rows 20–31.")
    policy = {
        "openingVacation": amount(cells, "T13", True),
        "vacationMonthly": amount(cells, "T14", True),
        "vacationCap": amount(cells, "V13", True),
        "openingSick": amount(cells, "AG13", True),
        "sickGrant": amount(cells, "AG14", True),
        "personalGrant": amount(cells, "H15", True),
    }
    records: list[dict] = []
    warnings = [
        "Imported monthly totals use month-end dates; daily hours and CALM status cannot be inferred. Check existing future bookings before creating new requests."
    ]
    header = cells.get("AK1", "")
    if header != str(year):
        warnings.append(
            "The internal year label differs from the explicitly selected fiscal year; the selected year was used."
        )
    for index in range(12):
        month = (6 + index) % 12 + 1
        actual_year = year - 1 + (6 + index) // 12
        date = f"{actual_year:04d}-{month:02d}-{calendar.monthrange(actual_year, month)[1]:02d}"
        for column, category in (("AH", "vacation"), ("AJ", "sick"), ("AL", "personal")):
            hours = amount(cells, f"{column}{20 + index}")
            if not hours:
                continue
            request_id = f"legacy-{year}-{month:02d}-{category}"
            records.append(
                {
                    "id": request_id,
                    "version": 1,
                    "input": {
                        "id": request_id,
                        "category": category,
                        "mode": "full",
                        "first": date,
                        "last": date,
                    },
                    "days": [
                        {"date": date, "hours": hours, "allDay": True, "start": "", "end": ""}
                    ],
                    "status": "active",
                    "calm": "historical",
                    "calendar": "disabled",
                    "email": "disabled",
                    "created": "historical-import",
                    "updated": "historical-import",
                    "legacy": True,
                }
            )
    for column, category in (("AH", "vacation"), ("AJ", "sick"), ("AL", "personal")):
        actual = sum(r["days"][0]["hours"] for r in records if r["input"]["category"] == category)
        if actual != amount(cells, f"{column}32", True):
            raise ValueError(
                f"The {category} monthly totals do not match the cached annual total. Recalculate the workbook."
            )
    return {
        "fiscalYear": year,
        "fiscalYearStart": "07-01",
        "policy": policy,
        "records": records,
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument(
        "--fy",
        type=int,
        required=True,
        help="Authoritative fiscal year, regardless of stale header",
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Private output; must be inside local/"
    )
    args = parser.parse_args()
    target = args.output.resolve()
    private = Path("local").resolve()
    if private not in target.parents:
        raise ValueError("Output must be inside the gitignored local/ directory.")
    result = convert(read_cells(args.workbook), args.fy)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2) + "\n")
    target.chmod(0o600)
    print(
        f"Imported {len(result['records'])} monthly summaries for FY{args.fy}; source workbook unchanged."
    )


if __name__ == "__main__":
    main()
