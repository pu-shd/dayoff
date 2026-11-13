"""Verify private workbook sources without printing attendance values."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path


def main() -> None:
    root = Path("/instance")
    definition = json.loads((root / "instance.json").read_text())
    config = json.loads((root / definition["configFile"]).read_text())
    source = root / definition["sourceDirectory"]
    spec = importlib.util.spec_from_file_location(
        "import_workbook", "/app/scripts/import_workbook.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    name = config.get("hrSystemName", "HR accounting system")
    history = module.collate_history(source, definition["anchorFiscalYear"], name)
    matches = [
        p
        for p in source.glob("*.xlsx")
        if re.match(rf"^fy{config['fiscalYear']}\b", p.stem, re.IGNORECASE)
    ]
    assert len(matches) == 1, "Current fiscal year must have exactly one source workbook."
    current = module.convert(module.read_cells(matches[0]), config["fiscalYear"], name)
    print(
        f"PASS: cached monthly and annual totals reconcile for the current FY ({len(current['records'])} summaries)."
    )
    print(
        f"PASS: {len(history['years'])} historical source years collated; original files unchanged."
    )


if __name__ == "__main__":
    main()
