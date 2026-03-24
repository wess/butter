/*
 * Butter shim — macOS native window with WKWebView
 * Objective-C for proper ARM64 struct passing
 *
 * Usage: ./shim <shm-name> <html-path>
 * Env:   BUTTER_TITLE — window title (default: "Butter App")
 *
 * Compile: clang -o shim darwin.m -framework Cocoa -framework WebKit -fobjc-arc
 */

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <sys/mman.h>
#include <semaphore.h>

/* ---------- shared memory / IPC constants ---------- */

#define SHM_SIZE       (128 * 1024)
#define HEADER_SIZE    64
#define RING_SIZE      ((SHM_SIZE - HEADER_SIZE) / 2)
#define RING_TB_OFF    HEADER_SIZE
#define RING_TS_OFF    (HEADER_SIZE + RING_SIZE)
#define MSG_HDR        4

#define TB_WCUR  0
#define TB_RCUR  4
#define TS_WCUR  8
#define TS_RCUR  12

/* ---------- globals ---------- */

static uint8_t *g_shm    = NULL;
static sem_t   *g_sem_tb = NULL;
static sem_t   *g_sem_ts = NULL;

/* ---------- LE uint32 helpers ---------- */

static uint32_t read_u32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1]<<8) | ((uint32_t)p[2]<<16) | ((uint32_t)p[3]<<24);
}

static void write_u32(uint8_t *p, uint32_t v) {
    p[0]=(uint8_t)v; p[1]=(uint8_t)(v>>8); p[2]=(uint8_t)(v>>16); p[3]=(uint8_t)(v>>24);
}

/* ---------- ring buffer write (to-bun) ---------- */

static void ring_write_tb(const char *json, size_t len) {
    uint32_t total = MSG_HDR + (uint32_t)len;
    uint32_t wcur = read_u32(g_shm + TB_WCUR);

    uint8_t hdr[4];
    write_u32(hdr, (uint32_t)len);
    for (uint32_t i = 0; i < MSG_HDR; i++)
        g_shm[RING_TB_OFF + ((wcur+i) % RING_SIZE)] = hdr[i];
    for (uint32_t i = 0; i < (uint32_t)len; i++)
        g_shm[RING_TB_OFF + ((wcur+MSG_HDR+i) % RING_SIZE)] = (uint8_t)json[i];

    write_u32(g_shm + TB_WCUR, (wcur+total) % RING_SIZE);
    sem_post(g_sem_tb);
}

/* ---------- ring buffer read (to-shim) ---------- */

static char *ring_read_ts(void) {
    uint32_t wcur = read_u32(g_shm + TS_WCUR);
    uint32_t rcur = read_u32(g_shm + TS_RCUR);
    if (wcur == rcur) return NULL;

    uint32_t avail = (wcur >= rcur) ? (wcur - rcur) : (RING_SIZE - rcur + wcur);
    if (avail < MSG_HDR) return NULL;

    uint8_t hdr[4];
    for (uint32_t i = 0; i < MSG_HDR; i++)
        hdr[i] = g_shm[RING_TS_OFF + ((rcur+i) % RING_SIZE)];

    uint32_t len = read_u32(hdr);
    if (avail < MSG_HDR + len) return NULL;

    char *buf = malloc(len+1);
    for (uint32_t i = 0; i < len; i++)
        buf[i] = (char)g_shm[RING_TS_OFF + ((rcur+MSG_HDR+i) % RING_SIZE)];
    buf[len] = '\0';

    write_u32(g_shm + TS_RCUR, (rcur+MSG_HDR+len) % RING_SIZE);
    return buf;
}

/* ---------- bridge JS ---------- */

static NSString *BRIDGE_JS =
    @"(function(){"
    "var p=new Map(),n=1,l=new Map();"
    "window.__butterReceive=function(j){"
      "var m=JSON.parse(j);"
      "if(m.type==='response'){"
        "var e=p.get(m.id);if(e){p.delete(m.id);if(e.timer)clearTimeout(e.timer);"
        "if(m.error)e.reject(new Error(m.error));else e.resolve(m.data);}}"
      "else if(m.type==='event'){"
        "var h=l.get(m.action)||[];for(var i=0;i<h.length;i++)h[i](m.data);}"
    "};"
    "var send=function(m){"
      "window.webkit.messageHandlers.butter.postMessage(JSON.stringify(m));"
    "};"
    "window.butter={"
      "invoke:function(a,d,o){return new Promise(function(res,rej){"
        "var id=String(n++),e={resolve:res,reject:rej,timer:null};"
        "var t=o&&o.timeout;if(t&&t>0){e.timer=setTimeout(function(){"
          "p.delete(id);rej(new Error('butter.invoke(\"'+a+'\") timed out after '+t+'ms'));},t);}"
        "p.set(id,e);send({id:id,type:'invoke',action:a,data:d});});},"
      "on:function(a,h){if(!l.has(a))l.set(a,[]);l.get(a).push(h);},"
      "off:function(a,h){var hs=l.get(a);if(!hs)return;var i=hs.indexOf(h);if(i!==-1)hs.splice(i,1);}"
    "};"
    "})();";

