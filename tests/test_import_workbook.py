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

    def write_workbook(self, path, extra=None):
        from xml.sax.saxutils import escape

        cells = self.cells() | {
            "AI31": "348",
            "AK31": "116",
            "AM31": "14.5",
            "AI13": "58",
            "B20": "V",
            "L7": "V: Vacation",
        }
        cells.update(extra or {})
        entries = "".join(
            f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
            for ref, value in cells.items()
        )
        with zipfile.ZipFile(path, "w") as z:
            z.writestr(
                "xl/worksheets/sheet1.xml",
                f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>{entries}</row></sheetData></worksheet>',
            )

    def test_archive_preserves_raw_daily_marks_partial_flags_and_reverse_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.write_workbook(folder / "fy2026 attendance (incomplete).xlsx", {"B20": "3.63-V"})
            self.write_workbook(folder / "fy2027 attendance.xlsx", {"B20": "V"})
            result = module.collate_history(folder, 2027)
            self.assertEqual([y["fiscalYear"] for y in result["years"]], [2027, 2026])
            year = result["years"][1]
            self.assertTrue(year["source"]["incomplete"])
            self.assertEqual(
                year["daily"][0], {"date": "2025-07-01", "cell": "B20", "mark": "3.63-V"}
            )
            self.assertEqual(year["reconciliation"]["followingYear"], 2027)
            self.assertEqual(year["reconciliation"]["vacation"]["status"], "matches")
            self.assertEqual(result["anchorFiscalYear"], 2027)

    def test_archive_flags_identical_data_without_dropping_years_or_guessing_hours(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.write_workbook(folder / "fy2026.xlsx")
            self.write_workbook(folder / "fy2027.xlsx")
            result = module.collate_history(folder, 2027)
            self.assertEqual(len(result["years"]), 2)
            self.assertEqual(result["years"][0]["duplicateYears"], [2026])
            self.assertNotIn("hours", result["years"][0]["daily"][0])
            self.assertEqual(len(result["years"][0]["revision"]), 64)

    def test_archive_rejects_duplicate_years_and_retains_marks_in_invalid_day_cells(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.write_workbook(folder / "fy2027.xlsx", {"AE27": "V"})
            result = module.collate_history(folder, 2027)
            self.assertTrue(any(d["cell"] == "AE27" for d in result["years"][0]["unmapped"]))
            self.write_workbook(folder / "fy2027 copy.xlsx")
            with self.assertRaisesRegex(ValueError, "Multiple"):
                module.collate_history(folder, 2027)

    def test_reverse_checks_respect_caps_and_flag_mismatch_without_rewriting_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.write_workbook(folder / "fy2026.xlsx", {"AI31": "400", "AM31": "-1"})
            self.write_workbook(folder / "fy2027.xlsx")
            first = module.collate_history(folder, 2027)
            self.assertEqual(first, module.collate_history(folder, 2027))
            prior = first["years"][1]
            self.assertEqual(prior["reconciliation"]["vacation"]["status"], "matches")
            self.assertEqual(prior["reconciliation"]["vacation"]["backwardConstraint"], "at-least")
            self.assertEqual(prior["balances"]["vacation"], 40000)
            self.assertEqual(prior["balances"]["personal"], -100)
            self.write_workbook(folder / "fy2026.xlsx", {"AI31": "100"})
            changed = module.collate_history(folder, 2027)
            self.assertEqual(
                changed["years"][1]["reconciliation"]["vacation"]["status"], "mismatch"
            )
            self.assertEqual(changed["years"][0]["totals"], first["years"][0]["totals"])
            self.assertNotEqual(changed["years"][1]["revision"], prior["revision"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
