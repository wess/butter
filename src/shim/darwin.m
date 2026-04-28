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
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
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

static void buildMenuBar(const char *title, const char *menuJson, id delegate);

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
      "if(m.type==='response'&&m.action==='chunk'&&m.data){"
        "var e=p.get(m.data.id);if(e&&e.onChunk)e.onChunk(m.data.data);}"
      "else if(m.type==='response'){"
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
      "stream:function(a,d,cb){return new Promise(function(res,rej){"
        "var id=String(n++),e={resolve:res,reject:rej,timer:null,onChunk:cb};"
        "p.set(id,e);send({id:id,type:'invoke',action:a,data:d,stream:true});});},"
      "on:function(a,h){if(!l.has(a))l.set(a,[]);l.get(a).push(h);},"
      "off:function(a,h){var hs=l.get(a);if(!hs)return;var i=hs.indexOf(h);if(i!==-1)hs.splice(i,1);}"
    "};"
    "document.addEventListener('dragover',function(e){e.preventDefault();});"
    "document.addEventListener('drop',function(e){"
      "e.preventDefault();"
      "var f=[];if(e.dataTransfer&&e.dataTransfer.files){"
        "for(var i=0;i<e.dataTransfer.files.length;i++){"
          "var x=e.dataTransfer.files[i];f.push({name:x.name,size:x.size,type:x.type,path:x.path||''});}}"
      "if(f.length>0)send({id:String(n++),type:'event',action:'drop:files',data:f});"
    "});"
    "})();";

/* Console wrapper — captures console.log/warn/error/info and posts via the butter bridge */
static NSString *CONSOLE_WRAPPER_JS =
    @"(function() {"
    @"  for (const lvl of ['log','warn','error','info']) {"
    @"    const orig = console[lvl].bind(console);"
    @"    console[lvl] = (...args) => {"
    @"      orig(...args);"
    @"      const text = args.map(a => typeof a === 'string' ? a : (() => {"
    @"        try { return JSON.stringify(a); } catch (e) { return String(a); }"
    @"      })()).join(' ');"
    @"      try { window.webkit.messageHandlers.butter.postMessage(JSON.stringify({__type:'console', level: lvl, text: text})); } catch (e) {}"
    @"    };"
    @"  }"
    @"})();";

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

    NSMutableDictionary *headers = [NSMutableDictionary dictionaryWithDictionary:@{
        @"Content-Type": mime,
        @"Content-Length": [NSString stringWithFormat:@"%lu", (unsigned long)data.length]
    }];

    const char *csp = getenv("BUTTER_CSP");
    if (csp) {
        headers[@"Content-Security-Policy"] = [NSString stringWithUTF8String:csp];
    }

    NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc]
        initWithURL:url statusCode:200 HTTPVersion:@"HTTP/1.1"
        headerFields:headers];

    [urlSchemeTask didReceiveResponse:response];
    [urlSchemeTask didReceiveData:data];
    [urlSchemeTask didFinish];
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
    /* Nothing to clean up */
}

@end

/* ---------- delegate ---------- */

typedef struct {
    char id[64];
    NSUInteger modifierFlags;
    unsigned short keyCode;
} RegisteredShortcut;

#define MAX_SHORTCUTS 64
static RegisteredShortcut g_shortcuts[MAX_SHORTCUTS];
static int g_shortcut_count = 0;
static id g_globalMonitor = nil;

@interface ButterDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate>
@property (nonatomic, strong) WKWebView *webview;
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSWindow *> *windows;
@property (nonatomic, strong) NSMutableDictionary<NSString *, WKWebView *> *webviews;
@property (nonatomic, strong) NSStatusItem *statusItem;
@end

@implementation ButterDelegate

- (instancetype)init {
    self = [super init];
    if (self) {
        _windows = [NSMutableDictionary dictionary];
        _webviews = [NSMutableDictionary dictionary];

        /* Register for sleep/wake notifications */
        NSNotificationCenter *wsnc = [[NSWorkspace sharedWorkspace] notificationCenter];
        [wsnc addObserver:self selector:@selector(systemWillSleep:)
            name:NSWorkspaceWillSleepNotification object:nil];
        [wsnc addObserver:self selector:@selector(systemDidWake:)
            name:NSWorkspaceDidWakeNotification object:nil];
        [wsnc addObserver:self selector:@selector(screensDidSleep:)
            name:NSWorkspaceScreensDidSleepNotification object:nil];
        [wsnc addObserver:self selector:@selector(screensDidWake:)
            name:NSWorkspaceScreensDidWakeNotification object:nil];
    }
    return self;
}

- (void)systemWillSleep:(NSNotification *)note {
    const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"power:sleep\"}";
    ring_write_tb(json, strlen(json));
}

- (void)systemDidWake:(NSNotification *)note {
    const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"power:wake\"}";
    ring_write_tb(json, strlen(json));
}

- (void)screensDidSleep:(NSNotification *)note {
    const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"power:screensleep\"}";
    ring_write_tb(json, strlen(json));
}

- (void)screensDidWake:(NSNotification *)note {
    const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"power:screenwake\"}";
    ring_write_tb(json, strlen(json));
}