/* ---------- delegate ---------- */

/* ---------- custom URL scheme handler ---------- */

static NSString *g_assetDir = nil;

@interface ButterSchemeHandler : NSObject <WKURLSchemeHandler>
@end

@implementation ButterSchemeHandler

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
    NSURL *url = urlSchemeTask.request.URL;
    NSString *path = url.path;
    if (!path || [path isEqualToString:@"/"]) path = @"/index.html";

    NSString *filePath = [g_assetDir stringByAppendingPathComponent:path];
    NSData *data = [NSData dataWithContentsOfFile:filePath];

    if (!data) {
        [urlSchemeTask didFailWithError:[NSError errorWithDomain:NSURLErrorDomain
            code:NSURLErrorFileDoesNotExist userInfo:nil]];
        return;
    }

    /* Determine MIME type */
    NSString *mime = @"application/octet-stream";
    NSString *ext = [filePath pathExtension].lowercaseString;
    if ([ext isEqualToString:@"html"]) mime = @"text/html";
    else if ([ext isEqualToString:@"js"]) mime = @"application/javascript";
    else if ([ext isEqualToString:@"css"]) mime = @"text/css";
    else if ([ext isEqualToString:@"json"]) mime = @"application/json";
    else if ([ext isEqualToString:@"png"]) mime = @"image/png";
    else if ([ext isEqualToString:@"jpg"] || [ext isEqualToString:@"jpeg"]) mime = @"image/jpeg";
    else if ([ext isEqualToString:@"gif"]) mime = @"image/gif";
    else if ([ext isEqualToString:@"svg"]) mime = @"image/svg+xml";
    else if ([ext isEqualToString:@"woff"]) mime = @"font/woff";
    else if ([ext isEqualToString:@"woff2"]) mime = @"font/woff2";
    else if ([ext isEqualToString:@"ttf"]) mime = @"font/ttf";
    else if ([ext isEqualToString:@"ico"]) mime = @"image/x-icon";
    else if ([ext isEqualToString:@"webp"]) mime = @"image/webp";

    NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc]
        initWithURL:url statusCode:200 HTTPVersion:@"HTTP/1.1"
        headerFields:@{@"Content-Type": mime, @"Content-Length": [NSString stringWithFormat:@"%lu", (unsigned long)data.length]}];

    [urlSchemeTask didReceiveResponse:response];
    [urlSchemeTask didReceiveData:data];
    [urlSchemeTask didFinish];
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
    /* Nothing to clean up */
}

@end

/* ---------- delegate ---------- */

@interface ButterDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate>
@property (nonatomic, strong) WKWebView *webview;
@property (nonatomic, strong) NSWindow *window;
@end

@implementation ButterDelegate

- (void)userContentController:(WKUserContentController *)uc didReceiveScriptMessage:(WKScriptMessage *)message {
    NSString *body = message.body;
    const char *utf8 = [body UTF8String];
    if (!utf8) return;

    /* Check for context menu request */
    if (strstr(utf8, "\"__contextmenu\"")) {
        [self showContextMenuFromJson:body];
        return;
    }

    ring_write_tb(utf8, strlen(utf8));
}

- (void)showContextMenuFromJson:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSString *msgId = msg[@"id"];
    NSArray *items = msg[@"data"];
    if (!items || ![items isKindOfClass:[NSArray class]]) return;

    NSMenu *menu = [[NSMenu alloc] init];
    for (NSDictionary *item in items) {
        if ([item[@"separator"] boolValue]) {
            [menu addItem:[NSMenuItem separatorItem]];
            continue;
        }
        NSString *label = item[@"label"] ?: @"";
        NSString *action = item[@"action"];
        NSMenuItem *mi = [[NSMenuItem alloc] initWithTitle:label action:@selector(contextMenuItemClicked:) keyEquivalent:@""];
        [mi setTarget:self];
        [mi setRepresentedObject:@{@"action": action ?: @"", @"msgId": msgId ?: @"0"}];
        [menu addItem:mi];
    }

    NSPoint loc = [NSEvent mouseLocation];
    [menu popUpMenuPositioningItem:nil atLocation:loc inView:nil];
}

