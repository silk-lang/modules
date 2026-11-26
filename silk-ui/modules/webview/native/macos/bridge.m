// The WKWebView backend of ui-webview (C ABI in ../bridge.h).
//
// Each view is a WKWebView inside a clip view, both children of platform-window's content view
// (a flipped SilkView whose layer is the window's CAMetalLayer), so the page draws over the Silk
// UI at its hosted node. `place` moves the clip view to the node's visible part and the web view
// to the node's bounds inside it.
//
// WebKit reports through delegates and key-value observing on the main thread, inside AppKit's
// loop. Each report queues an event here and calls silk_macos_wake, so platform-window's
// nextEvent returns and the app drains the queue with takeEvents.
//
// Agent control evaluates agent.silk's calls in a content world of its own (pages cannot see or
// change the agent script), then clicks and types with synthesized NSEvents sent to the web view,
// the way WebKit's own test runner drives it, so pages see trusted input.
#import <Cocoa/Cocoa.h>
#import <CommonCrypto/CommonDigest.h>
#import <QuartzCore/QuartzCore.h>
#import <WebKit/WebKit.h>
#include <objc/message.h>
#include <pthread.h>
#include <string.h>
#include "../bridge.h"

// platform-window's AppKit bridge (lib-native modules/platform/window/native/macos/bridge.h).
void silk_macos_wake(void);
void *silk_macos_metal_layer(uint32_t window);

// The window's content view (a flipped SilkView): the delegate of the layer that backs it.
static NSView *content_view(uint32_t window) {
    CALayer *layer = (__bridge CALayer *)silk_macos_metal_layer(window);
    id delegate = layer.delegate;
    return [delegate isKindOfClass:[NSView class]] ? (NSView *)delegate : nil;
}

@class SilkWebViewRecord;

@interface SilkWebViewQueued : NSObject {
@public
    SilkWebViewEvent event;
}
@property(nonatomic, strong) NSArray<NSData *> *texts;
@end

@implementation SilkWebViewQueued
@end

static NSMutableArray<SilkWebViewQueued *> *queue;
static NSArray<NSData *> *currentTexts;
static NSMutableDictionary<NSNumber *, SilkWebViewRecord *> *views;
static WKContentWorld *agentWorld;

static NSData *utf8(NSString *string) {
    NSData *data = [string dataUsingEncoding:NSUTF8StringEncoding];
    return data ? data : [NSData data];
}

static NSString *string_from(const uint8_t *bytes, size_t length) {
    if (!bytes || length == 0) return @"";
    NSString *string = [[NSString alloc] initWithBytes:bytes length:length
                                              encoding:NSUTF8StringEncoding];
    return string ? string : @"";
}

static SilkWebViewEvent blank(uint32_t kind, uint32_t view) {
    SilkWebViewEvent event;
    memset(&event, 0, sizeof event);
    event.kind = kind;
    event.view = view;
    return event;
}

static void push_texts(SilkWebViewEvent event, NSArray<NSData *> *texts) {
    if (!queue) queue = [NSMutableArray array];
    SilkWebViewQueued *queued = [SilkWebViewQueued new];
    queued->event = event;
    queued->event.count = (uint32_t)texts.count;
    queued.texts = texts;
    [queue addObject:queued];
    // Woken from the main queue rather than here: this runs inside WebKit's callbacks, and the
    // wake may switch to Silk, which must not close a view while its delegate is on the stack.
    static BOOL wakePending;
    if (wakePending) return;
    wakePending = YES;
    dispatch_async(dispatch_get_main_queue(), ^{
      wakePending = NO;
      silk_macos_wake();
    });
}

static void push(SilkWebViewEvent event) { push_texts(event, @[]); }

static void push_text(uint32_t kind, uint32_t view, NSString *text) {
    push_texts(blank(kind, view), @[ utf8(text ? text : @"") ]);
}

static void push_answer(uint32_t kind, uint32_t view, uint32_t request, BOOL ok, NSString *text) {
    SilkWebViewEvent event = blank(kind, view);
    event.request = request;
    if (ok) event.flags |= SILK_WEBVIEW_FLAG_OK;
    push_texts(event, @[ utf8(text ? text : @"") ]);
}

static NSString *error_text(NSError *error) {
    if (!error) return @"";
    NSString *message = error.userInfo[@"WKJavaScriptExceptionMessage"];
    return message.length ? message : error.localizedDescription;
}

// The Chromium net error (net/base/net_error_list.h) closest to a failed load, as Electron
// reports it: 0 when it loaded, -2 (FAILED) when nothing closer matches.
static int32_t net_error(NSError *error) {
    if (!error) return 0;
    if ([error.domain isEqualToString:NSURLErrorDomain]) {
        switch (error.code) {
        case NSURLErrorCancelled: return -3;
        case NSURLErrorTimedOut: return -7;
        case NSURLErrorBadURL:
        case NSURLErrorUnsupportedURL: return -300;
        case NSURLErrorCannotFindHost:
        case NSURLErrorDNSLookupFailed: return -105;
        case NSURLErrorCannotConnectToHost: return -102;
        case NSURLErrorNetworkConnectionLost: return -101;
        case NSURLErrorNotConnectedToInternet: return -106;
        case NSURLErrorBadServerResponse: return -320;
        case NSURLErrorHTTPTooManyRedirects: return -310;
        case NSURLErrorFileDoesNotExist: return -6;
        case NSURLErrorSecureConnectionFailed: return -107;
        case NSURLErrorServerCertificateHasBadDate: return -201;
        case NSURLErrorServerCertificateUntrusted:
        case NSURLErrorServerCertificateHasUnknownRoot: return -202;
        case NSURLErrorServerCertificateNotYetValid: return -201;
        default: return -2;
        }
    }
    // WebKit's "frame load interrupted": a new load replaced this one.
    if ([error.domain isEqualToString:@"WebKitErrorDomain"] && error.code == 102) return -3;
    return -2;
}

// ---------------------------------------------------------------------------------------
// Views.

@interface SilkWKWebView : WKWebView
@property(nonatomic) uint32_t viewId;
@property(nonatomic) BOOL focused;
@end

@interface SilkWebClipView : NSView
@end

@interface SilkConsoleHandler : NSObject <WKScriptMessageHandler>
@property(nonatomic) uint32_t viewId;
@end

@interface SilkWebViewRecord : NSObject <WKNavigationDelegate, WKUIDelegate>
@property(nonatomic) uint32_t viewId;
@property(nonatomic) BOOL askBeforeNavigating;
@property(nonatomic) BOOL skipNextAsk;
@property(nonatomic) uint32_t nextRequest;
@property(nonatomic, strong) SilkWKWebView *webView;
@property(nonatomic, strong) SilkWebClipView *clipView;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, void (^)(WKNavigationActionPolicy)> *decisions;
@property(nonatomic) BOOL canGoBack;
@property(nonatomic) BOOL canGoForward;
@property(nonatomic, copy) NSString *favicon;
@property(nonatomic, copy) NSString *findText;
@property(nonatomic) uint32_t findActive;
@property(nonatomic, copy) NSString *profile;
@end

