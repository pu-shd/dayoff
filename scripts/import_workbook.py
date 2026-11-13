"""Read the administrative attendance template without changing the source file."""

from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import re
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


def convert(cells: dict[str, str], year: int, hr_system_name: str = "HR accounting system") -> dict:
    if (
        not hr_system_name.strip()
        or len(hr_system_name) > 80
        or any(c in hr_system_name for c in "\r\n<>")
    ):
        raise ValueError("Invalid HR system display name.")
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
        f"Imported monthly totals use month-end dates; daily hours and {hr_system_name} status cannot be inferred. Check existing future bookings before creating new requests."
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


def cached_balance(cells: dict[str, str], address: str) -> int | None:
    raw = cells.get(address, "")
    if not raw:
        return None
    number = Decimal(raw)
    if not number.is_finite():
        raise ValueError(f"Invalid balance in {address}.")
    return int((number * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def collate_history(
    folder: Path, anchor_fy: int, hr_system_name: str = "HR accounting system"
) -> dict:
    """Preserve source facts; work backwards without solving through carry caps."""
    sources: dict[int, Path] = {}
    for path in sorted(folder.glob("*.xlsx")):
        match = re.match(r"fy(\d{4})\b", path.stem, re.IGNORECASE)
        if not match:
            raise ValueError("Unsupported workbook filename: expected FY followed by a year.")
        year = int(match[1])
        if year in sources:
            raise ValueError("Multiple workbooks for the same fiscal year; choose one source.")
        sources[year] = path
    if not sources or max(sources) != anchor_fy:
        raise ValueError("The anchor must be the most recent source fiscal year.")
    years: list[dict] = []
    fingerprints: dict[str, list[int]] = {}
    for year, path in sorted(sources.items(), reverse=True):
        cells = read_cells(path)
        converted = convert(cells, year, hr_system_name)
        months, daily, unmapped = [], [], []
        raw_grid = []
        for index in range(12):
            month = (6 + index) % 12 + 1
            actual_year = year - 1 + (6 + index) // 12
            prefix = f"{actual_year:04d}-{month:02d}"
            row = index + 20
            months.append(
                {
                    "month": prefix,
                    **{
                        category: amount(cells, f"{col}{row}")
                        for col, category in (
                            ("AH", "vacation"),
                            ("AJ", "sick"),
                            ("AL", "personal"),
                        )
                    },
                    "balances": {
                        category: cached_balance(cells, f"{col}{row}")
                        for col, category in (
                            ("AI", "vacation"),
                            ("AK", "sick"),
                            ("AM", "personal"),
                        )
                    },
                }
            )
            for day in range(1, 32):
                column_number = day + 1
                col = (
                    chr(64 + column_number)
                    if column_number <= 26
                    else "A" + chr(64 + column_number - 26)
                )
                cell = f"{col}{row}"
                mark = cells.get(cell, "")
                if not mark.strip():
                    continue
                raw_grid.append([cell, mark])
                entry = {"cell": cell, "mark": mark}
                if day <= calendar.monthrange(actual_year, month)[1]:
                    daily.append({"date": f"{prefix}-{day:02d}", **entry})
                else:
                    unmapped.append(entry)
        fingerprint = digest(
            [
                raw_grid,
                [{k: v for k, v in m.items() if k not in ("month", "balances")} for m in months],
            ]
        )
        fingerprints.setdefault(fingerprint, []).append(year)
        incomplete = "incomplete" in path.stem.lower()
        warnings = converted["warnings"]
        if incomplete:
            warnings.append("Source filename marks this year incomplete.")
        if unmapped:
            warnings.append(
                "Some daily markings occupy invalid calendar dates; retained as unmapped cells."
            )
        years.append(
            {
                "fiscalYear": year,
                "fiscalYearStart": "07-01",
                "source": {
                    "name": path.name,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "incomplete": incomplete,
                    "headerYear": cells.get("AK1", ""),
                },
                "policy": converted["policy"],
                "carryCaps": {
                    "vacation": converted["policy"]["vacationCap"],
                    "sick": cached_balance(cells, "AI13"),
                },
                "months": months,
                "daily": daily,
                "unmapped": unmapped,
                "legend": [
                    {"cell": key, "mark": value}
                    for key, value in cells.items()
                    if re.match(r"^[A-Z]+(?:7|8|9|10)$", key) and re.match(r"^[A-Z]+\s*:", value)
                ],
                "totals": {
                    category: amount(cells, f"{col}32", True)
                    for col, category in (("AH", "vacation"), ("AJ", "sick"), ("AL", "personal"))
                },
                "balances": months[-1]["balances"],
                "duplicateYears": [],
                "warnings": warnings,
                "reconciliation": {},
            }
        )
    for repeated in fingerprints.values():
        if len(repeated) > 1:
            for item in years:
                if item["fiscalYear"] in repeated:
                    item["duplicateYears"] = [y for y in repeated if y != item["fiscalYear"]]
                    item["warnings"].append(
                        "Daily markings and monthly usage repeat another source year exactly. Retained as supplied; review before treating as verified history."
                    )
    for index, item in enumerate(years):
        following = (
            years[index - 1]
            if index and years[index - 1]["fiscalYear"] == item["fiscalYear"] + 1
            else None
        )
        if following:
            reconciliation: dict = {"followingYear": following["fiscalYear"]}
            for category, opening_key in (("vacation", "openingVacation"), ("sick", "openingSick")):
                closing = item["balances"][category]
                cap = following["carryCaps"][category]
                opening = following["policy"][opening_key]
                expected = min(closing, cap) if closing is not None and cap is not None else None
                reconciliation[category] = {
                    "status": "unavailable"
                    if expected is None
                    else "matches"
                    if expected == opening
                    else "mismatch",
                    "sourceClosing": closing,
                    "nextOpening": opening,
                    "carryCap": cap,
                    "backwardConstraint": "at-least"
                    if cap is not None and opening == cap
                    else "exact"
                    if cap is not None and opening < cap
                    else "unavailable",
                }
            item["reconciliation"] = reconciliation
            if any(reconciliation[c]["status"] == "mismatch" for c in ("vacation", "sick")):
                item["warnings"].append(
                    "Source closing balance does not reconcile to the following year's opening after its carry cap. FY anchor retained; historical source not rewritten."
                )
        item["revision"] = digest(item)
        if len(json.dumps(item)) > 48_000:
            raise ValueError("A source year exceeds the supported private sheet cell size.")
    return {"schemaVersion": 1, "anchorFiscalYear": anchor_fy, "years": years}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, nargs="?")
    parser.add_argument("--source-directory", type=Path)
    parser.add_argument("--anchor-fy", type=int)
    parser.add_argument("--hr-system-name", default="HR accounting system")
    parser.add_argument(
        "--fy",
        type=int,
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
    if args.source_directory:
        if args.workbook or args.fy or not args.anchor_fy:
            parser.error("Use --source-directory with --anchor-fy, without workbook or --fy.")
        result = collate_history(args.source_directory, args.anchor_fy, args.hr_system_name)
    else:
        if not args.workbook or not args.fy or args.anchor_fy:
            parser.error("Use a workbook and --fy, or --source-directory and --anchor-fy.")
        result = convert(read_cells(args.workbook), args.fy, args.hr_system_name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2) + "\n")
    target.chmod(0o600)
    if args.source_directory:
        print(
            f"Collated {len(result['years'])} fiscal years backwards from FY{args.anchor_fy}; sources unchanged. Private output written."
        )
    else:
        print(
            f"Imported {len(result['records'])} monthly summaries for FY{args.fy}; source workbook unchanged."
        )


if __name__ == "__main__":
    main()
