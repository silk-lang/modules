// The Metal Performance HUD on a window's CAMetalLayer (macOS 13 and later): the frame rate,
// frame times and GPU time Metal measures for what the layer actually presents.

#import <QuartzCore/QuartzCore.h>
#import <Foundation/Foundation.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static int32_t hud_default = 0;

// Metal loads the HUD only when MTL_HUD_ENABLED is set as it starts: `developerHUDProperties`
// on a layer neither loads it later nor hides it once the variable is set (macOS 27). So the
// switches set the variable before the first Metal device exists.
static void enable_before_metal(void) { setenv("MTL_HUD_ENABLED", "1", 1); }

__attribute__((constructor)) static void silk_ui_metal_hud_from_environment(void) {
    const char *asked = getenv("SILK_UI_METAL_HUD");
    if (asked && *asked && strcmp(asked, "0") != 0) enable_before_metal();
}

void silk_ui_metal_hud_default(int32_t on) {
    hud_default = on;
    if (on) enable_before_metal();
}

int32_t silk_ui_metal_hud_default_on(void) { return hud_default; }

void silk_ui_metal_hud(void *layer, int32_t on) {
    if (!layer) return;
    CALayer *object = (__bridge CALayer *)layer;
    if (![object isKindOfClass:[CAMetalLayer class]]) return;
    CAMetalLayer *metal = (CAMetalLayer *)object;
    if (@available(macOS 13.0, *)) {
        NSDictionary *properties = on ? @{ @"mode" : @"default" } : nil;
        // Layer properties belong to the main thread, which runs AppKit.
        dispatch_async(dispatch_get_main_queue(), ^{ metal.developerHUDProperties = properties; });
    }
}