- (void)userContentController:(WKUserContentController *)uc didReceiveScriptMessage:(WKScriptMessage *)message {
    NSString *body = message.body;
    const char *utf8 = [body UTF8String];
    if (!utf8) return;

    /* Console capture from injected wrapper */
    if (strstr(utf8, "\"__type\":\"console\"")) {
        NSData *jdata = [body dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:jdata options:0 error:nil];
        NSString *level = parsed[@"level"] ?: @"log";
        NSString *text = parsed[@"text"] ?: @"";

        NSDictionary *eventData = @{ @"level": level, @"text": text };
        NSData *dataJson = [NSJSONSerialization dataWithJSONObject:eventData options:0 error:nil];
        NSString *dataStr = dataJson
            ? [[NSString alloc] initWithData:dataJson encoding:NSUTF8StringEncoding]
            : @"{\"level\":\"log\",\"text\":\"\"}";
        NSString *evt = [NSString stringWithFormat:
            @"{\"id\":\"0\",\"type\":\"event\",\"action\":\"console:message\",\"data\":%@}",
            dataStr];
        ring_write_tb([evt UTF8String], [evt lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
        return;
    }

    /* Check for context menu request */
    if (strstr(utf8, "\"__contextmenu\"")) {
        [self showContextMenuFromJson:body];
        return;
    }

    /* Intercept dialog requests from webview — handle natively without host round-trip */
    if (strstr(utf8, "\"dialog:open\"") || strstr(utf8, "\"dialog:save\"") || strstr(utf8, "\"dialog:folder\"")) {
        [self handleWebviewDialog:body];
        return;
    }

    if (strstr(utf8, "\"dialog:message\"")) {
        [self handleMessageDialog:body fromWebview:YES];
        return;
    }

    ring_write_tb(utf8, strlen(utf8));
}

- (void)handleWebviewDialog:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSString *msgId = msg[@"id"] ?: @"0";
    NSString *action = msg[@"action"];
    NSDictionary *opts = msg[@"data"] ?: @{};

    if ([action isEqualToString:@"dialog:open"]) {
        [self showOpenDialogForWebview:opts messageId:msgId];
    } else if ([action isEqualToString:@"dialog:save"]) {
        [self showSaveDialogForWebview:opts messageId:msgId];
    } else if ([action isEqualToString:@"dialog:folder"]) {
        [self showFolderDialogForWebview:opts messageId:msgId];
    }
}

- (void)injectDialogResponse:(NSString *)response {
    if (!self.webview) return;
    NSString *escaped = [response stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"'" withString:@"\\'"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"\n" withString:@"\\n"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"\r" withString:@"\\r"];
    NSString *js = [NSString stringWithFormat:@"window.__butterReceive('%@')", escaped];
    [self.webview evaluateJavaScript:js completionHandler:nil];
}

- (void)showOpenDialogForWebview:(NSDictionary *)opts messageId:(NSString *)msgId {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    [panel setCanChooseFiles:YES];
    [panel setCanChooseDirectories:NO];

    NSString *title = opts[@"title"];
    if (title) [panel setTitle:title];

    NSString *prompt = opts[@"prompt"];
    if (prompt) [panel setPrompt:prompt];

    NSNumber *multiple = opts[@"multiple"];
    if (multiple) [panel setAllowsMultipleSelection:[multiple boolValue]];

    NSArray *fileTypes = opts[@"filters"];
    if (fileTypes && [fileTypes isKindOfClass:[NSArray class]] && fileTypes.count > 0) {
        NSMutableArray *utTypes = [NSMutableArray array];
        for (NSDictionary *filter in fileTypes) {
            NSArray *exts = filter[@"extensions"];
            if (!exts) continue;
            for (NSString *ext in exts) {
                UTType *t = [UTType typeWithFilenameExtension:ext];
                if (t) [utTypes addObject:t];
            }
        }
        if (utTypes.count > 0) [panel setAllowedContentTypes:utTypes];
    }

    NSModalResponse result = [panel runModal];
    NSMutableArray *paths = [NSMutableArray array];
    if (result == NSModalResponseOK) {
        for (NSURL *url in [panel URLs]) {
            [paths addObject:[url path]];
        }
    }

    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:paths options:0 error:nil];
    NSString *pathsJson = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *response = [NSString stringWithFormat:
        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"dialog:open\",\"data\":{\"paths\":%@,\"cancelled\":%@}}",
        msgId, pathsJson, result == NSModalResponseOK ? @"false" : @"true"];
    [self injectDialogResponse:response];
}