static SilkWebViewRecord *find_view(uint32_t view) { return views[@(view)]; }

static void set_focused(SilkWKWebView *webView, BOOL focused) {
    if (webView.focused == focused) return;
    webView.focused = focused;
    SilkWebViewEvent event = blank(SILK_WEBVIEW_FOCUS_CHANGED, webView.viewId);
    if (focused) event.flags |= SILK_WEBVIEW_FLAG_OK;
    push(event);
}

@implementation SilkWKWebView
// The page takes keyboard focus when AppKit makes the web view first responder (a click into
// it, or Command.Focus) and gives it up when another view takes it (a click on the Silk UI).
- (BOOL)becomeFirstResponder {
    BOOL became = [super becomeFirstResponder];
    if (became) set_focused(self, YES);
    return became;
}

- (BOOL)resignFirstResponder {
    BOOL resigned = [super resignFirstResponder];
    if (resigned) set_focused(self, NO);
    return resigned;
}
@end

@implementation SilkWebClipView
- (BOOL)isFlipped { return YES; }
// Stop unhandled web view events from bubbling up the responder chain to SilkView behind it.
- (void)scrollWheel:(NSEvent *)event { (void)event; }
- (void)magnifyWithEvent:(NSEvent *)event { (void)event; }
- (void)mouseDown:(NSEvent *)event { (void)event; }
- (void)mouseUp:(NSEvent *)event { (void)event; }
- (void)mouseDragged:(NSEvent *)event { (void)event; }
- (void)rightMouseDown:(NSEvent *)event { (void)event; }
- (void)rightMouseUp:(NSEvent *)event { (void)event; }
- (void)rightMouseDragged:(NSEvent *)event { (void)event; }
- (void)otherMouseDown:(NSEvent *)event { (void)event; }
- (void)otherMouseUp:(NSEvent *)event { (void)event; }
- (void)otherMouseDragged:(NSEvent *)event { (void)event; }
@end

// Reports the page's icon as a data: URL, as Electron's page-favicon-updated callers want, so
// the app need not fetch it again. A fetch that fails, or that a newer icon overtook, reports
// nothing.
static void report_favicon(uint32_t view, NSString *favicon) {
    if (favicon.length == 0 || [favicon hasPrefix:@"data:"]) {
        push_text(SILK_WEBVIEW_FAVICON_CHANGED, view, favicon);
        return;
    }
    NSURL *url = [NSURL URLWithString:favicon];
    if (!url) return;
    NSURLSessionDataTask *task = [NSURLSession.sharedSession
          dataTaskWithURL:url
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
          if (error || data.length == 0 || data.length > (1 << 20)) return;
          NSString *type = response.MIMEType.length ? response.MIMEType : @"image/x-icon";
          if (![type hasPrefix:@"image/"]) return;
          NSString *encoded = [NSString stringWithFormat:@"data:%@;base64,%@", type,
                                                         [data base64EncodedStringWithOptions:0]];
          dispatch_async(dispatch_get_main_queue(), ^{
            SilkWebViewRecord *record = find_view(view);
            if (!record || ![record.favicon isEqualToString:favicon]) return;
            push_text(SILK_WEBVIEW_FAVICON_CHANGED, view, encoded);
          });
        }];
    [task resume];
}

@implementation SilkConsoleHandler
- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message {
    NSDictionary *body = [message.body isKindOfClass:[NSDictionary class]] ? message.body : nil;
    SilkWebViewRecord *record = body ? find_view(self.viewId) : nil;
    if (!record) return;
    if ([body[@"favicon"] isKindOfClass:[NSString class]]) {
        NSString *favicon = body[@"favicon"];
        if (![favicon isEqualToString:record.favicon ?: @""]) {
            record.favicon = favicon;
            report_favicon(self.viewId, favicon);
        }
        return;
    }
    NSNumber *level = [body[@"level"] isKindOfClass:[NSNumber class]] ? body[@"level"] : @1;
    NSString *text = [body[@"message"] isKindOfClass:[NSString class]] ? body[@"message"] : @"";
    SilkWebViewEvent event = blank(SILK_WEBVIEW_CONSOLE, self.viewId);
    event.level = (uint32_t)MIN(MAX(level.intValue, 0), 4);
    push_texts(event, @[ utf8(text) ]);
}
@end

static void *const observing = (void *)&observing;
static NSString *const observed[] = {@"title", @"URL", @"estimatedProgress", @"canGoBack",
                                     @"canGoForward"};
enum { OBSERVED_COUNT = 5 };

