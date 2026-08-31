# Migrating the Excel trackers

One workbook per employee becomes two CSVs and one script run.

## Before you start

Two things to settle with HR, because they are cheaper to decide than to redo:

1. **The pro-rata method.** `app_settings.prorate_method` is either
   `monthly_accrual` (1.5 days per completed month) or `daily_365`
   (18 × days employed ÷ 365). For a 1 June hire both give **10.5**. The old
   workbook produced 10.553424657534247 and had an undocumented rounding rule.
   Show HR both columns and let them pick; the choice is a config row, not a
   code change.
2. **The public holiday list.** Every imported day count is recomputed from the
   dates and `public_holidays`. If the holiday table is wrong, every migrated
   figure that spans a holiday will be wrong too. Load the official Royal
   Government of Cambodia sub-decree list first, via Admin → Public holidays →
   Bulk import.

There is also one thing to *ask* about rather than guess: the source workbook
had an undocumented block at `O14:P24` (Jan 1.5, Aug 1, Sep 1, Oct 2, Nov 3,
Dec 5). It could be planned leave, public holidays, or last year's leftovers.
If it is a plan, it totals 13.5 days against a 10.55-day entitlement — about
three days over-booked. Confirm with HR before migrating anything from it.

## employees.csv

| Column | Required | Notes |
|---|---|---|
| `staff_code` | yes | Unique. Also used to resolve `supervisor_staff_code`. |
| `full_name` | yes | |
| `full_name_kh` | no | Khmer script is fine; save the file as UTF-8. |
| `email` | yes | Must be the person's `@clintonhealthaccess.org` Google address. |
| `position_title` | no | |
| `department` | no | Drives the department charts and the coverage model. |
| `supervisor_staff_code` | no | Must appear as a `staff_code` in the same file. Blank = requests go straight to HR. |
| `hire_date` | yes | `YYYY-MM-DD`. Drives pro-rating. |
| `probation_end_date` | no | |
| `exit_date` | no | Setting this pro-rates the leaving year's tail. |
| `employment_status` | no | `active` (default), `on_probation`, `suspended`, `exited`. |
| `role` | no | `employee` (default), `supervisor`, `hr_admin`, `system_admin`. |
| `gender` | no | `M` or `F`. Used **only** to gate maternity and paternity leave. Leave blank if you would rather not hold it — the gate simply will not apply. |

## leave_taken.csv

Historical leave, so that this year's balances are right on day one.

| Column | Required | Notes |
|---|---|---|
| `staff_code` | yes | Must exist in `employees.csv`. |
| `leave_type_code` | yes | `ANNUAL`, `SICK`, `LEARNING`, `MENTAL_HEALTH`, `SPECIAL_SIB_GP`, `SPECIAL_IMMEDIATE`, `PATERNITY`, `MATERNITY`, `MATERNITY_EXT`, `ADOPT_UNDER6`, `ADOPT_UNDER6_EXT`, `ADOPT_OVER6`, `UNPAID`. |
| `start_date`, `end_date` | yes | `YYYY-MM-DD`. |
| `start_portion`, `end_portion` | no | `full_day` (default), `morning`, `afternoon`. |
| `status` | no | `approved` (default). Use `cancelled` for something recorded then dropped. |
| `reason` | no | |
| `approved_by_staff_code` | no | Recorded as both the supervisor and HR approver, since the original approval was a single email. |
| `approved_on` | no | `YYYY-MM-DD`. |

**`days_requested` is not a column, on purpose.** The database computes it from
the dates, the leave type's unit and the holiday table. That is the whole point
of the migration: the spreadsheet's numbers are the thing being replaced, not
the thing being copied.

## Running it

```bash
export SUPABASE_URL=https://your-project-ref.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=paste-it-here-in-your-shell-only
node scripts/import-legacy.mjs docs/import/employees.csv docs/import/leave_taken.csv --dry-run
```

Read the dry-run output, fix anything it complains about, then run it again
without `--dry-run`.

The script is idempotent: employees are matched on their auth account, leave on
(employee, type, start, end). Running it twice imports nothing twice.

The `service_role` key is needed here and only here — the script writes
`employees` rows and back-dated approved leave, both of which Row Level Security
correctly refuses to ordinary users. Keep the key in your shell. Never commit
it, never put it in `.env`, never ship it to the frontend.

## Afterwards

1. Admin → Entitlements → **Generate entitlements** for the current year.
2. Spot-check five people against their old workbook. Where the numbers differ,
   check the holiday table before assuming the app is wrong.
3. Admin → Audit log. Every imported row is there, attributed to the import.