- (void)showSaveDialogForWebview:(NSDictionary *)opts messageId:(NSString *)msgId {
    NSSavePanel *panel = [NSSavePanel savePanel];

    NSString *title = opts[@"title"];
    if (title) [panel setTitle:title];

    NSString *prompt = opts[@"prompt"];
    if (prompt) [panel setPrompt:prompt];

    NSString *defaultName = opts[@"defaultName"];
    if (defaultName) [panel setNameFieldStringValue:defaultName];

    NSString *defaultPath = opts[@"defaultPath"];
    if (defaultPath) [panel setDirectoryURL:[NSURL fileURLWithPath:defaultPath]];

    /* Build filters and optional format popup */
    NSArray *fileTypes = opts[@"filters"];
    __block NSPopUpButton *formatPopup = nil;
    NSMutableArray *filterExtArrays = [NSMutableArray array]; /* parallel array of extension arrays */

    if (fileTypes && [fileTypes isKindOfClass:[NSArray class]] && fileTypes.count > 1) {
        /* Multiple filters — show a "File Format:" popup as accessory view */
        NSView *accessory = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 300, 32)];

        NSTextField *label = [NSTextField labelWithString:@"Format:"];
        [label setFont:[NSFont systemFontOfSize:12]];
        [label setFrame:NSMakeRect(0, 6, 60, 20)];
        [accessory addSubview:label];

        formatPopup = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(64, 2, 220, 28) pullsDown:NO];
        [formatPopup setFont:[NSFont systemFontOfSize:12]];

        for (NSDictionary *filter in fileTypes) {
            NSString *name = filter[@"name"] ?: @"File";
            NSArray *exts = filter[@"extensions"] ?: @[];
            NSString *extLabel = [exts componentsJoinedByString:@", "];
            [formatPopup addItemWithTitle:[NSString stringWithFormat:@"%@ (.%@)", name, extLabel]];
            [filterExtArrays addObject:exts];
        }

        /* When selection changes, update allowed types and filename extension */
        formatPopup.target = self;
        /* We'll handle selection change via the panel running modally — set initial type */

        [accessory addSubview:formatPopup];
        [panel setAccessoryView:accessory];

        /* Set initial allowed content types from first filter */
        NSArray *firstExts = filterExtArrays.firstObject;
        if (firstExts) {
            NSMutableArray *utTypes = [NSMutableArray array];
            for (NSString *ext in firstExts) {
                UTType *t = [UTType typeWithFilenameExtension:ext];
                if (t) [utTypes addObject:t];
            }
            if (utTypes.count > 0) [panel setAllowedContentTypes:utTypes];
        }


        /* Use a timer to poll popup selection changes while panel is open */
        __block NSInteger lastIndex = 0;
        NSTimer *pollTimer = [NSTimer timerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *t) {
            if (!formatPopup) { [t invalidate]; return; }
            NSInteger idx = [formatPopup indexOfSelectedItem];
            if (idx != lastIndex && idx >= 0 && idx < (NSInteger)filterExtArrays.count) {
                lastIndex = idx;
                NSArray *exts = filterExtArrays[idx];
                NSMutableArray *utTypes = [NSMutableArray array];
                for (NSString *ext in exts) {
                    UTType *ut = [UTType typeWithFilenameExtension:ext];
                    if (ut) [utTypes addObject:ut];
                }
                if (utTypes.count > 0) [panel setAllowedContentTypes:utTypes];

                /* Update the filename extension to match */
                NSString *currentName = [panel nameFieldStringValue];
                NSString *baseName = [currentName stringByDeletingPathExtension];
                NSString *newExt = exts.firstObject ?: @"";
                [panel setNameFieldStringValue:[baseName stringByAppendingPathExtension:newExt]];
            }
        }];
        [[NSRunLoop mainRunLoop] addTimer:pollTimer forMode:NSModalPanelRunLoopMode];

        NSModalResponse result = [panel runModal];
        [pollTimer invalidate];

        NSString *path = result == NSModalResponseOK ? [[panel URL] path] : @"";
        NSString *response = [NSString stringWithFormat:
            @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"dialog:save\",\"data\":{\"path\":\"%@\",\"cancelled\":%@}}",
            msgId, path ?: @"", result == NSModalResponseOK ? @"false" : @"true"];
        [self injectDialogResponse:response];

    } else {
        /* Single or no filter — simple save panel */
        if (fileTypes && [fileTypes isKindOfClass:[NSArray class]] && fileTypes.count == 1) {
            NSDictionary *filter = fileTypes.firstObject;
            NSArray *exts = filter[@"extensions"];
            if (exts) {
                NSMutableArray *utTypes = [NSMutableArray array];
                for (NSString *ext in exts) {
                    UTType *t = [UTType typeWithFilenameExtension:ext];
                    if (t) [utTypes addObject:t];
                }
                if (utTypes.count > 0) [panel setAllowedContentTypes:utTypes];
            }
        }

        NSModalResponse result = [panel runModal];
        NSString *path = result == NSModalResponseOK ? [[panel URL] path] : @"";

        NSString *response = [NSString stringWithFormat:
            @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"dialog:save\",\"data\":{\"path\":\"%@\",\"cancelled\":%@}}",
            msgId, path ?: @"", result == NSModalResponseOK ? @"false" : @"true"];
        [self injectDialogResponse:response];
    }
}

- (void)showFolderDialogForWebview:(NSDictionary *)opts messageId:(NSString *)msgId {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    [panel setCanChooseFiles:NO];
    [panel setCanChooseDirectories:YES];
    [panel setCanCreateDirectories:YES];

    NSString *title = opts[@"title"];
    if (title) [panel setTitle:title];

    NSString *prompt = opts[@"prompt"];
    if (prompt) [panel setPrompt:prompt];

    NSModalResponse result = [panel runModal];
    NSMutableArray *paths = [NSMutableArray array];
    if (result == NSModalResponseOK) {
        for (NSURL *url in [panel URLs]) {
            [paths addObject:[url path]];
        }
    }

    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:paths options:0 error:nil];
    NSString *pathsJson = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *response = [NSString stringWithFormat:
        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"dialog:folder\",\"data\":{\"paths\":%@,\"cancelled\":%@}}",
        msgId, pathsJson, result == NSModalResponseOK ? @"false" : @"true"];
    [self injectDialogResponse:response];
}