@implementation SilkWebViewRecord

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context {
    if (context != observing) {
        [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
        return;
    }
    WKWebView *webView = self.webView;
    if ([keyPath isEqualToString:@"title"]) {
        push_text(SILK_WEBVIEW_TITLE_CHANGED, self.viewId, webView.title);
    } else if ([keyPath isEqualToString:@"URL"]) {
        push_text(SILK_WEBVIEW_URL_CHANGED, self.viewId, webView.URL.absoluteString);
    } else if ([keyPath isEqualToString:@"estimatedProgress"]) {
        SilkWebViewEvent event = blank(SILK_WEBVIEW_LOAD_PROGRESS, self.viewId);
        event.value = webView.estimatedProgress;
        push(event);
    } else if (webView.canGoBack != self.canGoBack || webView.canGoForward != self.canGoForward) {
        self.canGoBack = webView.canGoBack;
        self.canGoForward = webView.canGoForward;
        SilkWebViewEvent event = blank(SILK_WEBVIEW_HISTORY_CHANGED, self.viewId);
        if (self.canGoBack) event.flags |= SILK_WEBVIEW_FLAG_OK;
        if (self.canGoForward) event.flags |= SILK_WEBVIEW_FLAG_SECOND;
        push(event);
    }
}

// Navigation.

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    BOOL mainFrame = action.targetFrame ? action.targetFrame.isMainFrame : NO;
    if (!action.targetFrame) {
        // target=_blank and window.open: the app decides (see createWebViewWithConfiguration).
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    if (!mainFrame || !self.askBeforeNavigating ||
        action.navigationType == WKNavigationTypeBackForward ||
        action.navigationType == WKNavigationTypeReload) {
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    if (self.skipNextAsk) {
        // LoadHtml is the client's own page, never asked about.
        self.skipNextAsk = NO;
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    uint32_t request = self.nextRequest++;
    self.decisions[@(request)] = decisionHandler;
    BOOL user = action.navigationType == WKNavigationTypeLinkActivated ||
                action.navigationType == WKNavigationTypeFormSubmitted;
    push_answer(SILK_WEBVIEW_NAVIGATION_REQUESTED, self.viewId, request, user,
                action.request.URL.absoluteString);
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
    push_text(SILK_WEBVIEW_LOAD_STARTED, self.viewId, webView.URL.absoluteString);
}

- (void)finishLoad:(WKWebView *)webView error:(NSError *)error {
    SilkWebViewEvent event = blank(SILK_WEBVIEW_LOAD_FINISHED, self.viewId);
    if (!error) event.flags |= SILK_WEBVIEW_FLAG_OK;
    event.value = net_error(error);
    NSString *url = webView.URL.absoluteString;
    if (!url) url = error.userInfo[NSURLErrorFailingURLStringErrorKey];
    push_texts(event, @[ utf8(url ? url : @""), utf8(error_text(error)) ]);
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    [self finishLoad:webView error:nil];
}

- (void)webView:(WKWebView *)webView
    didFailNavigation:(WKNavigation *)navigation
            withError:(NSError *)error {
    [self finishLoad:webView error:error];
}

- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)navigation
                       withError:(NSError *)error {
    [self finishLoad:webView error:error];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    push_text(SILK_WEBVIEW_CRASHED, self.viewId, @"the web content process ended");
}

// New windows are the app's call: report and open nothing.
- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)action
                    windowFeatures:(WKWindowFeatures *)windowFeatures {
    push_text(SILK_WEBVIEW_NEW_WINDOW_REQUESTED, self.viewId, action.request.URL.absoluteString);
    return nil;
}

- (void)webViewDidClose:(WKWebView *)webView {}

@end

// ---------------------------------------------------------------------------------------
// Opening, closing and placing.

static NSString *const consoleScript =
    @"(() => {\n"
     "  const handler = window.webkit && window.webkit.messageHandlers &&\n"
     "    window.webkit.messageHandlers.silkConsole;\n"
     "  if (!handler) return;\n"
     "  const text = value => {\n"
     "    if (typeof value === 'string') return value;\n"
     "    if (value instanceof Error) return String(value.stack || value);\n"
     "    try { const json = JSON.stringify(value); return json === undefined ? String(value) : json; }\n"
     "    catch (e) { return String(value); }\n"
     "  };\n"
     "  const send = (level, args) => {\n"
     "    try { handler.postMessage({ level, message: Array.from(args, text).join(' ') }); } catch (e) {}\n"
     "  };\n"
     "  [['debug', 0], ['log', 1], ['info', 2], ['warn', 3], ['error', 4]].forEach(([name, level]) => {\n"
     "    const original = console[name];\n"
     "    console[name] = function (...args) { send(level, args); return original.apply(this, args); };\n"
     "  });\n"
     "  window.addEventListener('error', event => send(4, [event.message]));\n"
     "  window.addEventListener('unhandledrejection', event => send(4, ['Unhandled rejection:', event.reason]));\n"
     "  if (window.top !== window) return;\n"
     "  const icon = () => {\n"
     "    const link = document.querySelector('link[rel~=\"icon\" i]');\n"
     "    let href = link && link.href;\n"
     "    if (!href && /^https?:$/.test(location.protocol)) href = new URL('/favicon.ico', location.href).href;\n"
     "    try { handler.postMessage({ favicon: href || '' }); } catch (e) {}\n"
     "  };\n"
     "  document.addEventListener('DOMContentLoaded', () => {\n"
     "    icon();\n"
     "    if (document.head) new MutationObserver(icon).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });\n"
     "  });\n"
     "})();";

// A stable data store identifier for a profile name: a UUID made from its SHA-256.
static NSUUID *profile_identifier(NSString *profile) {
    NSData *name = utf8(profile);
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(name.bytes, (CC_LONG)name.length, digest);
    digest[6] = (digest[6] & 0x0F) | 0x50; // version 5 style
    digest[8] = (digest[8] & 0x3F) | 0x80;
    return [[NSUUID alloc] initWithUUIDBytes:digest];
}

static NSURL *url_from(NSString *text) {
    NSURL *url = [NSURL URLWithString:text];
    if (!url) {
        NSString *escaped =
            [text stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.URLFragmentAllowedCharacterSet];
        url = escaped ? [NSURL URLWithString:escaped] : nil;
    }
    return url;
}

// A click on the Silk UI takes keyboard focus back from a web view, as a click outside a text
// field does: AppKit would leave the page first responder, since the Silk view takes no focus
// on its own.
static void watch_clicks(void) {
    static id monitor;
    if (monitor) return;
    NSEventMask mask = NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown;
    monitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask
                                                    handler:^NSEvent *(NSEvent *event) {
                                                      NSWindow *window = event.window;
                                                      NSResponder *first = window.firstResponder;
                                                      NSView *web = [first isKindOfClass:[NSView class]] ? (NSView *)first : nil;
                                                      while (web && ![web isKindOfClass:[SilkWKWebView class]]) web = web.superview;
                                                      if (!web) return event;
                                                      NSView *root = window.contentView;
                                                      NSPoint at = [root.superview convertPoint:event.locationInWindow fromView:nil];
                                                      NSView *hit = [root hitTest:at];
                                                      if (hit && [hit isDescendantOf:web]) return event;
                                                      NSView *silk = web.superview.superview;
                                                      if (silk) [window makeFirstResponder:silk];
                                                      return event;
                                                    }];
}

