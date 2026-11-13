import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "import_workbook", Path(__file__).parents[1] / "scripts/import_workbook.py"
)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportTests(unittest.TestCase):
    def cells(self):
        return {
            "A20": "July",
            "A31": "June",
            "AK1": "2026",
            "T13": "348",
            "T14": "14.5",
            "V13": "348",
            "AG13": "58",
            "AG14": "58",
            "H15": "14.5",
            "AH20": "10.879999999999999",
            "AH32": "10.88",
            "AJ32": "0",
            "AL32": "0",
        }

    def test_explicit_year_overrides_stale_header_and_preserves_rounded_totals(self):
        result = module.convert(self.cells(), 2027)
        self.assertEqual(result["fiscalYearStart"], "07-01")
        self.assertEqual(result["records"][0]["days"][0]["date"], "2026-07-31")
        self.assertEqual(result["records"][0]["days"][0]["hours"], 1088)
        self.assertEqual(result["records"][0]["calm"], "historical")
        self.assertEqual(len(result["warnings"]), 2)

    def test_annual_mismatch_is_rejected(self):
        cells = self.cells()
        cells["AH32"] = "99"
        with self.assertRaisesRegex(ValueError, "do not match"):
            module.convert(cells, 2027)

    def test_missing_policy_and_unknown_layout_fail_explicitly(self):
        cells = self.cells()
        del cells["T13"]
        with self.assertRaisesRegex(ValueError, "Missing cached"):
            module.convert(cells, 2027)
        with self.assertRaisesRegex(ValueError, "layout"):
            module.convert({}, 2027)

    def test_nan_and_negative_values_are_rejected(self):
        for value in ("NaN", "Infinity", "-1"):
            with self.assertRaisesRegex(ValueError, "Invalid hours"):
                module.amount({"A1": value}, "A1")

    def test_workbook_reads_cached_formula_and_shared_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fixture.xlsx"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(
                    "xl/sharedStrings.xml",
                    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>July</t></si></sst>',
                )
                archive.writestr(
                    "xl/worksheets/sheet1.xml",
                    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A20" t="s"><v>0</v></c><c r="AH20"><f>7.25+3.63</f><v>10.88</v></c></row></sheetData></worksheet>',
                )
            self.assertEqual(module.read_cells(path), {"A20": "July", "AH20": "10.88"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
