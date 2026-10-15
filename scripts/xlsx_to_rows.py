# Dev helper: dump an MT5 xlsx report to a JSON array of rows (used to build test fixtures).
import sys, json, openpyxl
ws = openpyxl.load_workbook(sys.argv[1], data_only=True).active
json.dump([list(r) for r in ws.iter_rows(values_only=True)], open(sys.argv[2], "w"))
