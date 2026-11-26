/* Independent oracle: compile against the unmodified pinned QuickJS sources.
 * Emits executable Silk assertions whose expected values come only from C.
 * It covers zone names, aliases and equality. The rules of each zone come from
 * `silk.time`, which has its own tests against the IANA database. */
#include <stdio.h>
#include <stdint.h>
#include <inttypes.h>
#include <ctype.h>
#include <string.h>
#include "temporal/timezone.h"

static void name(const char *s) {
    printf("  assert(tz.ti_tz_find_id(b\"%s\") == %d)\n", s, ti_tz_find_id(s));
    printf("  assert(tz.ti_tz_can_be_named(b\"%s\") == %s)\n", s, ti_tz_can_be_named(s) ? "true" : "false");
    printf("  assert(bytesEqual(tz.ti_canonicalize_timezone_alias(b\"%s\"), b\"%s\"))\n", s, ti_canonicalize_timezone_alias(s));
}
int main(void) {
    puts("import temporal_timezone as tz\nfn assert(ok: bool) -> () { if !ok { Intrinsic.trap(\"Timezone C contrast failed\") } }\nfn bytesEqual(a: &[u8], b: &[u8]) -> bool {\n  if a.length != b.length { return false }\n  let mut i: usize = 0\n  while i < a.length { if a[i] != b[i] { return false } i = i + 1 }\n  return true\n}\nfn names() -> () {");
    for (int i = 0; i < ti_tz_name_count; ++i) {
        name(ti_tz_names[i]);
        char lower[256];
        size_t n = strlen(ti_tz_names[i]);
        if (n >= sizeof(lower)) return 2;
        for (size_t j = 0; j <= n; ++j) lower[j] = (char)tolower((unsigned char)ti_tz_names[i][j]);
        name(lower);
    }
    const char *extra[] = {"", "Unknown/Zone", "UTC", "utc", "Asia/Calcutta", "asia/calcutta", "Asia/Kolkata", "US/Eastern", "America/New_York", "Europe/Belfast", "+01:00", "GMT", "Etc/UTC"};
    for (size_t i = 0; i < sizeof(extra)/sizeof(extra[0]); ++i) {
        name(extra[i]);
        for (size_t j = 0; j < sizeof(extra)/sizeof(extra[0]); ++j)
            printf("  assert(tz.ti_timezones_are_equal(b\"%s\", b\"%s\") == %s)\n", extra[i], extra[j], ti_timezones_are_equal(extra[i], extra[j]) ? "true" : "false");
    }
    puts("}\npub fn main() -> i32 { names() return 0 }");
    return 0;
}
