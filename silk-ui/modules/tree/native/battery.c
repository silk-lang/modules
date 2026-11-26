// The internal battery from IOKit's power sources, for `battery.silk` on macOS.
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/ps/IOPowerSources.h>
#include <IOKit/ps/IOPSKeys.h>
#include <stdint.h>

static int number(CFDictionaryRef source, CFStringRef key, double *out) {
    CFNumberRef value = CFDictionaryGetValue(source, key);
    if (!value || CFGetTypeID(value) != CFNumberGetTypeID()) return 0;
    return CFNumberGetValue(value, kCFNumberDoubleType, out) ? 1 : 0;
}

static int flag(CFDictionaryRef source, CFStringRef key) {
    CFBooleanRef value = CFDictionaryGetValue(source, key);
    return value && CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(value);
}

// out: charging (0 or 1), level (0 to 1), seconds to full, seconds to empty (-1 when unknown).
int32_t silk_ui_battery(double *out) {
    CFTypeRef info = IOPSCopyPowerSourcesInfo();
    if (!info) return 0;
    CFArrayRef list = IOPSCopyPowerSourcesList(info);
    int32_t found = 0;
    for (CFIndex at = 0; list && at < CFArrayGetCount(list) && !found; at++) {
        CFDictionaryRef source = IOPSGetPowerSourceDescription(info, CFArrayGetValueAtIndex(list, at));
        if (!source) continue;
        CFStringRef type = CFDictionaryGetValue(source, CFSTR(kIOPSTypeKey));
        if (!type || CFStringCompare(type, CFSTR(kIOPSInternalBatteryType), 0) != kCFCompareEqualTo) continue;
        double current = 0, maximum = 0, toFull = -1, toEmpty = -1;
        if (!number(source, CFSTR(kIOPSCurrentCapacityKey), &current) || !number(source, CFSTR(kIOPSMaxCapacityKey), &maximum) || maximum <= 0) continue;
        CFStringRef state = CFDictionaryGetValue(source, CFSTR(kIOPSPowerSourceStateKey));
        int external = state && CFStringCompare(state, CFSTR(kIOPSACPowerValue), 0) == kCFCompareEqualTo;
        number(source, CFSTR(kIOPSTimeToFullChargeKey), &toFull);
        number(source, CFSTR(kIOPSTimeToEmptyKey), &toEmpty);
        out[0] = external || flag(source, CFSTR(kIOPSIsChargingKey)) ? 1 : 0;
        out[1] = current / maximum;
        // IOKit gives minutes, and -1 while it is still estimating.
        out[2] = toFull < 0 ? -1 : toFull * 60;
        out[3] = toEmpty < 0 ? -1 : toEmpty * 60;
        found = 1;
    }
    if (list) CFRelease(list);
    CFRelease(info);
    return found;
}