- (void)handleMessageDialog:(NSString *)jsonStr fromWebview:(BOOL)fromWebview {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSString *msgId = msg[@"id"] ?: @"0";
    NSDictionary *opts = msg[@"data"] ?: @{};

    NSString *title = opts[@"title"] ?: @"";
    NSString *message = opts[@"message"] ?: @"";
    NSString *detail = opts[@"detail"] ?: @"";
    NSString *type = opts[@"type"] ?: @"info";
    NSArray *buttons = opts[@"buttons"];

    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:message];
    if (detail.length > 0) [alert setInformativeText:detail];
    if (title.length > 0) [alert.window setTitle:title];

    if ([type isEqualToString:@"warning"]) {
        [alert setAlertStyle:NSAlertStyleWarning];
    } else if ([type isEqualToString:@"error"]) {
        [alert setAlertStyle:NSAlertStyleCritical];
    } else {
        [alert setAlertStyle:NSAlertStyleInformational];
    }

    if (buttons && [buttons isKindOfClass:[NSArray class]]) {
        for (NSString *btn in buttons) {
            [alert addButtonWithTitle:btn];
        }
    } else {
        [alert addButtonWithTitle:@"OK"];
    }

    NSModalResponse result = [alert runModal];
    NSInteger buttonIndex = result - NSAlertFirstButtonReturn;

    NSString *response = [NSString stringWithFormat:
        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"dialog:message\",\"data\":{\"button\":%ld,\"cancelled\":false}}",
        msgId, (long)buttonIndex];

    if (fromWebview) {
        [self injectDialogResponse:response];
    } else {
        ring_write_tb([response UTF8String], [response lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
    }
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

/* ---------- native dialogs ---------- */

- (void)handleDialogControl:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSString *msgId = msg[@"id"] ?: @"0";
    NSString *action = msg[@"action"];
    NSDictionary *opts = msg[@"data"] ?: @{};

    if ([action isEqualToString:@"dialog:open"]) {
        [self showOpenDialog:opts messageId:msgId];
    } else if ([action isEqualToString:@"dialog:save"]) {
        [self showSaveDialog:opts messageId:msgId];
    } else if ([action isEqualToString:@"dialog:folder"]) {
        [self showFolderDialog:opts messageId:msgId];
    }
}

- (void)showOpenDialog:(NSDictionary *)opts messageId:(NSString *)msgId {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    [panel setCanChooseFiles:YES];
    [panel setCanChooseDirectories:NO];

    NSString *title = opts[@"title"];
    if (title) [panel setTitle:title];

    NSString *prompt = opts[@"prompt"];
    if (prompt) [panel setPrompt:prompt];

    NSNumber *multiple = opts[@"multiple"];
    if (multiple) [panel setAllowsMultipleSelection:[multiple boolValue]];

    NSArray *fileTypes = opts[@"filters"];
    if (fileTypes && [fileTypes isKindOfClass:[NSArray class]] && fileTypes.count > 0) {
        NSMutableArray *extensions = [NSMutableArray array];
        for (NSDictionary *filter in fileTypes) {
            NSArray *exts = filter[@"extensions"];
            if (exts) [extensions addObjectsFromArray:exts];
        }
        if (extensions.count > 0) {
            UTType *types[extensions.count];
            NSMutableArray *utTypes = [NSMutableArray array];
            for (NSString *ext in extensions) {
                UTType *t = [UTType typeWithFilenameExtension:ext];
                if (t) [utTypes addObject:t];
            }
            if (utTypes.count > 0) [panel setAllowedContentTypes:utTypes];
        }
    }

    NSString *defaultPath = opts[@"defaultPath"];
    if (defaultPath) {
        [panel setDirectoryURL:[NSURL fileURLWithPath:defaultPath]];
    }

    NSModalResponse result = [panel runModal];
    NSMutableArray *paths = [NSMutableArray array];

    if (result == NSModalResponseOK) {
        for (NSURL *url in [panel URLs]) {
            [paths addObject:[url path]];
        }
    }

    NSData *pathsData = [NSJSONSerialization dataWithJSONObject:paths options:0 error:nil];
    NSString *pathsJson = [[NSString alloc] initWithData:pathsData encoding:NSUTF8StringEncoding];

    NSString *response = [NSString stringWithFormat:
        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"dialog:open\",\"data\":{\"paths\":%@,\"cancelled\":%@}}",
        msgId, pathsJson, result == NSModalResponseOK ? @"false" : @"true"];
    ring_write_tb([response UTF8String], [response lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
}

- (void)showSaveDialog:(NSDictionary *)opts messageId:(NSString *)msgId {
    NSSavePanel *panel = [NSSavePanel savePanel];

    NSString *title = opts[@"title"];
    if (title) [panel setTitle:title];

    NSString *prompt = opts[@"prompt"];
    if (prompt) [panel setPrompt:prompt];

    NSString *defaultName = opts[@"defaultName"];
    if (defaultName) [panel setNameFieldStringValue:defaultName];

    NSString *defaultPath = opts[@"defaultPath"];
    if (defaultPath) [panel setDirectoryURL:[NSURL fileURLWithPath:defaultPath]];

    NSArray *fileTypes = opts[@"filters"];
    if (fileTypes && [fileTypes isKindOfClass:[NSArray class]] && fileTypes.count > 0) {
        NSMutableArray *utTypes = [NSMutableArray array];
        for (NSDictionary *filter in fileTypes) {
            NSArray *exts = filter[@"extensions"];
            if (!exts) continue;
            for (NSString *ext in exts) {
                UTType *t = [UTType typeWithFilenameExtension:ext];
                if (t) [utTypes addObject:t];
            }
        }
        if (utTypes.count > 0) [panel setAllowedContentTypes:utTypes];
    }

    NSModalResponse result = [panel runModal];
    NSString *path = result == NSModalResponseOK ? [[panel URL] path] : @"";

    NSString *response = [NSString stringWithFormat:
        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"dialog:save\",\"data\":{\"path\":\"%@\",\"cancelled\":%@}}",
        msgId, path ?: @"", result == NSModalResponseOK ? @"false" : @"true"];
    ring_write_tb([response UTF8String], [response lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
}

- (void)showFolderDialog:(NSDictionary *)opts messageId:(NSString *)msgId {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    [panel setCanChooseFiles:NO];
    [panel setCanChooseDirectories:YES];
    [panel setCanCreateDirectories:YES];

    NSString *title = opts[@"title"];
    if (title) [panel setTitle:title];

    NSString *prompt = opts[@"prompt"];
    if (prompt) [panel setPrompt:prompt];

    NSNumber *multiple = opts[@"multiple"];
    if (multiple) [panel setAllowsMultipleSelection:[multiple boolValue]];

    NSString *defaultPath = opts[@"defaultPath"];
    if (defaultPath) [panel setDirectoryURL:[NSURL fileURLWithPath:defaultPath]];

    NSModalResponse result = [panel runModal];
    NSMutableArray *paths = [NSMutableArray array];

    if (result == NSModalResponseOK) {
        for (NSURL *url in [panel URLs]) {
            [paths addObject:[url path]];
        }
    }

    NSData *pathsData = [NSJSONSerialization dataWithJSONObject:paths options:0 error:nil];
    NSString *pathsJson = [[NSString alloc] initWithData:pathsData encoding:NSUTF8StringEncoding];

    NSString *response = [NSString stringWithFormat:
        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"dialog:folder\",\"data\":{\"paths\":%@,\"cancelled\":%@}}",
        msgId, pathsJson, result == NSModalResponseOK ? @"false" : @"true"];
    ring_write_tb([response UTF8String], [response lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
}

- (void)handleMenuAction:(NSMenuItem *)sender {
    NSString *action = [sender representedObject];
    if (!action) return;
    NSString *json = [NSString stringWithFormat:@"{\"id\":\"0\",\"type\":\"event\",\"action\":\"%@\"}", action];
    const char *utf8 = [json UTF8String];
    ring_write_tb(utf8, strlen(utf8));
}

/* ---------- deep linking ---------- */

- (void)applicationWillFinishLaunching:(NSNotification *)notification {
    [[NSAppleEventManager sharedAppleEventManager]
        setEventHandler:self
        andSelector:@selector(handleURLEvent:withReplyEvent:)
        forEventClass:kInternetEventClass
        andEventID:kAEGetURL];
}

- (void)handleURLEvent:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    NSString *url = [[event paramDescriptorForKeyword:keyDirectObject] stringValue];
    if (!url) return;

    /* Escape the URL for JSON */
    NSString *escaped = [url stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""];

    char json[2048];
    snprintf(json, sizeof(json),
        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"app:openurl\",\"data\":{\"url\":\"%s\"}}",
        [escaped UTF8String]);
    ring_write_tb(json, strlen(json));
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

/* ---------- window management ---------- */

- (void)handleWindowCreate:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSString *msgId = msg[@"id"] ?: @"0";
    NSDictionary *opts = msg[@"data"] ?: @{};
    NSString *windowId = opts[@"windowId"] ?: @"0";
    NSString *url = opts[@"url"] ?: @"butter://app/index.html";
    NSString *title = opts[@"title"] ?: @"Butter";
    NSNumber *width = opts[@"width"] ?: @800;
    NSNumber *height = opts[@"height"] ?: @600;
    NSNumber *xPos = opts[@"x"];
    NSNumber *yPos = opts[@"y"];
    NSNumber *frameless = opts[@"frameless"];
    NSNumber *transparent = opts[@"transparent"];
    NSNumber *alwaysOnTop = opts[@"alwaysOnTop"];
    NSNumber *modal = opts[@"modal"];

    NSWindowStyleMask style = NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable;
    if (![frameless boolValue]) {
        style |= NSWindowStyleMaskTitled;
    }

    CGFloat x = xPos ? [xPos doubleValue] : 200;
    CGFloat y = yPos ? [yPos doubleValue] : 200;

    NSWindow *win = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(x, y, [width doubleValue], [height doubleValue])
        styleMask:style
        backing:NSBackingStoreBuffered
        defer:NO];

    [win setTitle:title];
    [win setDelegate:self];

    if ([transparent boolValue]) {
        [win setOpaque:NO];
        [win setBackgroundColor:[NSColor clearColor]];
    }

    if ([alwaysOnTop boolValue]) {
        [win setLevel:NSFloatingWindowLevel];
    }

    /* Create webview config with scheme handler + bridge */
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    ButterSchemeHandler *schemeHandler = [[ButterSchemeHandler alloc] init];
    [config setURLSchemeHandler:schemeHandler forURLScheme:@"butter"];

    WKUserContentController *ucc = config.userContentController;
    [ucc addScriptMessageHandler:self name:@"butter"];

    WKUserScript *bridgeScript = [[WKUserScript alloc]
        initWithSource:BRIDGE_JS
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart
        forMainFrameOnly:YES];
    [ucc addUserScript:bridgeScript];

    WKUserScript *consoleScript = [[WKUserScript alloc]
        initWithSource:CONSOLE_WRAPPER_JS
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart
        forMainFrameOnly:YES];
    [ucc addUserScript:consoleScript];

    WKWebView *webview = [[WKWebView alloc] initWithFrame:win.contentView.bounds configuration:config];
    webview.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

    if ([transparent boolValue]) {
        [webview setValue:@NO forKey:@"drawsBackground"];
    }

    [win.contentView addSubview:webview];
    webview.navigationDelegate = self;

    /* Load URL */
    NSURL *appURL = [NSURL URLWithString:url];
    [webview loadRequest:[NSURLRequest requestWithURL:appURL]];

    /* Track */
    self.windows[windowId] = win;
    self.webviews[windowId] = webview;

    /* Show */
    if ([modal boolValue] && self.window) {
        [self.window beginSheet:win completionHandler:^(NSModalResponse resp) {
            [self.windows removeObjectForKey:windowId];
            [self.webviews removeObjectForKey:windowId];
            char json[256];
            snprintf(json, sizeof(json),
                "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:closed\",\"data\":{\"windowId\":\"%s\"}}",
                [windowId UTF8String]);
            ring_write_tb(json, strlen(json));
        }];
    } else {
        [win makeKeyAndOrderFront:nil];
    }

    /* Send response */
    NSString *response = [NSString stringWithFormat:
        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"window:create\",\"data\":{\"windowId\":\"%@\"}}",
        msgId, windowId];
    ring_write_tb([response UTF8String], [response lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
}

- (void)handleWindowSet:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSDictionary *opts = msg[@"data"] ?: @{};
    NSString *windowId = opts[@"windowId"];
    NSWindow *win = windowId ? self.windows[windowId] : self.window;
    if (!win) win = self.window;

    NSString *title = opts[@"title"];
    if (title) [win setTitle:title];

    NSNumber *width = opts[@"width"];
    NSNumber *height = opts[@"height"];
    if (width || height) {
        NSRect frame = [win frame];
        NSRect content = [win contentRectForFrameRect:frame];
        if (width) content.size.width = [width doubleValue];
        if (height) content.size.height = [height doubleValue];
        NSRect newFrame = [win frameRectForContentRect:content];
        [win setFrame:newFrame display:YES animate:YES];
    }

    NSNumber *x = opts[@"x"];
    NSNumber *y = opts[@"y"];
    if (x || y) {
        NSRect frame = [win frame];
        if (x) frame.origin.x = [x doubleValue];
        if (y) frame.origin.y = [y doubleValue];
        [win setFrameOrigin:frame.origin];
    }

    NSNumber *resizable = opts[@"resizable"];
    if (resizable) {
        if ([resizable boolValue]) {
            [win setStyleMask:[win styleMask] | NSWindowStyleMaskResizable];
        } else {
            [win setStyleMask:[win styleMask] & ~NSWindowStyleMaskResizable];
        }
    }

    NSNumber *minWidth = opts[@"minWidth"];
    NSNumber *minHeight = opts[@"minHeight"];
    if (minWidth || minHeight) {
        NSSize minSize = [win minSize];
        if (minWidth) minSize.width = [minWidth doubleValue];
        if (minHeight) minSize.height = [minHeight doubleValue];
        [win setMinSize:minSize];
    }
}

- (void)handleWindowFullscreen:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSDictionary *opts = msg[@"data"] ?: @{};
    NSNumber *enable = opts[@"enable"];
    BOOL isFS = (self.window.styleMask & NSWindowStyleMaskFullScreen) != 0;

    if (enable && [enable boolValue] != isFS) {
        [self.window toggleFullScreen:nil];
    }
}

- (void)handleWindowAlwaysOnTop:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSDictionary *opts = msg[@"data"] ?: @{};
    NSNumber *enable = opts[@"enable"];
    if (enable) {
        [self.window setLevel:[enable boolValue] ? NSFloatingWindowLevel : NSNormalWindowLevel];
    }
}

/* ---------- system tray ---------- */

- (void)handleTraySet:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSDictionary *opts = msg[@"data"] ?: @{};
    NSString *title = opts[@"title"];
    NSString *tooltip = opts[@"tooltip"];
    NSArray *items = opts[@"items"];

    if (!self.statusItem) {
        self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    }

    if (title) {
        self.statusItem.button.title = title;
    }

    if (tooltip) {
        self.statusItem.button.toolTip = tooltip;
    }

    if (items && [items isKindOfClass:[NSArray class]]) {
        NSMenu *menu = [[NSMenu alloc] init];
        for (NSDictionary *item in items) {
            if ([item[@"separator"] boolValue]) {
                [menu addItem:[NSMenuItem separatorItem]];
                continue;
            }
            NSString *label = item[@"label"] ?: @"";
            NSString *action = item[@"action"];

            NSMenuItem *mi = [[NSMenuItem alloc] initWithTitle:label action:@selector(handleTrayAction:) keyEquivalent:@""];
            [mi setTarget:self];
            if (action) [mi setRepresentedObject:action];
            [menu addItem:mi];
        }
        self.statusItem.menu = menu;
    }
}

- (void)handleTrayAction:(NSMenuItem *)sender {
    NSString *action = [sender representedObject];
    if (!action) return;
    NSString *json = [NSString stringWithFormat:@"{\"id\":\"0\",\"type\":\"event\",\"action\":\"tray:action\",\"data\":{\"action\":\"%@\"}}", action];
    const char *utf8 = [json UTF8String];
    ring_write_tb(utf8, strlen(utf8));
}

- (void)handleTrayRemove {
    if (self.statusItem) {
        [[NSStatusBar systemStatusBar] removeStatusItem:self.statusItem];
        self.statusItem = nil;
    }
}

/* ---------- global shortcuts ---------- */

static unsigned short keyCodeForString(NSString *key) {
    /* Common key mappings (macOS virtual key codes) */
    NSDictionary *map = @{
        @"a": @(0), @"s": @(1), @"d": @(2), @"f": @(3), @"h": @(4), @"g": @(5),
        @"z": @(6), @"x": @(7), @"c": @(8), @"v": @(9), @"b": @(11), @"q": @(12),
        @"w": @(13), @"e": @(14), @"r": @(15), @"y": @(16), @"t": @(17), @"1": @(18),
        @"2": @(19), @"3": @(20), @"4": @(21), @"6": @(22), @"5": @(23), @"=": @(24),
        @"9": @(25), @"7": @(26), @"-": @(27), @"8": @(28), @"0": @(29), @"]": @(30),
        @"o": @(31), @"u": @(32), @"[": @(33), @"i": @(34), @"p": @(35), @"l": @(37),
        @"j": @(38), @"'": @(39), @"k": @(40), @";": @(41), @"\\": @(42), @",": @(43),
        @"/": @(44), @"n": @(45), @"m": @(46), @".": @(47), @" ": @(49), @"space": @(49),
        @"return": @(36), @"enter": @(36), @"tab": @(48), @"escape": @(53), @"esc": @(53),
        @"delete": @(51), @"backspace": @(51),
        @"f1": @(122), @"f2": @(120), @"f3": @(99), @"f4": @(118), @"f5": @(96),
        @"f6": @(97), @"f7": @(98), @"f8": @(100), @"f9": @(101), @"f10": @(109),
        @"f11": @(103), @"f12": @(111),
        @"up": @(126), @"down": @(125), @"left": @(123), @"right": @(124),
    };
    NSNumber *code = map[[key lowercaseString]];
    return code ? [code unsignedShortValue] : USHRT_MAX;
}

- (void)handleShortcutRegister:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSDictionary *opts = msg[@"data"] ?: @{};
    NSString *shortcutId = opts[@"id"];
    NSDictionary *shortcut = opts[@"shortcut"];
    if (!shortcutId || !shortcut) return;

    NSString *key = shortcut[@"key"];
    NSArray *modifiers = shortcut[@"modifiers"];

    unsigned short keyCode = keyCodeForString(key);
    if (keyCode == USHRT_MAX) return;

    NSUInteger modFlags = 0;
    for (NSString *mod in modifiers) {
        if ([mod isEqualToString:@"cmd"]) modFlags |= NSEventModifierFlagCommand;
        else if ([mod isEqualToString:@"ctrl"]) modFlags |= NSEventModifierFlagControl;
        else if ([mod isEqualToString:@"alt"]) modFlags |= NSEventModifierFlagOption;
        else if ([mod isEqualToString:@"shift"]) modFlags |= NSEventModifierFlagShift;
    }

    if (g_shortcut_count < MAX_SHORTCUTS) {
        RegisteredShortcut *s = &g_shortcuts[g_shortcut_count++];
        strncpy(s->id, [shortcutId UTF8String], sizeof(s->id) - 1);
        s->id[sizeof(s->id) - 1] = '\0';
        s->modifierFlags = modFlags;
        s->keyCode = keyCode;
    }

    /* Install global monitor if not already */
    if (!g_globalMonitor && g_shortcut_count > 0) {
        g_globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskKeyDown
            handler:^(NSEvent *event) {
                NSUInteger flags = [event modifierFlags] & NSEventModifierFlagDeviceIndependentFlagsMask;
                unsigned short kc = [event keyCode];
                for (int i = 0; i < g_shortcut_count; i++) {
                    if (g_shortcuts[i].keyCode == kc && (flags & g_shortcuts[i].modifierFlags) == g_shortcuts[i].modifierFlags) {
                        char json[256];
                        snprintf(json, sizeof(json),
                            "{\"id\":\"0\",\"type\":\"event\",\"action\":\"shortcut:triggered\",\"data\":{\"id\":\"%s\"}}",
                            g_shortcuts[i].id);
                        ring_write_tb(json, strlen(json));
                    }
                }
            }];
    }
}

- (void)handleShortcutUnregister:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSDictionary *opts = msg[@"data"] ?: @{};
    NSString *shortcutId = opts[@"id"];
    if (!shortcutId) return;

    const char *idStr = [shortcutId UTF8String];
    for (int i = 0; i < g_shortcut_count; i++) {
        if (strcmp(g_shortcuts[i].id, idStr) == 0) {
            memmove(&g_shortcuts[i], &g_shortcuts[i+1], (g_shortcut_count - i - 1) * sizeof(RegisteredShortcut));
            g_shortcut_count--;
            break;
        }
    }

    /* Remove monitor if no shortcuts left */
    if (g_shortcut_count == 0 && g_globalMonitor) {
        [NSEvent removeMonitor:g_globalMonitor];
        g_globalMonitor = nil;
    }
}

