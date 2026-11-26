// flags: --experimental
// SilkJS regression test: the non-ISO calendars come from `silk.time.calendar`, which
// differs from QuickJS in three places. The Indian calendar takes its leap years from the
// Gregorian year a Saka year starts in (QuickJS used a rule of its own, so Saka 1822 had
// 366 days). The Hebrew month code M05L names no month in a year without Adar I (QuickJS
// read it as month 6). The other calendars are spot checked against known dates.
if (typeof print !== 'function') globalThis.print = (...a) => console.log(...a);
let failed = 0;
function same(label, actual, expected) {
  if (actual !== expected) { failed++; print('FAIL ' + label + ': ' + actual + ', expected ' + expected); }
}
function rejects(label, fn) {
  try { fn(); } catch (e) { if (e instanceof RangeError) return; failed++; print('FAIL ' + label + ': ' + e); return; }
  failed++; print('FAIL ' + label + ': no error');
}
function fields(iso, calendar) {
  const d = Temporal.PlainDate.from(iso).withCalendar(calendar);
  return d.year + ' ' + d.monthCode + ' ' + d.day;
}

// Indian: Saka 1822 starts in 1900, which is not a Gregorian leap year.
const saka = Temporal.PlainDate.from({ calendar: 'indian', year: 1822, month: 1, day: 1 });
same('indian 1822 start', saka.toString(), '1900-03-22[u-ca=indian]');
same('indian 1822 days', saka.daysInYear, 365);
same('indian 1822 leap', saka.inLeapYear, false);
same('indian 1922 start', Temporal.PlainDate.from({ calendar: 'indian', year: 1922, month: 1, day: 1 }).toString(), '2000-03-21[u-ca=indian]');
same('indian 2024-03-21', fields('2024-03-21', 'indian'), '1946 M01 1');

// Hebrew: 5784 has Adar I, 5785 does not.
same('hebrew M05L 5784', Temporal.PlainDate.from({ calendar: 'hebrew', year: 5784, monthCode: 'M05L', day: 1 }).month, 6);
rejects('hebrew M05L 5785 reject', () => Temporal.PlainDate.from({ calendar: 'hebrew', year: 5785, monthCode: 'M05L', day: 1 }, { overflow: 'reject' }));
same('hebrew 2024-10-03', fields('2024-10-03', 'hebrew'), '5785 M01 1');
same('hebrew 2024-02-10', fields('2024-02-10', 'hebrew'), '5784 M05L 1');

// Known dates of the other calendars.
same('persian 2024-03-20', fields('2024-03-20', 'persian'), '1403 M01 1');
same('persian 2025-03-21', fields('2025-03-21', 'persian'), '1404 M01 1');
same('chinese 2024-02-10', fields('2024-02-10', 'chinese'), '2024 M01 1');
same('chinese 2023-03-22', fields('2023-03-22', 'chinese'), '2023 M02L 1');
same('dangi 2024-02-10', fields('2024-02-10', 'dangi'), '2024 M01 1');
same('coptic 2024-09-11', fields('2024-09-11', 'coptic'), '1741 M01 1');
same('ethiopic 2024-09-11', fields('2024-09-11', 'ethiopic'), '2017 M01 1');
same('ethioaa 2024-09-11', fields('2024-09-11', 'ethioaa'), '7517 M01 1');
same('islamic-civil 2024-07-08', fields('2024-07-08', 'islamic-civil'), '1446 M01 1');
same('islamic-tbla 2024-07-07', fields('2024-07-07', 'islamic-tbla'), '1446 M01 1');
same('islamic-umalqura 2024-07-07', fields('2024-07-07', 'islamic-umalqura'), '1446 M01 1');
same('buddhist 2024-01-01', fields('2024-01-01', 'buddhist'), '2567 M01 1');
same('roc 2024-01-01', fields('2024-01-01', 'roc'), '113 M01 1');
same('japanese era', Temporal.PlainDate.from('2019-05-01').withCalendar('japanese').era, 'reiwa');

// A month and day with no year picks a reference year that has it.
same('hebrew M05L-30', Temporal.PlainMonthDay.from({ calendar: 'hebrew', monthCode: 'M05L', day: 30 }).toString(), '1970-03-08[u-ca=hebrew]');
same('chinese M01-01', Temporal.PlainMonthDay.from({ calendar: 'chinese', monthCode: 'M01', day: 1 }).toString(), '1972-02-15[u-ca=chinese]');

print(failed ? failed + ' failed' : 'all passed');
if (failed) throw new Error('temporal calendar regressions');