uint32_t silk_webview_open(uint32_t view, uint32_t window, const uint8_t *url, size_t urlLength,
                           const uint8_t *profile, size_t profileLength, uint32_t flags,
                           const uint8_t *agentScript, size_t agentScriptLength) {
    if (!pthread_main_np() || !NSApp) return SILK_WEBVIEW_NOT_STARTED;
    if (!views) views = [NSMutableDictionary dictionary];
    if (find_view(view)) return SILK_WEBVIEW_ID_IN_USE;
    NSView *content = content_view(window);
    if (!content) return SILK_WEBVIEW_NO_WINDOW;
    watch_clicks();
    @autoreleasepool {
        if (!agentWorld) agentWorld = [WKContentWorld worldWithName:@"silk-agent"];
        WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
        NSString *profileName = string_from(profile, profileLength);
        configuration.websiteDataStore =
            profileName.length
                ? [WKWebsiteDataStore dataStoreForIdentifier:profile_identifier(profileName)]
                : [WKWebsiteDataStore nonPersistentDataStore];
        WKUserContentController *content_controller = configuration.userContentController;
        NSString *agent = string_from(agentScript, agentScriptLength);
        if (agent.length) {
            [content_controller
                addUserScript:[[WKUserScript alloc] initWithSource:agent
                                                     injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                  forMainFrameOnly:YES
                                                    inContentWorld:agentWorld]];
        }
        SilkConsoleHandler *console = [SilkConsoleHandler new];
        console.viewId = view;
        [content_controller addScriptMessageHandler:console
                                       contentWorld:WKContentWorld.pageWorld
                                               name:@"silkConsole"];
        [content_controller
            addUserScript:[[WKUserScript alloc] initWithSource:consoleScript
                                                 injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                              forMainFrameOnly:YES
                                                inContentWorld:WKContentWorld.pageWorld]];

        SilkWKWebView *webView = [[SilkWKWebView alloc] initWithFrame:NSZeroRect
                                                        configuration:configuration];
        if (!webView) return SILK_WEBVIEW_CREATION_FAILED;
        webView.viewId = view;
        webView.inspectable = (flags & SILK_WEBVIEW_INSPECTABLE) != 0;
        if (flags & SILK_WEBVIEW_TRANSPARENT) {
            @try {
                [webView setValue:@NO forKey:@"drawsBackground"];
            } @catch (NSException *exception) {
            }
        }
        webView.allowsBackForwardNavigationGestures = YES;
        webView.allowsMagnification = NO;

        SilkWebClipView *clip = [[SilkWebClipView alloc] initWithFrame:NSZeroRect];
        clip.wantsLayer = YES;
        clip.layer.masksToBounds = YES;
        clip.clipsToBounds = YES;
        clip.hidden = YES;
        [clip addSubview:webView];
        [content addSubview:clip];

        SilkWebViewRecord *record = [SilkWebViewRecord new];
        record.viewId = view;
        record.webView = webView;
        record.clipView = clip;
        record.askBeforeNavigating = (flags & SILK_WEBVIEW_ASK_BEFORE_NAVIGATING) != 0;
        record.nextRequest = 1;
        record.decisions = [NSMutableDictionary dictionary];
        record.profile = profileName;
        webView.navigationDelegate = record;
        webView.UIDelegate = record;
        for (int i = 0; i < OBSERVED_COUNT; i++) {
            [webView addObserver:record forKeyPath:observed[i] options:0 context:observing];
        }
        views[@(view)] = record;
        push(blank(SILK_WEBVIEW_CREATED, view));
        NSString *first = string_from(url, urlLength);
        if (first.length) {
            NSURL *firstUrl = url_from(first);
            if (firstUrl) [webView loadRequest:[NSURLRequest requestWithURL:firstUrl]];
        }
        return SILK_WEBVIEW_OPENED;
    }
}

void silk_webview_close(uint32_t view) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    [views removeObjectForKey:@(view)];
    SilkWKWebView *webView = record.webView;
    for (int i = 0; i < OBSERVED_COUNT; i++) {
        [webView removeObserver:record forKeyPath:observed[i] context:observing];
    }
    for (NSNumber *request in record.decisions) {
        record.decisions[request](WKNavigationActionPolicyCancel);
    }
    [record.decisions removeAllObjects];
    if (webView.window && webView.window.firstResponder == webView) {
        [webView.window makeFirstResponder:webView.superview.superview];
    }
    [webView stopLoading];
    webView.navigationDelegate = nil;
    webView.UIDelegate = nil;
    [webView.configuration.userContentController removeAllScriptMessageHandlers];
    [record.clipView removeFromSuperview];
    push(blank(SILK_WEBVIEW_CLOSED, view));
}

uint8_t silk_webview_exists(uint32_t view) { return find_view(view) ? 1 : 0; }

void silk_webview_place(uint32_t view, double x0, double y0, double x1, double y1, double clipX0,
                        double clipY0, double clipX1, double clipY1, uint8_t visible) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    // The visible part of the bounds; the clip only ever shrinks what shows.
    double cx0 = MAX(clipX0, x0), cy0 = MAX(clipY0, y0);
    double cx1 = MIN(clipX1, x1), cy1 = MIN(clipY1, y1);
    BOOL shows = visible && cx1 > cx0 && cy1 > cy0 && x1 > x0 && y1 > y0;
    NSRect clip = shows ? NSMakeRect(cx0, cy0, cx1 - cx0, cy1 - cy0) : NSZeroRect;
    NSRect bounds = NSMakeRect(x0 - cx0, y0 - cy0, MAX(x1 - x0, 0), MAX(y1 - y0, 0));
    BOOL hidden = !shows;
    if (NSEqualRects(record.clipView.frame, clip) && NSEqualRects(record.webView.frame, bounds) &&
        record.clipView.hidden == hidden) {
        return;
    }
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    record.clipView.frame = clip;
    if (shows) record.webView.frame = bounds;
    if (record.clipView.hidden != hidden) {
        if (hidden && record.webView.window.firstResponder == record.webView) {
            // A hidden view takes no input, keys included.
            [record.webView.window makeFirstResponder:record.clipView.superview];
        }
        record.clipView.hidden = hidden;
    }
    [CATransaction commit];
}

// ---------------------------------------------------------------------------------------
// The queue.

uint8_t silk_webview_next_event(SilkWebViewEvent *out) {
    if (queue.count == 0) {
        currentTexts = @[];
        return 0;
    }
    SilkWebViewQueued *queued = queue.firstObject;
    [queue removeObjectAtIndex:0];
    *out = queued->event;
    currentTexts = queued.texts;
    return 1;
}

const uint8_t *silk_webview_event_text(size_t index, size_t *length) {
    if (index >= currentTexts.count) {
        *length = 0;
        return NULL;
    }
    NSData *data = currentTexts[index];
    *length = data.length;
    return data.length ? data.bytes : (const uint8_t *)"";
}

void silk_webview_queue(uint32_t view, uint32_t kind, uint32_t request, uint32_t flags,
                        const uint8_t *text, size_t length) {
    SilkWebViewEvent event = blank(kind, view);
    event.request = request;
    event.flags = flags;
    push_texts(event, @[ [NSData dataWithBytes:text ? (const void *)text : "" length:length] ]);
}

// ---------------------------------------------------------------------------------------
// Pages and history.

void silk_webview_navigate(uint32_t view, const uint8_t *url, size_t length) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    NSString *text = string_from(url, length);
    NSURL *target = url_from(text);
    if (!target) {
        SilkWebViewEvent event = blank(SILK_WEBVIEW_LOAD_FINISHED, view);
        push_texts(event, @[ utf8(text), utf8(@"not a URL") ]);
        return;
    }
    [record.webView loadRequest:[NSURLRequest requestWithURL:target]];
}

void silk_webview_load_html(uint32_t view, const uint8_t *html, size_t htmlLength,
                            const uint8_t *baseUrl, size_t baseUrlLength) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    NSString *base = string_from(baseUrl, baseUrlLength);
    record.skipNextAsk = YES;
    [record.webView loadHTMLString:string_from(html, htmlLength)
                           baseURL:base.length ? url_from(base) : nil];
}

