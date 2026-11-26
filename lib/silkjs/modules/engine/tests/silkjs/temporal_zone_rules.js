// flags: --experimental
// SilkJS regression test: the rules of every time zone come from the time zone database of
// `silk.time`. SilkJS used to carry its own tables, which stopped at 2037: after that year a
// zone kept its last offset, so New York had no daylight saving time in 2050.
if (typeof print !== 'function') globalThis.print = (...a) => console.log(...a);
let failed = 0;
function same(label, actual, expected) {
  if (actual !== expected) { failed++; print('FAIL ' + label + ': ' + actual + ', expected ' + expected); }
}
function rejects(label, fn) {
  try { fn(); } catch (e) { if (e instanceof RangeError) return; failed++; print('FAIL ' + label + ': ' + e); return; }
  failed++; print('FAIL ' + label + ': no error');
}
const zoned = (text, options) => Temporal.ZonedDateTime.from(text, options);
const offsetAt = (instant, zone) => Temporal.Instant.from(instant).toZonedDateTimeISO(zone).offset;

// Offsets, in the past and now.
same('new york winter', offsetAt('2024-01-15T12:00Z', 'America/New_York'), '-05:00');
same('new york summer', offsetAt('2024-07-15T12:00Z', 'America/New_York'), '-04:00');
same('sao paulo', offsetAt('2026-11-19T17:36:22Z', 'America/Sao_Paulo'), '-03:00');
same('kolkata', offsetAt('2024-07-15T12:00Z', 'Asia/Kolkata'), '+05:30');
same('lord howe', offsetAt('2024-01-15T12:00Z', 'Australia/Lord_Howe'), '+11:00');
same('kathmandu 1938', offsetAt('1938-04-24T22:13:20Z', 'Asia/Kathmandu'), '+05:30');
same('alias', offsetAt('2024-07-15T12:00Z', 'US/Eastern'), '-04:00');
// IANA 2026f: Cuba does not fall back on 2026-11-01.
same('havana 2026', offsetAt('2026-11-19T17:36:22Z', 'America/Havana'), '-04:00');

// After 2037 the rule of the zone goes on.
same('new york 2050 summer', offsetAt('2050-07-01T12:00Z', 'America/New_York'), '-04:00');
same('new york 2050 winter', offsetAt('2050-01-01T12:00Z', 'America/New_York'), '-05:00');
same('rome 2100 summer', offsetAt('2100-06-21T00:00Z', 'Europe/Rome'), '+02:00');
same('next transition 2060', zoned('2060-01-01T00:00[America/New_York]').getTimeZoneTransition('next').toString(), '2060-03-14T03:00:00-04:00[America/New_York]');

// A time that the clocks skip, and one that happens twice.
same('gap compatible', zoned('2024-03-10T02:30[America/New_York]').toString(), '2024-03-10T03:30:00-04:00[America/New_York]');
same('gap earlier', zoned('2024-03-10T02:30[America/New_York]', { disambiguation: 'earlier' }).toString(), '2024-03-10T01:30:00-05:00[America/New_York]');
same('gap later', zoned('2024-03-10T02:30[America/New_York]', { disambiguation: 'later' }).toString(), '2024-03-10T03:30:00-04:00[America/New_York]');
rejects('gap reject', () => zoned('2024-03-10T02:30[America/New_York]', { disambiguation: 'reject' }));
same('overlap compatible', zoned('2024-11-03T01:30[America/New_York]').toString(), '2024-11-03T01:30:00-04:00[America/New_York]');
same('overlap later', zoned('2024-11-03T01:30[America/New_York]', { disambiguation: 'later' }).toString(), '2024-11-03T01:30:00-05:00[America/New_York]');
rejects('overlap reject', () => zoned('2024-11-03T01:30[America/New_York]', { disambiguation: 'reject' }));

// Transitions.
const ny = zoned('2024-06-01T00:00[America/New_York]');
same('next transition', ny.getTimeZoneTransition('next').toString(), '2024-11-03T01:00:00-05:00[America/New_York]');
same('previous transition', ny.getTimeZoneTransition('previous').toString(), '2024-03-10T03:00:00-04:00[America/New_York]');
same('no transition', zoned('2024-06-01T00:00[Asia/Kolkata]').getTimeZoneTransition('next'), null);

// A day that starts at 01:00, and days of 23 and 25 hours.
same('start of day', zoned('2018-11-04T12:00[America/Sao_Paulo]').startOfDay().toString(), '2018-11-04T01:00:00-02:00[America/Sao_Paulo]');
same('hours in day spring', zoned('2024-03-10T12:00[America/New_York]').hoursInDay, 23);
same('hours in day autumn', zoned('2024-11-03T12:00[America/New_York]').hoursInDay, 25);
same('plain date', Temporal.PlainDate.from('2018-11-04').toZonedDateTime('America/Sao_Paulo').toString(), '2018-11-04T01:00:00-02:00[America/Sao_Paulo]');

// The time zone database flags the winter of Ireland as daylight saving time; its summer has
// the daylight name all the same.
const name = (instant, zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' })
  .formatToParts(new Date(instant)).find((part) => part.type === 'timeZoneName').value;
same('dublin summer name', name('2024-07-15T12:00Z', 'Europe/Dublin'), 'Irish Standard Time');
same('dublin winter name', name('2024-01-15T12:00Z', 'Europe/Dublin'), 'Greenwich Mean Time');
same('new york summer name', name('2024-07-15T12:00Z', 'America/New_York'), 'Eastern Daylight Time');
same('new york 2050 name', name('2050-07-15T12:00Z', 'America/New_York'), 'Eastern Daylight Time');

print(failed ? failed + ' failed' : 'all passed');
if (failed) throw new Error('temporal zone rule regressions');