- (void)contextMenuItemClicked:(NSMenuItem *)sender {
    NSDictionary *info = [sender representedObject];
    NSString *action = info[@"action"];
    NSString *msgId = info[@"msgId"];

    /* Send the selected action as a response back to the webview */
    NSString *json = [NSString stringWithFormat:
        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"__contextmenu\",\"data\":\"%@\"}",
        msgId, action];
    const char *utf8 = [json UTF8String];
    ring_write_tb(utf8, strlen(utf8));
}

- (void)handleMenuAction:(NSMenuItem *)sender {
    NSString *action = [sender representedObject];
    if (!action) return;
    NSString *json = [NSString stringWithFormat:@"{\"id\":\"0\",\"type\":\"event\",\"action\":\"%@\"}", action];
    const char *utf8 = [json UTF8String];
    ring_write_tb(utf8, strlen(utf8));
}

- (void)windowWillClose:(NSNotification *)notification {
    const char *quit = "{\"id\":\"0\",\"type\":\"control\",\"action\":\"quit\"}";
    ring_write_tb(quit, strlen(quit));
    [NSApp terminate:nil];
}

- (void)windowDidResize:(NSNotification *)notification {
    NSRect frame = self.window.frame;
    NSRect content = [self.window contentRectForFrameRect:frame];
    char json[256];
    snprintf(json, sizeof(json),
        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:resize\",\"data\":{\"width\":%.0f,\"height\":%.0f}}",
        content.size.width, content.size.height);
    ring_write_tb(json, strlen(json));
}

- (void)windowDidMove:(NSNotification *)notification {
    NSRect frame = self.window.frame;
    char json[256];
    snprintf(json, sizeof(json),
        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:move\",\"data\":{\"x\":%.0f,\"y\":%.0f}}",
        frame.origin.x, frame.origin.y);
    ring_write_tb(json, strlen(json));
}

- (void)windowDidBecomeKey:(NSNotification *)notification {
    const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:focus\"}";
    ring_write_tb(json, strlen(json));
}

- (void)windowDidResignKey:(NSNotification *)notification {
    const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:blur\"}";
    ring_write_tb(json, strlen(json));
}

- (void)windowDidMiniaturize:(NSNotification *)notification {
    const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:minimize\"}";
    ring_write_tb(json, strlen(json));
}

- (void)windowDidDeminiaturize:(NSNotification *)notification {
    const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:restore\"}";
    ring_write_tb(json, strlen(json));
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    fprintf(stderr, "[shim] failed to load: %s\n", [[error localizedDescription] UTF8String]);
}