void silk_webview_go(uint32_t view, uint32_t operation) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    switch (operation) {
    case SILK_WEBVIEW_BACK: [record.webView goBack]; break;
    case SILK_WEBVIEW_FORWARD: [record.webView goForward]; break;
    case SILK_WEBVIEW_RELOAD: [record.webView reload]; break;
    case SILK_WEBVIEW_RELOAD_FROM_ORIGIN: [record.webView reloadFromOrigin]; break;
    default: [record.webView stopLoading]; break;
    }
}

void silk_webview_set_zoom(uint32_t view, double factor) {
    SilkWebViewRecord *record = find_view(view);
    if (record && factor > 0) record.webView.pageZoom = factor;
}

void silk_webview_focus(uint32_t view) {
    SilkWebViewRecord *record = find_view(view);
    if (!record || !record.webView.window) return;
    [record.webView.window makeFirstResponder:record.webView];
}

void silk_webview_answer_navigation(uint32_t view, uint32_t request, uint8_t allow) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    void (^decision)(WKNavigationActionPolicy) = record.decisions[@(request)];
    if (!decision) return;
    [record.decisions removeObjectForKey:@(request)];
    decision(allow ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}

// WebKit has no public API to open Web Inspector (Safari's Develop menu attaches to inspectable
// views). Its own `_inspector` (what MiniBrowser uses) shows it docked in the window.
uint8_t silk_webview_open_devtools(uint32_t view) {
    SilkWebViewRecord *record = find_view(view);
    if (!record || !record.webView.inspectable) return 0;
    SEL inspectorSelector = NSSelectorFromString(@"_inspector");
    if (![record.webView respondsToSelector:inspectorSelector]) return 0;
    id inspector = ((id (*)(id, SEL))objc_msgSend)(record.webView, inspectorSelector);
    SEL show = NSSelectorFromString(@"show");
    if (!inspector || ![inspector respondsToSelector:show]) return 0;
    ((void (*)(id, SEL))objc_msgSend)(inspector, show);
    return 1;
}

void silk_webview_set_muted(uint32_t view, uint8_t muted) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    // WebKit's own page mute (_WKMediaAudioMuted), what Safari's tab mute uses.
    SEL setMuted = NSSelectorFromString(@"_setPageMuted:");
    if ([record.webView respondsToSelector:setMuted]) {
        ((void (*)(id, SEL, NSUInteger))objc_msgSend)(record.webView, setMuted, muted ? 1 : 0);
        return;
    }
    NSString *script = [NSString stringWithFormat:
        @"document.querySelectorAll('audio, video').forEach(m => { m.muted = %@; });",
        muted ? @"true" : @"false"];
    [record.webView evaluateJavaScript:script inFrame:nil inContentWorld:agentWorld completionHandler:nil];
}

void silk_webview_set_color_scheme(uint32_t view, uint32_t scheme) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    // Pages follow the web view's effective appearance in prefers-color-scheme.
    record.webView.appearance = scheme == 1   ? [NSAppearance appearanceNamed:NSAppearanceNameAqua]
                                : scheme == 2 ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]
                                              : nil;
}

// Counts the case-insensitive matches of `text` in what the page shows, in the agent's world.
static NSString *const countScript =
    @"const needle = text.toLowerCase();\n"
     "if (!needle) return 0;\n"
     "const hay = (document.body ? document.body.innerText : '').toLowerCase();\n"
     "let count = 0;\n"
     "for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) count++;\n"
     "return count;";

void silk_webview_find(uint32_t view, uint32_t request, const uint8_t *text, size_t length,
                       uint8_t forward, uint8_t newSession) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    NSString *needle = string_from(text, length);
    BOOL fresh = newSession || ![needle isEqualToString:record.findText ?: @""];
    record.findText = needle;
    WKWebView *webView = record.webView;
    void (^answer)(uint32_t, uint32_t) = ^(uint32_t matches, uint32_t active) {
      if (!find_view(view)) return;
      SilkWebViewEvent event = blank(SILK_WEBVIEW_FOUND_IN_PAGE, view);
      event.request = request;
      event.width = matches;
      event.height = active;
      if (matches > 0) event.flags |= SILK_WEBVIEW_FLAG_OK;
      push(event);
    };
    [webView callAsyncJavaScript:countScript
                       arguments:@{@"text" : needle}
                         inFrame:nil
                  inContentWorld:agentWorld
               completionHandler:^(id result, NSError *error) {
                 SilkWebViewRecord *now = find_view(view);
                 if (!now) return;
                 uint32_t matches = [result isKindOfClass:[NSNumber class]] ? [result unsignedIntValue] : 0;
                 if (matches == 0 || needle.length == 0) {
                     now.findActive = 0;
                     answer(0, 0);
                     return;
                 }
                 WKFindConfiguration *configuration = [WKFindConfiguration new];
                 configuration.backwards = !forward && !fresh;
                 configuration.caseSensitive = NO;
                 configuration.wraps = YES;
                 [now.webView findString:needle
                       withConfiguration:configuration
                       completionHandler:^(WKFindResult *found) {
                         SilkWebViewRecord *after = find_view(view);
                         if (!after) return;
                         uint32_t active = after.findActive;
                         if (!found.matchFound) active = 0;
                         else if (fresh || active == 0 || active > matches) active = 1;
                         else if (forward) active = active % matches + 1;
                         else active = active == 1 ? matches : active - 1;
                         after.findActive = active;
                         answer(matches, active);
                       }];
               }];
}

void silk_webview_stop_find(uint32_t view) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    record.findText = nil;
    record.findActive = 0;
    [record.webView evaluateJavaScript:@"getSelection().removeAllRanges()"
                               inFrame:nil
                        inContentWorld:WKContentWorld.pageWorld
                     completionHandler:nil];
}

void silk_webview_clear_data(uint32_t request, const uint8_t *profile, size_t length,
                             uint32_t kinds) {
    NSString *name = string_from(profile, length);
    NSMutableSet<NSString *> *types = [NSMutableSet set];
    if (kinds & SILK_WEBVIEW_CLEAR_COOKIES) {
        [types addObjectsFromArray:@[
            WKWebsiteDataTypeCookies, WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeSessionStorage,
            WKWebsiteDataTypeIndexedDBDatabases, WKWebsiteDataTypeWebSQLDatabases
        ]];
    }
    if (kinds & SILK_WEBVIEW_CLEAR_CACHE) {
        [types addObjectsFromArray:@[
            WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache,
            WKWebsiteDataTypeOfflineWebApplicationCache
        ]];
    }
    // A profile's store; without a name, the private store of each view opened without one.
    NSMutableArray<WKWebsiteDataStore *> *stores = [NSMutableArray array];
    if (name.length) {
        [stores addObject:[WKWebsiteDataStore dataStoreForIdentifier:profile_identifier(name)]];
    } else {
        for (SilkWebViewRecord *record in views.allValues) {
            if (record.profile.length == 0) [stores addObject:record.webView.configuration.websiteDataStore];
        }
    }
    __block NSUInteger left = stores.count;
    void (^done)(void) = ^{
      SilkWebViewEvent event = blank(SILK_WEBVIEW_DATA_CLEARED, 0);
      event.request = request;
      push(event);
    };
    if (left == 0 || types.count == 0) {
        done();
        return;
    }
    for (WKWebsiteDataStore *store in stores) {
        [store removeDataOfTypes:types
                   modifiedSince:[NSDate distantPast]
               completionHandler:^{
                 if (--left == 0) done();
               }];
    }
}

