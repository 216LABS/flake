# Payroll exports (issue 170)

Reports > Payroll builds each employee's hours for a pay period and downloads them for Gusto or ADP. Subcontractors are never in these files; they are paid from Sub pay.

The exact bytes of each file are pinned by fixtures in `packages/core/test/fixtures/payroll-gusto.csv` and `payroll-adp.csv`. A format change is a deliberate fixture update.

## How hours are split

- Shifts come from the drivers' phones, as Crew hours does: first to last tap, split on a two-hour quiet gap. A shift counts in the period and workweek it started in.
- Overtime is every hour past 40 in a workweek. The workweek starts at local midnight on the company's day, Sunday by default. A workweek that straddles the pay period counts all its hours toward the 40.
- Up to 40: a shift starting on a listed holiday is holiday hours; otherwise storm hours when the employee has a storm rate, else regular hours.
- Overtime pays the overtime rate, or 1.5 times regular when none is set.

## Gusto (Run payroll > upload a CSV)

| Column | From |
|---|---|
| Employee ID | crew member's payroll id (blank if none; Gusto matches by name) |
| First Name, Last Name | crew member's name, last word as the last name |
| Regular Hours | regular + storm hours (Gusto has no storm column; add a custom earning in Gusto if you pay storm hours differently) |
| Overtime Hours | overtime hours |
| Holiday Hours | holiday hours |

Gusto matches columns by name and asks to confirm. If an import fails, download Gusto's own template from the upload screen and compare headers.

## ADP Workforce Now (Process > Import paydata, EPI file)

| Column | From |
|---|---|
| Co Code | ADP company code (Payroll settings) |
| Batch ID | the period's last day as YYMMDD |
| File # | crew member's payroll id (ADP file number) |
| Employee Name | crew member's name |
| Reg Hours | regular hours |
| O/T Hours | overtime hours |
| Hours 3 Code / Amount | `STM` and storm hours |
| Hours 4 Code / Amount | `HOL` and holiday hours |

ADP expects the file named `EPI` + company code + two digits (for example `EPIAB101.csv`); rename the download before importing. Delete columns your ADP setup doesn't use if the import complains, and change `STM`/`HOL` to your earning codes.

Sources for the layouts: Gusto's CSV upload help, and ADP WFN export guides from 7shifts and Worksana (third-party; confirm against your own ADP template).