- (void)handleWindowClose:(NSString *)jsonStr {
    NSData *data = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!msg) return;

    NSDictionary *opts = msg[@"data"] ?: @{};
    NSString *windowId = opts[@"windowId"];

    if (windowId && self.windows[windowId]) {
        NSWindow *win = self.windows[windowId];
        /* If shown as sheet, end it */
        if ([win isSheet]) {
            [self.window endSheet:win];
        } else {
            [win close];
        }
        [self.windows removeObjectForKey:windowId];
        [self.webviews removeObjectForKey:windowId];
    }
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
            if (strstr(msg, "\"dialog:open\"") || strstr(msg, "\"dialog:save\"") || strstr(msg, "\"dialog:folder\"")) {
                [self handleDialogControl:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dialog:message\"")) {
                [self handleMessageDialog:json fromWebview:NO];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"screen:list\"")) {
                NSMutableArray *screens = [NSMutableArray array];
                for (NSScreen *screen in [NSScreen screens]) {
                    NSRect frame = [screen frame];
                    NSRect visible = [screen visibleFrame];
                    CGFloat scale = [screen backingScaleFactor];
                    [screens addObject:@{
                        @"x": @(frame.origin.x),
                        @"y": @(frame.origin.y),
                        @"width": @(frame.size.width),
                        @"height": @(frame.size.height),
                        @"visibleX": @(visible.origin.x),
                        @"visibleY": @(visible.origin.y),
                        @"visibleWidth": @(visible.size.width),
                        @"visibleHeight": @(visible.size.height),
                        @"scaleFactor": @(scale),
                        @"isPrimary": @(screen == [NSScreen screens].firstObject),
                    }];
                }
                NSData *jsonData = [NSJSONSerialization dataWithJSONObject:screens options:0 error:nil];
                NSString *screensJson = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
                NSString *msgId2 = @"0";
                NSData *d2 = [json dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *p2 = [NSJSONSerialization JSONObjectWithData:d2 options:0 error:nil];
                if (p2[@"id"]) msgId2 = p2[@"id"];
                NSString *resp = [NSString stringWithFormat:
                    @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"screen:list\",\"data\":%@}",
                    msgId2, screensJson];
                ring_write_tb([resp UTF8String], [resp lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:ready\"")) {
                /* Swap from splash to main app */
                if (self.webview) {
                    NSURL *appURL = [NSURL URLWithString:@"butter://app/index.html"];
                    [self.webview loadRequest:[NSURLRequest requestWithURL:appURL]];
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:screenshot\"")) {
                NSString *msgId = @"0";
                NSData *data2 = [json dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:data2 options:0 error:nil];
                if (parsed[@"id"]) msgId = parsed[@"id"];
                NSDictionary *sOpts = parsed[@"data"] ?: @{};
                NSString *savePath = sOpts[@"path"];

                if (self.webview && savePath) {
                    WKSnapshotConfiguration *snapCfg = [[WKSnapshotConfiguration alloc] init];
                    [self.webview takeSnapshotWithConfiguration:snapCfg completionHandler:^(NSImage *image, NSError *err) {
                        if (err || !image) {
                            char resp[256];
                            snprintf(resp, sizeof(resp),
                                "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:screenshot\",\"data\":{\"ok\":false}}",
                                [msgId UTF8String]);
                            ring_write_tb(resp, strlen(resp));
                            return;
                        }
                        NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithData:[image TIFFRepresentation]];
                        NSData *pngData = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
                        [pngData writeToFile:savePath atomically:YES];

                        char resp[512];
                        snprintf(resp, sizeof(resp),
                            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:screenshot\",\"data\":{\"ok\":true,\"path\":\"%s\"}}",
                            [msgId UTF8String], [savePath UTF8String]);
                        ring_write_tb(resp, strlen(resp));
                    }];
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"mcp:eval\"")) {
                NSString *msgId = @"0";
                NSData *jdata = [json dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:jdata options:0 error:nil];
                if (parsed[@"id"]) msgId = parsed[@"id"];
                NSDictionary *evalOpts = parsed[@"data"] ?: @{};
                NSString *code = evalOpts[@"code"];

                if (!self.webview || !code) {
                    NSString *resp = [NSString stringWithFormat:
                        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"mcp:eval\",\"data\":\"{\\\"error\\\":\\\"missing webview or code\\\"}\"}",
                        msgId];
                    ring_write_tb([resp UTF8String], [resp lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
                    free(msg);
                    continue;
                }

                [self.webview evaluateJavaScript:code completionHandler:^(id result, NSError *err) {
                    NSString *innerJson;
                    if (err) {
                        NSDictionary *errDict = @{ @"error": err.localizedDescription ?: @"unknown" };
                        NSData *errData = [NSJSONSerialization dataWithJSONObject:errDict options:0 error:nil];
                        innerJson = errData
                            ? [[NSString alloc] initWithData:errData encoding:NSUTF8StringEncoding]
                            : @"{\"error\":\"unknown\"}";
                    } else if ([result isKindOfClass:[NSString class]]) {
                        innerJson = (NSString *)result;
                    } else {
                        innerJson = @"{\"error\":\"Wrapper did not return a string\"}";
                    }
                    if (innerJson.length > 60000) {
                        innerJson = @"{\"error\":\"Result too large to return through IPC (limit ~60KB).\"}";
                    }
                    NSData *escapedData = [NSJSONSerialization dataWithJSONObject:innerJson
                        options:NSJSONWritingFragmentsAllowed error:nil];
                    NSString *escaped = escapedData
                        ? [[NSString alloc] initWithData:escapedData encoding:NSUTF8StringEncoding]
                        : @"\"[serialization error]\"";
                    NSString *resp = [NSString stringWithFormat:
                        @"{\"id\":\"%@\",\"type\":\"response\",\"action\":\"mcp:eval\",\"data\":%@}",
                        msgId, escaped];
                    ring_write_tb([resp UTF8String], [resp lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
                }];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:print\"")) {
                if (self.webview) {
                    NSPrintInfo *printInfo = [NSPrintInfo sharedPrintInfo];
                    NSPrintOperation *op = [self.webview printOperationWithPrintInfo:printInfo];
                    [op setShowsPrintPanel:YES];
                    [op setShowsProgressPanel:YES];
                    [op runOperationModalForWindow:self.window delegate:nil didRunSelector:nil contextInfo:nil];
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"tray:set\"")) {
                [self handleTraySet:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"tray:remove\"")) {
                [self handleTrayRemove];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"shortcut:register\"")) {
                [self handleShortcutRegister:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"shortcut:unregister\"")) {
                [self handleShortcutUnregister:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"menu:set\"")) {
                /* Rebuild the menu bar from new JSON */
                NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                NSDictionary *menuData = parsed[@"data"];
                if (menuData) {
                    NSData *menuJson = [NSJSONSerialization dataWithJSONObject:menuData options:0 error:nil];
                    NSString *menuStr = [[NSString alloc] initWithData:menuJson encoding:NSUTF8StringEncoding];
                    const char *title = [self.window.title UTF8String] ?: "Butter App";
                    buildMenuBar(title, [menuStr UTF8String], self);
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:create\"")) {
                [self handleWindowCreate:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:set\"")) {
                [self handleWindowSet:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:maximize\"")) {
                [self.window zoom:nil];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:minimize\"")) {
                [self.window miniaturize:nil];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:restore\"")) {
                [self.window deminiaturize:nil];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:fullscreen\"")) {
                [self handleWindowFullscreen:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:alwaysontop\"")) {
                [self handleWindowAlwaysOnTop:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:close\"")) {
                [self handleWindowClose:json];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"nav:back\"")) {
                if (self.webview && [self.webview canGoBack]) {
                    [self.webview goBack];
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"nav:forward\"")) {
                if (self.webview && [self.webview canGoForward]) {
                    [self.webview goForward];
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"nav:reload\"")) {
                if (self.webview) {
                    [self.webview reload];
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"nav:loadurl\"")) {
                NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                NSDictionary *navData = parsed[@"data"];
                NSString *urlStr = navData[@"url"];
                if (self.webview && urlStr) {
                    NSURL *url = [NSURL URLWithString:urlStr];
                    if (url) {
                        [self.webview loadRequest:[NSURLRequest requestWithURL:url]];
                    }
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dock:setbadge\"")) {
                NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                NSDictionary *dockData = parsed[@"data"];
                NSString *text = dockData[@"text"];
                [[NSApp dockTile] setBadgeLabel:text ?: @""];
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dock:bounce\"")) {
                NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                NSDictionary *dockData = parsed[@"data"];
                NSString *type = dockData[@"type"];
                NSRequestUserAttentionType attentionType = NSInformationalRequest;
                if ([type isEqualToString:@"critical"]) {
                    attentionType = NSCriticalRequest;
                }
                [NSApp requestUserAttention:attentionType];
                free(msg);
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

        WKUserScript *consoleScript = [[WKUserScript alloc]
            initWithSource:CONSOLE_WRAPPER_JS
            injectionTime:WKUserScriptInjectionTimeAtDocumentStart
            forMainFrameOnly:YES];
        [ucc addUserScript:consoleScript];

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

        /* Load splash screen if provided, otherwise main app */
        g_assetDir = [[NSString stringWithUTF8String:html_path] stringByDeletingLastPathComponent];
        const char *splashPath = getenv("BUTTER_SPLASH");
        if (splashPath) {
            NSURL *splashURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:splashPath]];
            [webview loadRequest:[NSURLRequest requestWithURL:splashURL]];
            /* The host sends a "window:ready" control after loading, which triggers the swap */
        } else {
            NSURL *appURL = [NSURL URLWithString:@"butter://app/index.html"];
            [webview loadRequest:[NSURLRequest requestWithURL:appURL]];
        }

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