// ---------------------------------------------------------------------------------------
// Scripts.

// A value WebKit handed back, as JSON text.
static NSString *json_text(id value) {
    if (!value || value == [NSNull null]) return @"null";
    if ([NSJSONSerialization isValidJSONObject:@[ value ]]) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:value
                                                       options:NSJSONWritingFragmentsAllowed
                                                         error:nil];
        if (data) return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    }
    return @"null";
}

// The value of JSON text, or nil.
static id parse_json(id text) {
    if (![text isKindOfClass:[NSString class]]) return nil;
    NSData *data = utf8(text);
    return [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil];
}

void silk_webview_evaluate(uint32_t view, uint32_t request, const uint8_t *script, size_t length) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    // Indirect eval gives the script's completion value in global scope, as a console or CDP's
    // Runtime.evaluate does; the async function awaits a promise. Turned into JSON in the page,
    // so values WebKit cannot hand back (DOM nodes, functions) still answer.
    NSString *body = @"const value = await (0, eval)(script);\n"
                      "const json = value === undefined ? undefined : JSON.stringify(value);\n"
                      "return json === undefined ? 'null' : json;";
    [record.webView callAsyncJavaScript:body
                              arguments:@{@"script" : string_from(script, length)}
                                inFrame:nil
                         inContentWorld:WKContentWorld.pageWorld
                      completionHandler:^(id result, NSError *error) {
                        if (!find_view(view)) return;
                        if (error) {
                            push_answer(SILK_WEBVIEW_SCRIPT_RESULT, view, request, NO,
                                        error_text(error));
                        } else {
                            NSString *json = [result isKindOfClass:[NSString class]] ? result
                                                                                     : json_text(result);
                            push_answer(SILK_WEBVIEW_SCRIPT_RESULT, view, request, YES, json);
                        }
                      }];
}

// ---------------------------------------------------------------------------------------
// Synthesized input.

static NSEventModifierFlags modifier_flags(uint32_t bits) {
    NSEventModifierFlags flags = 0;
    if (bits & 1) flags |= NSEventModifierFlagShift;
    if (bits & 2) flags |= NSEventModifierFlagControl;
    if (bits & 4) flags |= NSEventModifierFlagOption;
    if (bits & 8) flags |= NSEventModifierFlagCommand;
    return flags;
}

// A point of the page's viewport (CSS pixels) in the window's coordinates.
static NSPoint window_point(WKWebView *webView, double x, double y) {
    double zoom = webView.pageZoom > 0 ? webView.pageZoom : 1.0;
    NSPoint local = NSMakePoint(x * zoom, y * zoom);
    if (!webView.isFlipped) local.y = NSHeight(webView.bounds) - local.y;
    return [webView convertPoint:local toView:nil];
}

static NSView *target_at(WKWebView *webView, NSPoint inWindow) {
    NSView *hit = webView.superview ? [webView hitTest:[webView.superview convertPoint:inWindow fromView:nil]] : nil;
    return hit && [hit isDescendantOf:webView] ? hit : webView;
}

static NSEvent *mouse_event(NSEventType type, WKWebView *webView, NSPoint at, NSInteger clicks,
                            uint32_t modifiers) {
    return [NSEvent mouseEventWithType:type
                              location:at
                         modifierFlags:modifier_flags(modifiers)
                             timestamp:NSProcessInfo.processInfo.systemUptime
                          windowNumber:webView.window.windowNumber
                               context:nil
                           eventNumber:0
                            clickCount:clicks
                              pressure:type == NSEventTypeLeftMouseDown ? 1.0 : 0.0];
}

static void click(WKWebView *webView, double x, double y, uint32_t button, uint32_t clickCount,
                  uint32_t modifiers) {
    if (!webView.window) return;
    NSPoint at = window_point(webView, x, y);
    NSView *target = target_at(webView, at);
    NSInteger clicks = clickCount < 1 ? 1 : clickCount;
    for (NSInteger i = 1; i <= clicks; i++) {
        if (button == 2) {
            [target rightMouseDown:mouse_event(NSEventTypeRightMouseDown, webView, at, i, modifiers)];
            [target rightMouseUp:mouse_event(NSEventTypeRightMouseUp, webView, at, i, modifiers)];
        } else if (button == 1) {
            [target otherMouseDown:mouse_event(NSEventTypeOtherMouseDown, webView, at, i, modifiers)];
            [target otherMouseUp:mouse_event(NSEventTypeOtherMouseUp, webView, at, i, modifiers)];
        } else {
            [target mouseDown:mouse_event(NSEventTypeLeftMouseDown, webView, at, i, modifiers)];
            [target mouseUp:mouse_event(NSEventTypeLeftMouseUp, webView, at, i, modifiers)];
        }
    }
}

void silk_webview_click(uint32_t view, double x, double y, uint32_t button, uint32_t clickCount,
                        uint32_t modifiers) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    // A click into the page gives it keyboard focus, as a person's click does.
    if (button == 0 && record.webView.window) [record.webView.window makeFirstResponder:record.webView];
    click(record.webView, x, y, button, clickCount, modifiers);
}

void silk_webview_move_pointer(uint32_t view, double x, double y, uint32_t modifiers) {
    SilkWebViewRecord *record = find_view(view);
    if (!record || !record.webView.window) return;
    NSPoint at = window_point(record.webView, x, y);
    [target_at(record.webView, at) mouseMoved:mouse_event(NSEventTypeMouseMoved, record.webView, at, 0, modifiers)];
}