- (void)pollTimer:(NSTimer *)timer {
    char *msg;
    while ((msg = ring_read_ts()) != NULL) {
        NSString *json = [NSString stringWithUTF8String:msg];
        if (strstr(msg, "\"type\":\"control\"")) {
            if (strstr(msg, "\"quit\"")) {
                free(msg);
                [NSApp terminate:nil];
                return;
            }
            if (strstr(msg, "\"reload\"")) {
                free(msg);
                if (self.webview) [self.webview reload];
                continue;
            }
        }
        /* Inject response/event into webview */
        if (self.webview && json) {
            NSString *escaped = [json stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"];
            escaped = [escaped stringByReplacingOccurrencesOfString:@"'" withString:@"\\'"];
            escaped = [escaped stringByReplacingOccurrencesOfString:@"\n" withString:@"\\n"];
            escaped = [escaped stringByReplacingOccurrencesOfString:@"\r" withString:@"\\r"];
            NSString *js = [NSString stringWithFormat:@"window.__butterReceive('%@')", escaped];
            [self.webview evaluateJavaScript:js completionHandler:nil];
        }
        free(msg);
    }
}

@end

/* ---------- build native menu from JSON ---------- */

/*
 * BUTTER_MENU is a JSON array like:
 * [{"label":"File","items":[{"label":"Quit","action":"app:quit","shortcut":"Cmd+Q"},{"separator":true}]}]
 *
 * We do minimal JSON parsing with NSJSONSerialization.
 */

static NSString *keyEquivalentFromShortcut(NSString *shortcut) {
    if (!shortcut) return @"";
    /* "Cmd+Q" -> "q", "Cmd+Shift+Z" -> "Z" */
    NSArray *parts = [shortcut componentsSeparatedByString:@"+"];
    NSString *key = [parts lastObject];
    /* If the shortcut includes Shift, keep uppercase; otherwise lowercase */
    if ([shortcut containsString:@"Shift"]) return key;
    return [key lowercaseString];
}

static NSEventModifierFlags modifiersFromShortcut(NSString *shortcut) {
    if (!shortcut) return 0;
    NSEventModifierFlags flags = 0;
    if ([shortcut containsString:@"Cmd"]) flags |= NSEventModifierFlagCommand;
    if ([shortcut containsString:@"Ctrl"]) flags |= NSEventModifierFlagControl;
    if ([shortcut containsString:@"Alt"]) flags |= NSEventModifierFlagOption;
    if ([shortcut containsString:@"Shift"]) flags |= NSEventModifierFlagShift;
    return flags;
}

static void buildMenuBar(const char *title, const char *menuJson, id delegate) {
    NSMenu *mainMenu = [[NSMenu alloc] init];

    /* App menu (first menu on macOS = app name) */
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@""];
    NSString *appName = [NSString stringWithUTF8String:title];

    NSMenuItem *aboutItem = [[NSMenuItem alloc]
        initWithTitle:[NSString stringWithFormat:@"About %@", appName]
        action:@selector(orderFrontStandardAboutPanel:)
        keyEquivalent:@""];
    [appMenu addItem:aboutItem];
    [appMenu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *hideItem = [[NSMenuItem alloc]
        initWithTitle:[NSString stringWithFormat:@"Hide %@", appName]
        action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItem:hideItem];

    NSMenuItem *hideOthersItem = [[NSMenuItem alloc]
        initWithTitle:@"Hide Others"
        action:@selector(hideOtherApplications:) keyEquivalent:@"h"];
    [hideOthersItem setKeyEquivalentModifierMask:NSEventModifierFlagCommand|NSEventModifierFlagOption];
    [appMenu addItem:hideOthersItem];

    [appMenu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *quitItem = [[NSMenuItem alloc]
        initWithTitle:[NSString stringWithFormat:@"Quit %@", appName]
        action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenu addItem:quitItem];

    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [appMenuItem setSubmenu:appMenu];
    [mainMenu addItem:appMenuItem];

    /* Parse BUTTER_MENU JSON if present */
    if (menuJson) {
        NSData *data = [[NSString stringWithUTF8String:menuJson] dataUsingEncoding:NSUTF8StringEncoding];
        NSArray *sections = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];

        if ([sections isKindOfClass:[NSArray class]]) {
            for (NSDictionary *section in sections) {
                NSString *label = section[@"label"];
                /* Skip "File" quit since we already have it in the app menu */

                NSMenu *submenu = [[NSMenu alloc] initWithTitle:label ?: @""];
                NSArray *items = section[@"items"];

                for (NSDictionary *item in items) {
                    if ([item[@"separator"] boolValue]) {
                        [submenu addItem:[NSMenuItem separatorItem]];
                        continue;
                    }

                    NSString *itemLabel = item[@"label"] ?: @"";
                    NSString *shortcut = item[@"shortcut"];
                    NSString *action = item[@"action"];

                    /* Skip quit items — handled by app menu */
                    if ([action isEqualToString:@"app:quit"]) continue;

                    NSString *keyEq = keyEquivalentFromShortcut(shortcut);
                    NSEventModifierFlags mods = modifiersFromShortcut(shortcut);

                    /* Standard edit actions map to native selectors */
                    SEL sel = NULL;
                    if ([action isEqualToString:@"edit:undo"]) sel = @selector(undo:);
                    else if ([action isEqualToString:@"edit:redo"]) sel = @selector(redo:);
                    else if ([action isEqualToString:@"edit:cut"]) sel = @selector(cut:);
                    else if ([action isEqualToString:@"edit:copy"]) sel = @selector(copy:);
                    else if ([action isEqualToString:@"edit:paste"]) sel = @selector(paste:);
                    else if ([action isEqualToString:@"edit:selectall"]) sel = @selector(selectAll:);
                    else {
                        /* Custom action — route through IPC to host */
                        sel = @selector(handleMenuAction:);
                    }

                    NSMenuItem *mi = [[NSMenuItem alloc]
                        initWithTitle:itemLabel
                        action:sel
                        keyEquivalent:keyEq];
                    if (mods) [mi setKeyEquivalentModifierMask:mods];
                    /* For custom actions, store the action string and target the delegate */
                    if (sel == @selector(handleMenuAction:)) {
                        [mi setTarget:delegate];
                        [mi setRepresentedObject:action];
                    }
                    [submenu addItem:mi];
                }

                /* Only add if submenu has items (after filtering) */
                if ([submenu numberOfItems] > 0) {
                    NSMenuItem *menuItem = [[NSMenuItem alloc] init];
                    [menuItem setSubmenu:submenu];
                    [mainMenu addItem:menuItem];
                }
            }
        }
    }

    [NSApp setMainMenu:mainMenu];
}

/* ---------- open shared memory ---------- */

static int open_shm(const char *name) {
    int fd = shm_open(name, O_RDWR, 0600);
    if (fd < 0) { perror("shm_open"); return -1; }

    g_shm = mmap(NULL, SHM_SIZE, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (g_shm == MAP_FAILED) { perror("mmap"); g_shm = NULL; return -1; }

    size_t nlen = strlen(name);
    char stb[nlen+4], sts[nlen+4];
    snprintf(stb, sizeof(stb), "%s.tb", name);
    snprintf(sts, sizeof(sts), "%s.ts", name);

    g_sem_tb = sem_open(stb, 0);
    g_sem_ts = sem_open(sts, 0);
    if (g_sem_tb == SEM_FAILED || g_sem_ts == SEM_FAILED) {
        fprintf(stderr, "sem_open failed\n");
        return -1;
    }
    return 0;
}

/* ---------- main ---------- */

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <shm-name> <html-path>\n", argv[0]);
        return 1;
    }

    const char *shm_name  = argv[1];
    const char *html_path = argv[2];
    const char *title     = getenv("BUTTER_TITLE");
    if (!title) title = "Butter App";

    if (open_shm(shm_name) != 0) return 1;

    @autoreleasepool {
        /* Set process name so macOS shows it in the menu bar and Dock */
        [[NSProcessInfo processInfo] setValue:[NSString stringWithUTF8String:title]
                                       forKey:@"processName"];

        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];

        ButterDelegate *delegate = [[ButterDelegate alloc] init];
        [app setDelegate:delegate];

        /* WKWebView config */
        WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];

        /* Register custom URL scheme handler */
        ButterSchemeHandler *schemeHandler = [[ButterSchemeHandler alloc] init];
        [config setURLSchemeHandler:schemeHandler forURLScheme:@"butter"];

        WKUserContentController *ucc = config.userContentController;
        [ucc addScriptMessageHandler:delegate name:@"butter"];

        WKUserScript *bridgeScript = [[WKUserScript alloc]
            initWithSource:BRIDGE_JS
            injectionTime:WKUserScriptInjectionTimeAtDocumentStart
            forMainFrameOnly:YES];
        [ucc addUserScript:bridgeScript];

        /* Window */
        NSWindow *win = [[NSWindow alloc]
            initWithContentRect:NSMakeRect(200, 200, 1024, 768)
            styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskResizable|NSWindowStyleMaskMiniaturizable
            backing:NSBackingStoreBuffered
            defer:NO];

        [win setTitle:[NSString stringWithUTF8String:title]];
        [win setDelegate:delegate];
        delegate.window = win;

        /* Set app icon if provided */
        const char *iconPath = getenv("BUTTER_ICON");
        if (iconPath) {
            NSImage *icon = [[NSImage alloc] initWithContentsOfFile:
                [NSString stringWithUTF8String:iconPath]];
            if (icon) [NSApp setApplicationIconImage:icon];
        }

        /* WebView */
        WKWebView *webview = [[WKWebView alloc] initWithFrame:win.contentView.bounds configuration:config];
        webview.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [win.contentView addSubview:webview];
        delegate.webview = webview;
        webview.navigationDelegate = delegate;

        /* Enable DevTools inspector in dev mode */
        const char *devMode = getenv("BUTTER_DEV");
        if (devMode && strcmp(devMode, "1") == 0) {
            [webview.configuration.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
        }

        /* Load HTML via custom protocol (avoids file:// CORS issues) */
        g_assetDir = [[NSString stringWithUTF8String:html_path] stringByDeletingLastPathComponent];
        NSURL *appURL = [NSURL URLWithString:@"butter://app/index.html"];
        [webview loadRequest:[NSURLRequest requestWithURL:appURL]];

        /* Poll timer (~60fps) */
        [NSTimer scheduledTimerWithTimeInterval:1.0/60.0
            target:delegate selector:@selector(pollTimer:)
            userInfo:nil repeats:YES];

        /* Build menu bar */
        const char *menuJson = getenv("BUTTER_MENU");
        buildMenuBar(title, menuJson, delegate);

        /* Show and run */
        [win makeKeyAndOrderFront:nil];
        [app activateIgnoringOtherApps:YES];
        [app run];
    }

    if (g_shm) munmap(g_shm, SHM_SIZE);
    if (g_sem_tb && g_sem_tb != SEM_FAILED) sem_close(g_sem_tb);
    if (g_sem_ts && g_sem_ts != SEM_FAILED) sem_close(g_sem_ts);

    return 0;
}