void silk_webview_scroll(uint32_t view, double x, double y, double deltaX, double deltaY,
                         uint32_t modifiers) {
    SilkWebViewRecord *record = find_view(view);
    if (!record || !record.webView.window) return;
    WKWebView *webView = record.webView;
    NSPoint at = window_point(webView, x, y);
    NSPoint screen = [webView.window convertPointToScreen:at];
    CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame);
    double zoom = webView.pageZoom > 0 ? webView.pageZoom : 1.0;
    // Wheel deltas point the other way from DOM deltas (positive scrolls up).
    CGEventRef wheel = CGEventCreateScrollWheelEvent2(NULL, kCGScrollEventUnitPixel, 2,
                                                      (int32_t)lround(-deltaY * zoom),
                                                      (int32_t)lround(-deltaX * zoom), 0);
    if (!wheel) return;
    CGEventSetLocation(wheel, CGPointMake(screen.x, top - screen.y));
    CGEventSetFlags(wheel, (CGEventFlags)modifier_flags(modifiers));
    CGEventSetIntegerValueField(wheel, kCGMouseEventWindowUnderMousePointer, webView.window.windowNumber);
    CGEventSetIntegerValueField(wheel, kCGMouseEventWindowUnderMousePointerThatCanHandleThisEvent,
                                webView.window.windowNumber);
    NSEvent *event = [NSEvent eventWithCGEvent:wheel];
    CFRelease(wheel);
    if (event) [target_at(webView, at) scrollWheel:event];
}

typedef struct KeyInfo {
    unsigned short code;
    unichar character;
} KeyInfo;

// macOS virtual key codes of the US layout, for the keys `event.code` names.
static unsigned short code_of_character(unichar c) {
    static const char *const layout = "asdfhgzxcv\0bqweryt123465=97-80]ou[ip\0lj'k;\\,/nm.\0 `";
    if (c >= 'A' && c <= 'Z') c = c - 'A' + 'a';
    for (unsigned short i = 0; i < 51; i++) {
        if (layout[i] && (unichar)layout[i] == c) return i;
    }
    return 0xFFFF;
}

static BOOL named_key(NSString *name, KeyInfo *out) {
    static NSDictionary<NSString *, NSArray<NSNumber *> *> *keys;
    if (!keys) {
        keys = @{
            @"Enter" : @[ @36, @'\r' ],
            @"Tab" : @[ @48, @'\t' ],
            @"Backspace" : @[ @51, @0x7F ],
            @"Escape" : @[ @53, @0x1B ],
            @"Delete" : @[ @117, @(NSDeleteFunctionKey) ],
            @"Home" : @[ @115, @(NSHomeFunctionKey) ],
            @"End" : @[ @119, @(NSEndFunctionKey) ],
            @"PageUp" : @[ @116, @(NSPageUpFunctionKey) ],
            @"PageDown" : @[ @121, @(NSPageDownFunctionKey) ],
            @"ArrowLeft" : @[ @123, @(NSLeftArrowFunctionKey) ],
            @"ArrowRight" : @[ @124, @(NSRightArrowFunctionKey) ],
            @"ArrowDown" : @[ @125, @(NSDownArrowFunctionKey) ],
            @"ArrowUp" : @[ @126, @(NSUpArrowFunctionKey) ],
            @"F1" : @[ @122, @(NSF1FunctionKey) ],
            @"F2" : @[ @120, @(NSF2FunctionKey) ],
            @"F3" : @[ @99, @(NSF3FunctionKey) ],
            @"F4" : @[ @118, @(NSF4FunctionKey) ],
            @"F5" : @[ @96, @(NSF5FunctionKey) ],
            @"F6" : @[ @97, @(NSF6FunctionKey) ],
            @"F7" : @[ @98, @(NSF7FunctionKey) ],
            @"F8" : @[ @100, @(NSF8FunctionKey) ],
            @"F9" : @[ @101, @(NSF9FunctionKey) ],
            @"F10" : @[ @109, @(NSF10FunctionKey) ],
            @"F11" : @[ @103, @(NSF11FunctionKey) ],
            @"F12" : @[ @111, @(NSF12FunctionKey) ],
        };
    }
    NSArray<NSNumber *> *key = keys[name];
    if (!key) return NO;
    out->code = key[0].unsignedShortValue;
    out->character = key[1].unsignedShortValue;
    return YES;
}

// One key press and release, typing `characters`.
static void send_key(WKWebView *webView, NSString *characters, NSString *unmodified,
                     unsigned short code, uint32_t modifiers) {
    if (!webView.window) return;
    NSEventModifierFlags flags = modifier_flags(modifiers);
    NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
    NSInteger window = webView.window.windowNumber;
    NSEvent *down = [NSEvent keyEventWithType:NSEventTypeKeyDown
                                     location:NSZeroPoint
                                modifierFlags:flags
                                    timestamp:now
                                 windowNumber:window
                                      context:nil
                                   characters:characters
                  charactersIgnoringModifiers:unmodified
                                    isARepeat:NO
                                      keyCode:code];
    NSEvent *up = [NSEvent keyEventWithType:NSEventTypeKeyUp
                                   location:NSZeroPoint
                              modifierFlags:flags
                                  timestamp:now
                               windowNumber:window
                                    context:nil
                                 characters:characters
                charactersIgnoringModifiers:unmodified
                                  isARepeat:NO
                                    keyCode:code];
    if (!down || !up) return;
    // Command shortcuts (select all, copy, paste) are key equivalents in AppKit.
    if (!((flags & NSEventModifierFlagCommand) && [webView performKeyEquivalent:down])) {
        [webView keyDown:down];
    }
    [webView keyUp:up];
}

static void type_text(WKWebView *webView, NSString *text) {
    [text enumerateSubstringsInRange:NSMakeRange(0, text.length)
                             options:NSStringEnumerationByComposedCharacterSequences
                          usingBlock:^(NSString *piece, NSRange range, NSRange enclosing, BOOL *stop) {
                            if ([piece isEqualToString:@"\n"] || [piece isEqualToString:@"\r"]) {
                                send_key(webView, @"\r", @"\r", 36, 0);
                                return;
                            }
                            if ([piece isEqualToString:@"\t"]) {
                                send_key(webView, @"\t", @"\t", 48, 0);
                                return;
                            }
                            unsigned short code = piece.length == 1
                                                      ? code_of_character([piece characterAtIndex:0])
                                                      : 0xFFFF;
                            send_key(webView, piece, piece.lowercaseString, code == 0xFFFF ? 0 : code,
                                     0);
                          }];
}

static void take_keyboard(WKWebView *webView) {
    if (webView.window && webView.window.firstResponder != webView) {
        [webView.window makeFirstResponder:webView];
    }
}

void silk_webview_type_text(uint32_t view, const uint8_t *text, size_t length) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    take_keyboard(record.webView);
    type_text(record.webView, string_from(text, length));
}

static BOOL press_key(WKWebView *webView, NSString *name, uint32_t modifiers) {
    KeyInfo key;
    if (named_key(name, &key)) {
        NSString *characters = [NSString stringWithCharacters:&key.character length:1];
        send_key(webView, characters, characters, key.code, modifiers);
        return YES;
    }
    if (name.length == 0) return NO;
    NSRange first = [name rangeOfComposedCharacterSequenceAtIndex:0];
    if (first.length != name.length) return NO;
    unsigned short code = name.length == 1 ? code_of_character([name characterAtIndex:0]) : 0xFFFF;
    NSString *unmodified = name.lowercaseString;
    NSString *characters = (modifiers & 1) ? name.uppercaseString : name;
    send_key(webView, characters, unmodified, code == 0xFFFF ? 0 : code, modifiers);
    return YES;
}

uint8_t silk_webview_press_key(uint32_t view, const uint8_t *key, size_t length,
                               uint32_t modifiers) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return 1;
    NSString *name = string_from(key, length);
    take_keyboard(record.webView);
    return press_key(record.webView, name, modifiers) ? 1 : 0;
}

// ---------------------------------------------------------------------------------------
// Agent control.

// Answers once the synthesized input has reached the page: a script round trip after it.
static void answer_after_input(WKWebView *webView, uint32_t view, uint32_t request) {
    [webView evaluateJavaScript:@"0"
                        inFrame:nil
                 inContentWorld:agentWorld
              completionHandler:^(id result, NSError *error) {
                if (find_view(view)) push_answer(SILK_WEBVIEW_ACTION_RESULT, view, request, YES, @"");
              }];
}

// Answers a fill once the focused field holds the typed text (WebKit's script round trip can
// overtake key events still queued for the page, so the next action would land first), or after
// about two seconds, or at once when the focus is not on a field.
static void answer_after_typing(WKWebView *webView, uint32_t view, uint32_t request, NSString *text,
                                int tries) {
    [webView callAsyncJavaScript:@"const e = document.activeElement;"
                                 @"if (!e || !('value' in e)) return true;"
                                 @"const v = String(e.value);"
                                 @"return text.length ? v.endsWith(text) : v.length === 0;"
                       arguments:@{@"text" : text}
                         inFrame:nil
                  inContentWorld:agentWorld
               completionHandler:^(id result, NSError *error) {
                 SilkWebViewRecord *current = find_view(view);
                 if (!current) return;
                 if (error || [result boolValue] || tries <= 0) {
                     push_answer(SILK_WEBVIEW_ACTION_RESULT, view, request, YES, @"");
                     return;
                 }
                 WKWebView *again = current.webView;
                 dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_MSEC),
                                dispatch_get_main_queue(), ^{
                                  if (find_view(view)) answer_after_typing(again, view, request, text, tries - 1);
                                });
               }];
}

void silk_webview_agent(uint32_t view, uint32_t request, uint32_t operation, const uint8_t *call,
                        size_t callLength, const uint8_t *text, size_t textLength) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    NSString *fill = string_from(text, textLength);
    [record.webView
        evaluateJavaScript:string_from(call, callLength)
                   inFrame:nil
            inContentWorld:agentWorld
         completionHandler:^(id result, NSError *error) {
           SilkWebViewRecord *current = find_view(view);
           if (!current) return;
           WKWebView *webView = current.webView;
           id value = error ? nil : parse_json(result);
           if (operation == SILK_WEBVIEW_AGENT_SNAPSHOT) {
               SilkWebViewEvent event = blank(SILK_WEBVIEW_SNAPSHOT, view);
               event.request = request;
               NSString *outline = [value isKindOfClass:[NSString class]] ? value : @"";
               push_texts(event, @[ utf8(outline) ]);
               return;
           }
           NSDictionary *location = [value isKindOfClass:[NSDictionary class]] ? value : nil;
           if (!location || ![location[@"ok"] boolValue]) {
               NSString *reason = error ? error_text(error)
                                        : [location[@"error"] isKindOfClass:[NSString class]]
                                              ? location[@"error"]
                                              : @"the element was not found";
               push_answer(SILK_WEBVIEW_ACTION_RESULT, view, request, NO, reason);
               return;
           }
           if (operation == SILK_WEBVIEW_AGENT_CLICK) {
               if (webView.window) [webView.window makeFirstResponder:webView];
               click(webView, [location[@"x"] doubleValue], [location[@"y"] doubleValue], 0, 1, 0);
           } else {
               take_keyboard(webView);
               if (fill.length) {
                   type_text(webView, fill);
               } else {
                   press_key(webView, @"Delete", 0);
               }
               answer_after_typing(webView, view, request, fill, 100);
               return;
           }
           answer_after_input(webView, view, request);
         }];
}

// ---------------------------------------------------------------------------------------
// Screenshots.

void silk_webview_screenshot(uint32_t view, uint32_t request) {
    SilkWebViewRecord *record = find_view(view);
    if (!record) return;
    [record.webView
        takeSnapshotWithConfiguration:nil
                    completionHandler:^(NSImage *image, NSError *error) {
                      if (!find_view(view)) return;
                      SilkWebViewEvent event = blank(SILK_WEBVIEW_SCREENSHOT, view);
                      event.request = request;
                      CGImageRef cg = image ? [image CGImageForProposedRect:NULL context:nil hints:nil]
                                            : NULL;
                      if (!cg) {
                          push_texts(event, @[ [NSData data] ]);
                          return;
                      }
                      size_t width = CGImageGetWidth(cg), height = CGImageGetHeight(cg);
                      NSMutableData *pixels = [NSMutableData dataWithLength:width * height * 4];
                      CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
                      CGContextRef context = CGBitmapContextCreate(
                          pixels.mutableBytes, width, height, 8, width * 4, space,
                          kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
                      CGColorSpaceRelease(space);
                      if (!context) {
                          push_texts(event, @[ [NSData data] ]);
                          return;
                      }
                      CGContextDrawImage(context, CGRectMake(0, 0, width, height), cg);
                      CGContextRelease(context);
                      // Rows already run top first in a bitmap context's memory; undo the
                      // premultiplication the contract leaves out.
                      uint8_t *bytes = pixels.mutableBytes;
                      for (size_t i = 0; i < width * height; i++) {
                          uint8_t *p = bytes + i * 4;
                          if (p[3] != 0 && p[3] != 255) {
                              for (int c = 0; c < 3; c++) p[c] = (uint8_t)MIN(255, (p[c] * 255 + p[3] / 2) / p[3]);
                          }
                      }
                      event.width = (uint32_t)width;
                      event.height = (uint32_t)height;
                      push_texts(event, @[ pixels ]);
                    }];
}

// ---------------------------------------------------------------------------------------
// Test hooks.

void silk_webview_test_frame(uint32_t view, double *x, double *y, double *width, double *height,
                             uint8_t *visible) {
    *x = *y = *width = *height = 0;
    *visible = 0;
    SilkWebViewRecord *record = find_view(view);
    if (!record || !record.clipView.superview) return;
    NSRect frame = [record.clipView.superview convertRect:record.webView.frame fromView:record.clipView];
    *x = frame.origin.x;
    *y = frame.origin.y;
    *width = frame.size.width;
    *height = frame.size.height;
    *visible = record.clipView.hidden ? 0 : 1;
}
